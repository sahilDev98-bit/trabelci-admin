import json
import os

import requests

from constants import SURFACE_IDS


class ModelingClient:
    """HTTP client for the '3D modelling app'. Points at the local demo service
    by default; swapping to a real 3D app later is just MODELING_APP_BASE_URL."""

    def __init__(self, base_url: str, timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def send_images(
        self,
        job_id: str,
        category: str,
        assignments: dict,
        image_path_by_id: dict,
        tile_settings: dict | None = None,
        room_dimensions: dict | None = None,
    ) -> dict:
        """assignments: surface_id -> list of image_ids (a surface can hold several slab/tile photos).
        tile_settings: surface_id -> partial TileSettings (tileWidth/tileHeight/rotation/flipH/flipV/
        bookmatch/groutSize/groutColor), only sent for surfaces the caller has customized.
        room_dimensions: real-world room size in cm (floorWidth/floorDepth/wallHeight)."""
        data = {"job_id": job_id, "category": category}
        if tile_settings:
            data["tile_settings"] = json.dumps(tile_settings)
        if room_dimensions:
            data["room_dimensions"] = json.dumps(room_dimensions)
        files = []
        opened = []
        try:
            for surface_id, image_ids in assignments.items():
                if surface_id not in SURFACE_IDS or not image_ids:
                    continue
                for image_id in image_ids:
                    path = image_path_by_id.get(image_id)
                    if not path:
                        continue
                    fh = open(path, "rb")
                    opened.append(fh)
                    files.append((surface_id, (os.path.basename(path), fh)))

            resp = requests.post(
                f"{self.base_url}/sendimages",
                data=data,
                files=files,
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()
        finally:
            for fh in opened:
                fh.close()

    def generate_images(self, job_id: str) -> dict:
        resp = requests.post(
            f"{self.base_url}/generateimages",
            json={"session_id": job_id},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()


def get_modeling_client() -> ModelingClient:
    base_url = os.getenv("MODELING_APP_BASE_URL", "http://localhost:8070")
    return ModelingClient(base_url=base_url)
