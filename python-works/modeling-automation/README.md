# Marble SKU → Room Visualizer (POC)

Standalone proof-of-concept. Two local services + one static page — no changes to the main trabelci-admin site.

## Setup

```
cd python-works/modeling-automation
pip install -r requirements.txt
```

No OpenAI key is required — the whole pipeline (arrangement included) runs locally with Pillow, no AI model calls.

## Run

Two terminals:

```
python demo3d_service.py   # the mock "3D modelling app" — http://localhost:8070
python server.py           # the workflow app the UI talks to — http://localhost:5057
```

Then open `index.html` directly in a browser (double-click it, or `file://` URL).

## Flow

1. **Upload** — drop a whole SKU folder (or select individual files), containing the marble/tile photos.
2. **Category & Placement** — pick a space (Kitchen / Bathroom / Bedroom / Commercial Areas / Shop / Restaurant / Other), then click a surface (Back Wall / Left Wall / Right Wall / Ground) and click one or more images to assign them there (click an assigned image again to remove it — a surface can hold several slab/tile photos).
3. **Review Settings** — a read-only recap of the category and every surface's assigned photos, before anything is sent anywhere.
4. **Arrange & Review** — sends the images to the demo 3D modelling app (`/sendimages`), which arranges them onto the room's back/left/right walls and floor (`/generateimages`) — tiling the assigned photos with grout lines and random rotation/placement, the same "apply slabs randomly" idea as the existing 3D tile-visualizer app, computed deterministically with Pillow. **No AI model is involved anywhere in this workflow.** **Regenerate Arrangement** re-randomizes the tiling; history is kept in the filmstrip.
5. **Use This Arrangement** — promotes whichever arrangement you landed on to the job's final result. The final image is just that arrangement, downloadable from screen 5.

## Swapping in the real 3D app later

`modeling_client.py` is the only integration point. Set `MODELING_APP_BASE_URL` in `.env` to the real service's URL and adjust `ModelingClient.send_images()` / `generate_images()` if its request/response shape differs from the demo's. `layout_renderer.py` (the room geometry + tiling logic) is only used by the demo service — it's irrelevant once a real 3D app is swapped in.

## Notes

- All per-run state lives in `storage/` (gitignored) — one folder per job under `storage/jobs/<job_id>/` (uploads, arranged layouts, final image, `job.json`) and the demo app's own mirror under `storage/demo3d_storage/<job_id>/`.
- No database, no auth, no queue — synchronous calls are fine at this scale (an internal POC).
