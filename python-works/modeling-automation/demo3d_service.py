import base64
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from constants import SURFACES
from layout_renderer import render_layout

STORAGE_ROOT = Path(__file__).parent / "storage" / "demo3d_storage"

app = FastAPI(title="Demo 3D Modelling App")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def job_dir(job_id: str) -> Path:
    return STORAGE_ROOT / job_id


class GenerateImagesRequest(BaseModel):
    session_id: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/sendimages")
async def send_images(request: Request):
    form = await request.form()

    job_id = form.get("job_id")
    category = form.get("category")
    if not job_id or not category:
        raise HTTPException(status_code=400, detail="job_id and category are required")

    jdir = job_dir(job_id)
    received_dir = jdir / "received"
    received_dir.mkdir(parents=True, exist_ok=True)

    surfaces_received = []
    surface_files = {}
    for surface in SURFACES:
        surface_id = surface["id"]
        uploads = form.getlist(surface_id)
        if not uploads:
            continue
        saved = []
        for idx, upload in enumerate(uploads):
            suffix = Path(upload.filename).suffix or ".jpg"
            dest = received_dir / f"{surface_id}_{idx}{suffix}"
            dest.write_bytes(await upload.read())
            saved.append(dest.name)
        surface_files[surface_id] = saved
        surfaces_received.append(surface_id)

    if not surfaces_received:
        raise HTTPException(status_code=400, detail="no surface image fields were provided")

    room_dimensions = None
    raw_dimensions = form.get("room_dimensions")
    if raw_dimensions:
        try:
            room_dimensions = json.loads(raw_dimensions)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="room_dimensions must be valid JSON")

    receipt = {
        "session_id": job_id,
        "category": category,
        "surfaces_received": surfaces_received,
        "surface_files": surface_files,
        "room_dimensions": room_dimensions,
    }
    (jdir / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")

    return receipt


@app.post("/generateimages")
def generate_images(payload: GenerateImagesRequest):
    """Arranges the received marble/tile photos onto the room's back/left/right walls
    and floor — the same 'apply slabs randomly' idea as the existing tile-visualizer
    app, computed here deterministically (no AI model call). This is the '3D
    modelling app's own output; the separate AI Rendering pass happens afterwards,
    in the main workflow app's /finalize step."""
    session_id = payload.session_id
    jdir = job_dir(session_id)
    receipt_path = jdir / "receipt.json"
    if not receipt_path.exists():
        raise HTTPException(status_code=404, detail="unknown session_id — call /sendimages first")

    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    surface_files = receipt["surface_files"]

    received_dir = jdir / "received"
    surface_images = {
        surface_id: [received_dir / fn for fn in filenames] for surface_id, filenames in surface_files.items()
    }

    generated_dir = jdir / "generated"
    generated_dir.mkdir(parents=True, exist_ok=True)
    revision = len(list(generated_dir.glob("gen_*.png"))) + 1

    layout_image = render_layout(
        surface_images, seed=revision, room_dimensions=receipt.get("room_dimensions")
    )

    out_path = generated_dir / f"gen_{revision:03d}.png"
    layout_image.save(out_path, format="PNG")
    image_b64 = base64.b64encode(out_path.read_bytes()).decode("utf-8")

    return {"revision": revision, "image_base64": image_b64, "mime_type": "image/png"}


if __name__ == "__main__":
    import uvicorn

    print("Demo 3D modelling app running at http://localhost:8070")
    uvicorn.run(app, host="0.0.0.0", port=8070)
