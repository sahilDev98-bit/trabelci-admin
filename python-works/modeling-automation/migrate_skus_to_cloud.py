"""
One-time migration: uploads every SKU folder from the local SKU_ROOT_DIR
(the old Downloads-based library) into the cloud library — photos to the
Cloudflare R2 bucket, records to Supabase.

Run it once, from this folder, after filling in the cloud env vars in .env:

    python migrate_skus_to_cloud.py

Already-migrated SKUs are skipped, so it's safe to re-run after a failure.
"""

import mimetypes
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import cloud_store  # noqa: E402 — needs the env loaded first

SKU_ROOT_DIR = Path(os.environ.get("SKU_ROOT_DIR", r"C:\Users\DELL\Downloads\trydty\יש מקטים"))
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def main():
    if not cloud_store.cloud_enabled():
        raise SystemExit(
            "Cloud is not configured — set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, "
            "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL "
            "(and S3_API_URL or R2_ACCOUNT_ID) in .env first."
        )
    if not SKU_ROOT_DIR.is_dir():
        raise SystemExit(f"SKU folder not found: {SKU_ROOT_DIR}")

    folders = [d for d in sorted(SKU_ROOT_DIR.iterdir()) if d.is_dir()]
    print(f"Found {len(folders)} SKU folders in {SKU_ROOT_DIR}")

    migrated = skipped = failed = 0
    for folder in folders:
        sku = folder.name
        images = sorted(
            p for p in folder.iterdir()
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
        )
        if not images:
            print(f"  {sku}: no images — skipped")
            skipped += 1
            continue
        if cloud_store.sku_exists(sku):
            print(f"  {sku}: already in the library — skipped")
            skipped += 1
            continue

        files = [
            (p.name, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "image/jpeg")
            for p in images
        ]
        try:
            cloud_store.create_sku(sku, "", files)
            print(f"  {sku}: uploaded {len(files)} photos")
            migrated += 1
        except Exception as e:
            print(f"  {sku}: FAILED — {e}")
            failed += 1

    print(f"\nDone. Migrated {migrated}, skipped {skipped}, failed {failed}.")


if __name__ == "__main__":
    main()
