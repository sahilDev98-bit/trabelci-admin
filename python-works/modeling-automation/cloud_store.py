"""
Cloud-backed SKU library for the Room Visualizer.

SKU records (number + description + image URLs) live in Supabase
(`visualizer_skus` + `visualizer_sku_images` tables, created with the SQL in
the README); the image files themselves live in the project's existing
Cloudflare R2 bucket under `visualizer-skus/<sku>/<filename>` — the same
bucket, env vars, and public-URL convention as the Node API's r2Service.js.

Supabase is called through its PostgREST endpoint with plain `requests`
(no supabase-py dependency); R2 through boto3's S3 client.

When the env vars aren't configured, server.py falls back to the legacy
local-folder behaviour (SKU_ROOT_DIR) so local dev keeps working unconfigured.
"""

import os
import mimetypes

import requests

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID") or ""
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID") or ""
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY") or ""
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME") or ""
R2_PUBLIC_URL = (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/")
S3_API_URL = os.environ.get("S3_API_URL") or ""

# Keeps visualizer uploads clearly separated from the catalog's own prefixes
# (product/, sku/, categories/, pdf-templates/) in the shared bucket.
R2_PREFIX = "visualizer-skus"

_s3_client = None


def cloud_enabled() -> bool:
    return bool(
        SUPABASE_URL and SUPABASE_KEY
        and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME and R2_PUBLIC_URL
    )


def _headers(extra=None):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    if extra:
        h.update(extra)
    return h


def _rest(path: str) -> str:
    return f"{SUPABASE_URL}/rest/v1/{path}"


def _get_s3():
    global _s3_client
    if _s3_client is None:
        import boto3
        from botocore.config import Config
        endpoint = S3_API_URL or f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
        _s3_client = boto3.client(
            "s3",
            region_name="auto",
            endpoint_url=endpoint,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(s3={"addressing_style": "path"}),
        )
    return _s3_client


def _public_url(key: str) -> str:
    # Same shape as r2Service.js buildPublicUrl: <public-url>/<bucket>/<key>
    return f"{R2_PUBLIC_URL}/{R2_BUCKET_NAME}/{key}"


# ── Reads ────────────────────────────────────────────────────────────────────

def list_skus() -> list:
    """[{sku, description, image_count, preview_url}] sorted by sku."""
    res = requests.get(
        _rest("visualizer_skus"),
        params={
            "select": "sku,description,visualizer_sku_images(image_url,sort_order)",
            "order": "sku.asc",
        },
        headers=_headers(),
        timeout=20,
    )
    res.raise_for_status()
    skus = []
    for row in res.json():
        images = sorted(row.get("visualizer_sku_images") or [], key=lambda i: i.get("sort_order", 0))
        if not images:
            continue
        skus.append({
            "sku": row["sku"],
            "description": row.get("description") or "",
            "image_count": len(images),
            "preview_url": images[0]["image_url"],
        })
    return skus


def list_sku_images(sku: str) -> list:
    """[{filename, url}] for one SKU, in sort order. Empty list if unknown."""
    res = requests.get(
        _rest("visualizer_sku_images"),
        params={"select": "image_url,filename,sort_order", "sku": f"eq.{sku}", "order": "sort_order.asc"},
        headers=_headers(),
        timeout=20,
    )
    res.raise_for_status()
    return [{"filename": r["filename"], "url": r["image_url"]} for r in res.json()]


def sku_exists(sku: str) -> bool:
    res = requests.get(
        _rest("visualizer_skus"),
        params={"select": "sku", "sku": f"eq.{sku}", "limit": 1},
        headers=_headers(),
        timeout=20,
    )
    res.raise_for_status()
    return len(res.json()) > 0


def download_image(url: str) -> bytes:
    res = requests.get(url, timeout=60)
    res.raise_for_status()
    return res.content


# ── Writes ───────────────────────────────────────────────────────────────────

def create_sku(sku: str, description: str, files: list) -> dict:
    """Uploads every image to R2 and records the SKU in Supabase.

    files: [(filename, bytes, content_type)] in display order.
    Raises ValueError if the SKU already exists.
    """
    if sku_exists(sku):
        raise ValueError(f"SKU '{sku}' already exists in the library")

    s3 = _get_s3()
    image_rows = []
    for order, (filename, data, content_type) in enumerate(files):
        key = f"{R2_PREFIX}/{sku}/{filename}"
        s3.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=data,
            ContentType=content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream",
        )
        image_rows.append({
            "sku": sku,
            "filename": filename,
            "image_url": _public_url(key),
            "sort_order": order,
        })

    res = requests.post(
        _rest("visualizer_skus"),
        json={"sku": sku, "description": description or ""},
        headers=_headers({"Prefer": "return=minimal"}),
        timeout=20,
    )
    res.raise_for_status()

    res = requests.post(
        _rest("visualizer_sku_images"),
        json=image_rows,
        headers=_headers({"Prefer": "return=minimal"}),
        timeout=20,
    )
    res.raise_for_status()

    return {"sku": sku, "description": description or "", "image_count": len(image_rows),
            "preview_url": image_rows[0]["image_url"] if image_rows else None}
