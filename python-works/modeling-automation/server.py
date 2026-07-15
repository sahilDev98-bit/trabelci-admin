import base64
import json
import mimetypes
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

from constants import (
    BOOKMATCH_MODES,
    CATEGORIES,
    CATEGORY_IDS,
    DEFAULT_ROOM_DIMENSIONS,
    DEFAULT_TILE_SETTINGS,
    SURFACES,
    SURFACE_IDS,
)
from modeling_client import get_modeling_client
import cloud_store

load_dotenv()
# HF_TOKEN historically lives in the photo-llm experiment's .env — fall back to
# it so the AI furnishing endpoint works without duplicating the secret here.
load_dotenv(Path(__file__).parent.parent / "photo-llm" / ".env")

modeling_client = get_modeling_client()

app = Flask(__name__)
CORS(app)

JOBS_ROOT = Path(__file__).parent / "storage" / "jobs"

# Local folder of marble SKU photos, one subfolder per SKU number — lets staff
# pick a SKU from a dropdown instead of hunting for its folder to drag in.
SKU_ROOT_DIR = Path(os.environ.get("SKU_ROOT_DIR", r"C:\Users\DELL\Downloads\trydty\יש מקטים"))
SKU_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def list_sku_images(sku: str) -> list[Path]:
    sku_dir = SKU_ROOT_DIR / sku
    if not sku_dir.is_dir():
        return []
    return sorted(p for p in sku_dir.iterdir() if p.is_file() and p.suffix.lower() in SKU_IMAGE_EXTENSIONS)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def job_dir(job_id: str) -> Path:
    return JOBS_ROOT / job_id


def job_json_path(job_id: str) -> Path:
    return job_dir(job_id) / "job.json"


def load_job(job_id: str) -> dict:
    path = job_json_path(job_id)
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_job(job: dict):
    job["updated_at"] = now_iso()
    job_json_path(job["job_id"]).write_text(json.dumps(job, indent=2), encoding="utf-8")


def image_path_by_id_map(job: dict) -> dict:
    jdir = job_dir(job["job_id"])
    return {img["image_id"]: str(jdir / img["stored_path"]) for img in job["images"]}


FRONTEND_DIR = Path(__file__).parent


@app.route("/")
def serve_index():
    """Serves the visualizer UI itself, so the admin site can embed it in an
    iframe (the admin's "Generate AI Images" page) instead of requiring the
    file:// double-click described in the README. index.html only references
    template-icons/ relatively — its API calls already use an absolute base."""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/template-icons/<path:filename>")
def serve_template_icon(filename):
    return send_from_directory(FRONTEND_DIR / "template-icons", filename)


# Built 3D viewer app (python-works/3d-modeling `npx vite build` output,
# copied to ./viewer). Serving it same-origin means production needs no
# Vite dev server — index.html's detectViewerUrl() checks here first.
VIEWER_DIR = FRONTEND_DIR / "viewer"


@app.route("/viewer/")
@app.route("/viewer/<path:filename>")
def serve_viewer(filename="index.html"):
    if not VIEWER_DIR.is_dir():
        return jsonify({"error": "viewer build not deployed"}), 404
    return send_from_directory(VIEWER_DIR, filename)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/constants")
def constants():
    return jsonify({
        "categories": CATEGORIES,
        "surfaces": SURFACES,
        "default_tile_settings": DEFAULT_TILE_SETTINGS,
        "default_room_dimensions": DEFAULT_ROOM_DIMENSIONS,
        "bookmatch_modes": BOOKMATCH_MODES,
    })


@app.route("/jobs", methods=["POST"])
def create_job():
    job_id = uuid.uuid4().hex
    jdir = job_dir(job_id)
    (jdir / "uploads").mkdir(parents=True, exist_ok=True)
    (jdir / "generated").mkdir(parents=True, exist_ok=True)
    (jdir / "final").mkdir(parents=True, exist_ok=True)

    job = {
        "job_id": job_id,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "status": "created",
        "category": None,
        "images": [],
        "assignments": {s["id"]: [] for s in SURFACES},
        "tile_settings": {},
        "room_dimensions": {},
        "send_receipt": None,
        "generated_history": [],
        "current_generated_revision": None,
        "final": None,
        "error": None,
    }
    save_job(job)
    return jsonify(job)


@app.route("/jobs/<job_id>", methods=["GET"])
def get_job(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404
    return jsonify(job)


@app.route("/jobs/<job_id>/upload", methods=["POST"])
def upload_images(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    files = request.files.getlist("images")
    if not files:
        return jsonify({"error": "no files provided under field 'images'"}), 400

    uploads_dir = job_dir(job_id) / "uploads"
    added = []
    for f in files:
        image_id = uuid.uuid4().hex[:8]
        filename = secure_filename(f.filename) or f"{image_id}.jpg"
        stored_name = f"{image_id}_{filename}"
        f.save(uploads_dir / stored_name)

        entry = {
            "image_id": image_id,
            "filename": filename,
            "stored_path": f"uploads/{stored_name}",
            "content_type": f.mimetype,
        }
        job["images"].append(entry)
        added.append({**entry, "url": f"/jobs/{job_id}/files/{entry['stored_path']}"})

    job["status"] = "uploaded"
    save_job(job)
    return jsonify({"images": added})


@app.route("/skus")
def list_skus():
    # Cloud-first: the SKU library lives in Supabase (records) + R2 (photos).
    # The local SKU_ROOT_DIR folder remains only as a fallback for running
    # without cloud credentials configured.
    if cloud_store.cloud_enabled():
        try:
            return jsonify({"skus": cloud_store.list_skus()})
        except Exception as e:
            print(f"[/skus] cloud lookup failed: {e}", flush=True)
            return jsonify({"error": "could not load the SKU library"}), 502

    if not SKU_ROOT_DIR.is_dir():
        return jsonify({"skus": []})

    skus = []
    for entry in sorted(SKU_ROOT_DIR.iterdir()):
        if not entry.is_dir():
            continue
        images = list_sku_images(entry.name)
        if not images:
            continue
        skus.append({
            "sku": entry.name,
            "image_count": len(images),
            # First photo, shown as a thumbnail in the SKU dropdown so staff
            # can see the marble they're picking.
            "preview_url": f"/skus/{entry.name}/files/{quote(images[0].name)}",
        })
    return jsonify({"skus": skus})


@app.route("/skus", methods=["POST"])
def create_sku():
    """Adds a new SKU to the cloud library: multipart form with 'sku',
    optional 'description', and one or more image files under 'images'.
    Uploads the photos to R2 and records the SKU in Supabase, after which it
    appears in the dropdown like any other."""
    if not cloud_store.cloud_enabled():
        return jsonify({"error": "cloud SKU library is not configured on this server"}), 503

    sku = secure_filename(str(request.form.get("sku") or "").strip())
    description = str(request.form.get("description") or "").strip()
    files = request.files.getlist("images")
    if not sku:
        return jsonify({"error": "sku is required"}), 400
    if not files:
        return jsonify({"error": "at least one image is required under field 'images'"}), 400

    payload = []
    for f in files:
        filename = secure_filename(f.filename) or "image.jpg"
        payload.append((filename, f.read(), f.mimetype))

    try:
        created = cloud_store.create_sku(sku, description, payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        print(f"[POST /skus] {e}", flush=True)
        return jsonify({"error": "could not save the SKU to the library"}), 502

    return jsonify(created), 201


@app.route("/skus/<sku>/images")
def sku_images(sku):
    """Read-only preview of a SKU's photos — from the cloud library when
    configured (public R2 URLs), else straight from SKU_ROOT_DIR. Used to show
    the picker's preview before the user confirms via 'OK', so nothing is
    copied into a job until /upload-sku is actually called."""
    sku = secure_filename(sku)

    if cloud_store.cloud_enabled():
        try:
            images = cloud_store.list_sku_images(sku)
        except Exception as e:
            print(f"[/skus/{sku}/images] cloud lookup failed: {e}", flush=True)
            return jsonify({"error": "could not load the SKU library"}), 502
        if not images:
            return jsonify({"error": f"no images found for SKU '{sku}'"}), 404
        return jsonify({"sku": sku, "images": images})

    images = list_sku_images(sku)
    if not images:
        return jsonify({"error": f"no images found for SKU '{sku}'"}), 404

    return jsonify({
        "sku": sku,
        "images": [{"filename": p.name, "url": f"/skus/{sku}/files/{quote(p.name)}"} for p in images],
    })


@app.route("/skus/<sku>/files/<path:filename>")
def serve_sku_file(sku, filename):
    sku = secure_filename(sku)
    return send_from_directory(SKU_ROOT_DIR / sku, filename)


@app.route("/jobs/<job_id>/upload-sku", methods=["POST"])
def upload_sku(job_id):
    """Copies every photo from a SKU's local folder straight into the job's
    uploads — the SKU-picker's equivalent of /upload, minus the manual
    drag-and-drop step."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    sku = secure_filename(str(body.get("sku") or ""))
    if not sku:
        return jsonify({"error": "sku is required"}), 400

    # Resolve the SKU's photos as (filename, bytes) pairs — downloaded from
    # the cloud library (R2) when configured, else read off the local folder.
    if cloud_store.cloud_enabled():
        try:
            cloud_images = cloud_store.list_sku_images(sku)
            photos = [
                (secure_filename(img["filename"]) or "image.jpg", cloud_store.download_image(img["url"]))
                for img in cloud_images
            ]
        except Exception as e:
            print(f"[/jobs/{job_id}/upload-sku] cloud fetch failed: {e}", flush=True)
            return jsonify({"error": "could not fetch the SKU's photos from the library"}), 502
    else:
        photos = [(p.name, p.read_bytes()) for p in list_sku_images(sku)]

    if not photos:
        return jsonify({"error": f"no images found for SKU '{sku}'"}), 404

    uploads_dir = job_dir(job_id) / "uploads"
    added = []
    for filename, data in photos:
        image_id = uuid.uuid4().hex[:8]
        filename = secure_filename(filename) or f"{image_id}.jpg"
        stored_name = f"{image_id}_{filename}"
        (uploads_dir / stored_name).write_bytes(data)

        entry = {
            "image_id": image_id,
            "filename": filename,
            "stored_path": f"uploads/{stored_name}",
            "content_type": mimetypes.guess_type(filename)[0] or "application/octet-stream",
        }
        job["images"].append(entry)
        added.append({**entry, "url": f"/jobs/{job_id}/files/{entry['stored_path']}"})

    job["status"] = "uploaded"
    save_job(job)
    return jsonify({"sku": sku, "images": added})


@app.route("/jobs/<job_id>/category", methods=["POST"])
def set_category(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    category = body.get("category")
    if category not in CATEGORY_IDS:
        return jsonify({"error": f"category must be one of {sorted(CATEGORY_IDS)}"}), 400

    job["category"] = category
    job["status"] = "category_set"
    save_job(job)
    return jsonify({"ok": True})


@app.route("/jobs/<job_id>/assignments", methods=["POST"])
def set_assignments(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    assignments = body.get("assignments")
    if not isinstance(assignments, dict):
        return jsonify({"error": "assignments must be an object"}), 400

    known_image_ids = {img["image_id"] for img in job["images"]}
    for surface_id, image_ids in assignments.items():
        if surface_id not in SURFACE_IDS:
            return jsonify({"error": f"unknown surface_id '{surface_id}'"}), 400
        if image_ids is None:
            continue
        if not isinstance(image_ids, list):
            return jsonify({"error": f"assignments['{surface_id}'] must be a list of image_ids"}), 400
        for image_id in image_ids:
            if image_id not in known_image_ids:
                return jsonify({"error": f"unknown image_id '{image_id}'"}), 400

    job["assignments"] = {s["id"]: list(assignments.get(s["id"]) or []) for s in SURFACES}
    job["status"] = "assigned"
    save_job(job)
    return jsonify({"ok": True})


TILE_SETTING_KEYS = set(DEFAULT_TILE_SETTINGS.keys())
BOOKMATCH_IDS = {m["id"] for m in BOOKMATCH_MODES}


@app.route("/jobs/<job_id>/tile-settings", methods=["POST"])
def set_tile_settings(job_id):
    """Per-surface tile controls (width/height/rotation/flip/bookmatch/grout) —
    mirrors the 3D app's own Tile Size / Transform / Bookmatch / Grout panel.
    Only surfaces present in the body are touched; unset ones keep the app's defaults."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    tile_settings = body.get("tile_settings")
    if not isinstance(tile_settings, dict):
        return jsonify({"error": "tile_settings must be an object keyed by surface_id"}), 400

    for surface_id, patch in tile_settings.items():
        if surface_id not in SURFACE_IDS:
            return jsonify({"error": f"unknown surface_id '{surface_id}'"}), 400
        if not isinstance(patch, dict):
            return jsonify({"error": f"tile_settings['{surface_id}'] must be an object"}), 400
        unknown = set(patch.keys()) - TILE_SETTING_KEYS
        if unknown:
            return jsonify({"error": f"unknown tile setting(s) {sorted(unknown)}"}), 400
        if "bookmatch" in patch and patch["bookmatch"] not in BOOKMATCH_IDS:
            return jsonify({"error": f"bookmatch must be one of {sorted(BOOKMATCH_IDS)}"}), 400

    for surface_id, patch in tile_settings.items():
        job["tile_settings"][surface_id] = {**job["tile_settings"].get(surface_id, {}), **patch}

    save_job(job)
    return jsonify({"ok": True})


ROOM_DIMENSION_KEYS = set(DEFAULT_ROOM_DIMENSIONS.keys())


@app.route("/jobs/<job_id>/room-dimensions", methods=["POST"])
def set_room_dimensions(job_id):
    """Real-world room size in cm (floorWidth/floorDepth/wallHeight) — mirrors the
    3D app's own Room Dimensions panel. Only the provided keys are stored; unset
    ones keep the room template's default size for the chosen category."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    dimensions = body.get("dimensions")
    if not isinstance(dimensions, dict):
        return jsonify({"error": "dimensions must be an object"}), 400

    unknown = set(dimensions.keys()) - ROOM_DIMENSION_KEYS
    if unknown:
        return jsonify({"error": f"unknown dimension(s) {sorted(unknown)}"}), 400
    for key, value in dimensions.items():
        if not isinstance(value, (int, float)) or value <= 0:
            return jsonify({"error": f"dimensions['{key}'] must be a positive number"}), 400

    job["room_dimensions"] = {**job.get("room_dimensions", {}), **dimensions}
    save_job(job)
    return jsonify({"ok": True})


@app.route("/jobs/<job_id>/send", methods=["POST"])
def send_images(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    if not job["category"]:
        return jsonify({"error": "category must be set before sending"}), 400

    active_assignments = {k: v for k, v in job["assignments"].items() if v}
    if not active_assignments:
        return jsonify({"error": "at least one surface must be assigned an image"}), 400

    active_tile_settings = {k: v for k, v in job["tile_settings"].items() if k in active_assignments}
    receipt = modeling_client.send_images(
        job_id=job_id,
        category=job["category"],
        assignments=active_assignments,
        image_path_by_id=image_path_by_id_map(job),
        tile_settings=active_tile_settings,
        room_dimensions=job.get("room_dimensions") or None,
    )

    job["send_receipt"] = receipt
    job["status"] = "sent"
    save_job(job)
    return jsonify(receipt)


@app.route("/jobs/<job_id>/generate", methods=["POST"])
def generate(job_id):
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    if not job["send_receipt"]:
        return jsonify({"error": "call /send before /generate"}), 400

    result = modeling_client.generate_images(job_id)
    revision = result["revision"]

    generated_dir = job_dir(job_id) / "generated"
    out_path = generated_dir / f"gen_{revision:03d}.png"
    out_path.write_bytes(base64.b64decode(result["image_base64"]))

    job["generated_history"].append(
        {"revision": revision, "file": f"generated/gen_{revision:03d}.png", "created_at": now_iso()}
    )
    job["current_generated_revision"] = revision
    job["status"] = "generated"
    save_job(job)

    return jsonify(
        {"revision": revision, "image_url": f"/jobs/{job_id}/files/generated/gen_{revision:03d}.png"}
    )


@app.route("/jobs/<job_id>/submit-arrangement", methods=["POST"])
def submit_arrangement(job_id):
    """Accepts a PNG captured directly from the real 3D app (embedded as an
    iframe in the 'Arrange & Review' step) and records it the same way
    /generate would — so /finalize keeps working unchanged. No modeling_client
    call here: the browser already rendered it, this just saves the result."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    image_base64 = body.get("image_base64")
    if not image_base64:
        return jsonify({"error": "image_base64 is required"}), 400

    if image_base64.startswith("data:"):
        image_base64 = image_base64.split(",", 1)[1]

    revision = len(job["generated_history"]) + 1
    generated_dir = job_dir(job_id) / "generated"
    out_path = generated_dir / f"gen_{revision:03d}.png"
    out_path.write_bytes(base64.b64decode(image_base64))

    job["generated_history"].append(
        {"revision": revision, "file": f"generated/gen_{revision:03d}.png", "created_at": now_iso()}
    )
    job["current_generated_revision"] = revision
    job["status"] = "generated"
    save_job(job)

    return jsonify(
        {"revision": revision, "image_url": f"/jobs/{job_id}/files/generated/gen_{revision:03d}.png"}
    )


# Per-category furniture lists for the AI furnishing prompt — the surface-
# preservation rules around them are the part proven out in photo-llm/flux-1.py.
FURNISH_ROOM_DESCRIPTIONS = {
    "bedroom": ("luxury bedroom", "- modern bed\n- bedside tables\n- lamps\n- rug\n- wardrobe\n- subtle decor"),
    "kitchen": ("luxury kitchen", "- modern kitchen island\n- bar stools\n- pendant lights\n- subtle decor"),
    "bathroom": ("luxury bathroom", "- freestanding bathtub\n- vanity with mirror\n- towels\n- subtle decor"),
    "commercial": ("elegant commercial hall", "- reception desk\n- lounge seating\n- planters\n- subtle decor"),
    "shop": ("elegant retail showroom", "- display tables\n- shelving\n- accent lighting\n- subtle decor"),
    "restaurant": ("luxury restaurant", "- dining tables and chairs\n- pendant lights\n- subtle decor"),
    "other": ("luxury living room", "- modern sofa\n- coffee table\n- rug\n- floor lamp\n- plants\n- subtle decor"),
}


def build_furnish_prompt(category: str) -> str:
    room_name, furniture = FURNISH_ROOM_DESCRIPTIONS.get(category or "other", FURNISH_ROOM_DESCRIPTIONS["other"])
    return f"""
        Transform this EMPTY room into a {room_name}.

        CRITICAL REQUIREMENTS:
        - Preserve the room architecture exactly.
        - Preserve all marble walls exactly.
        - Preserve all wall textures and marble patterns exactly.
        - Preserve the marble floor exactly.
        - Do not alter any colors.
        - Do not alter camera angle.
        - Do not alter room dimensions.
        - Only add furniture.

        Add:
{furniture}

        Furniture must be placed inside the room while all existing surfaces remain unchanged.
        Photorealistic interior photography, natural soft lighting.
        """


@app.route("/jobs/<job_id>/furnish", methods=["POST"])
def furnish(job_id):
    """Sends a clean (furniture-free) capture of the marble-tiled room through
    FLUX.1-Kontext to add photorealistic furniture while preserving the marble
    surfaces — the approach validated in photo-llm/flux-1.py. Saves the result
    as a new generated revision so /finalize works on it unchanged."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    body = request.get_json(silent=True) or {}
    image_base64 = body.get("image_base64")
    if not image_base64:
        return jsonify({"error": "image_base64 is required"}), 400
    if image_base64.startswith("data:"):
        image_base64 = image_base64.split(",", 1)[1]

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        return jsonify({"error": "HF_TOKEN is not configured on the server"}), 503

    try:
        from huggingface_hub import InferenceClient
    except ImportError:
        return jsonify({"error": "huggingface_hub is not installed — run: pip install huggingface_hub"}), 503

    try:
        client = InferenceClient(api_key=hf_token)
        result_image = client.image_to_image(
            base64.b64decode(image_base64),
            prompt=build_furnish_prompt(job.get("category")),
            model="black-forest-labs/FLUX.1-Kontext-dev",
        )
    except Exception as exc:  # HF errors (quota, model loading, network) all surface here
        return jsonify({"error": f"AI furnishing failed: {exc}"}), 502

    revision = len(job["generated_history"]) + 1
    out_path = job_dir(job_id) / "generated" / f"gen_{revision:03d}.png"
    result_image.save(out_path)

    job["generated_history"].append(
        {"revision": revision, "file": f"generated/gen_{revision:03d}.png", "created_at": now_iso(), "furnished": True}
    )
    job["current_generated_revision"] = revision
    job["status"] = "generated"
    save_job(job)

    return jsonify(
        {"revision": revision, "image_url": f"/jobs/{job_id}/files/generated/gen_{revision:03d}.png"}
    )


@app.route("/jobs/<job_id>/finalize", methods=["POST"])
def finalize(job_id):
    """Promotes the currently reviewed arrangement to the job's final result.
    No AI model is called here — the 3D modelling app's own layout is the end
    product of this workflow."""
    job = load_job(job_id)
    if job is None:
        return jsonify({"error": "job not found"}), 404

    if not job["generated_history"]:
        return jsonify({"error": "no generated image yet — call /generate first"}), 400

    body = request.get_json(silent=True) or {}
    revision = body.get("revision") or job["current_generated_revision"]
    entry = next((g for g in job["generated_history"] if g["revision"] == revision), None)
    if entry is None:
        return jsonify({"error": f"unknown revision {revision}"}), 400

    source_path = job_dir(job_id) / entry["file"]
    final_path = job_dir(job_id) / "final" / "final.png"
    final_path.write_bytes(source_path.read_bytes())

    job["final"] = {"file": "final/final.png", "source_revision": revision, "created_at": now_iso()}
    job["status"] = "finalized"
    save_job(job)

    return jsonify({"image_url": f"/jobs/{job_id}/files/final/final.png"})


@app.route("/jobs/<job_id>/files/<path:subpath>")
def serve_file(job_id, subpath):
    jdir = job_dir(job_id)
    return send_from_directory(jdir, subpath)


if __name__ == "__main__":
    # 0.0.0.0 so the server is reachable when run inside a container;
    # debug (auto-reload) is opt-in via FLASK_DEBUG=1 for local development.
    port = int(os.environ.get("PORT", "5057"))
    print(f"Modeling-automation server running at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
