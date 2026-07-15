import random

import numpy as np
from PIL import Image, ImageDraw

from constants import DEFAULT_ROOM_DIMENSIONS, SURFACE_IDS

CANVAS_SIZE = (1200, 800)
BACKGROUND_COLOR = (217, 213, 204)
GROUT_COLOR = (222, 218, 212)
OUTLINE_COLOR = (150, 145, 135)
TILE_PX = 150
GROUT_PX = 4
TEXTURE_SIZE = (600, 600)

# Plain fills for surfaces with no tiles assigned — slightly different neutral
# shades so an empty room still reads as walls / floor rather than a flat sheet.
SURFACE_PLAIN_COLORS = {
    "back_wall": (228, 224, 216),
    "left_wall": (206, 201, 192),
    "right_wall": (214, 209, 200),
    "ground": (236, 232, 224),
}

# Perspective camera: how far in front of the room's open side the viewer
# stands (cm), and eye height as a fraction of the wall height.
CAMERA_STANDOFF_CM = 250.0
EYE_HEIGHT_RATIO = 0.6
CANVAS_MARGIN_PX = 40


def room_quads(room_dimensions: dict | None = None) -> dict:
    """Projects a room box of the given real-world size (floorWidth/floorDepth/
    wallHeight, in cm) into canvas coordinates with a one-point perspective
    camera centered on the back wall. Each quad is [top-left, top-right,
    bottom-right, bottom-left], top edge nearest the ceiling (for the floor,
    nearest the back wall), matching the texture orientation."""
    dims = {**DEFAULT_ROOM_DIMENSIONS, **(room_dimensions or {})}
    w = float(dims["floorWidth"])
    d = float(dims["floorDepth"])
    h = float(dims["wallHeight"])

    eye = EYE_HEIGHT_RATIO * h
    cam_z = d + CAMERA_STANDOFF_CM  # camera distance from the back wall

    def project(x, y, z):
        # x: 0..w along the back wall, y: 0..h up, z: 0 at the back wall,
        # d at the room's open side. Returns normalized image coordinates.
        depth = cam_z - z
        return ((x - w / 2) / depth, (eye - y) / depth)

    back = {
        "tl": project(0, h, 0), "tr": project(w, h, 0),
        "br": project(w, 0, 0), "bl": project(0, 0, 0),
    }
    front = {
        "tl": project(0, h, d), "tr": project(w, h, d),
        "br": project(w, 0, d), "bl": project(0, 0, d),
    }

    # Fit the projected box to the canvas, preserving aspect ratio.
    points = list(back.values()) + list(front.values())
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    canvas_w, canvas_h = CANVAS_SIZE
    scale = min(
        (canvas_w - 2 * CANVAS_MARGIN_PX) / (max(xs) - min(xs)),
        (canvas_h - 2 * CANVAS_MARGIN_PX) / (max(ys) - min(ys)),
    )
    offset_x = canvas_w / 2 - scale * (max(xs) + min(xs)) / 2
    offset_y = canvas_h / 2 - scale * (max(ys) + min(ys)) / 2

    def to_canvas(p):
        return (round(p[0] * scale + offset_x), round(p[1] * scale + offset_y))

    b = {k: to_canvas(p) for k, p in back.items()}
    f = {k: to_canvas(p) for k, p in front.items()}

    return {
        "back_wall": [b["tl"], b["tr"], b["br"], b["bl"]],
        "left_wall": [f["tl"], b["tl"], b["bl"], f["bl"]],
        "right_wall": [b["tr"], f["tr"], f["br"], b["br"]],
        "ground": [b["bl"], b["br"], f["br"], f["bl"]],
    }


def _find_perspective_coeffs(dest_quad, source_quad):
    """Solve for the 8 PIL PERSPECTIVE coefficients that map each point in
    dest_quad (canvas space) back to the corresponding point in source_quad
    (flat texture space) — i.e. the inverse mapping PIL's transform() expects."""
    matrix = []
    for (x, y), (sx, sy) in zip(dest_quad, source_quad):
        matrix.append([x, y, 1, 0, 0, 0, -x * sx, -y * sx])
        matrix.append([0, 0, 0, x, y, 1, -x * sy, -y * sy])
    a = np.array(matrix, dtype=float)
    b = np.array(source_quad, dtype=float).reshape(8)
    return np.linalg.solve(a, b)


def _build_tiled_texture(image_paths, size, rng, plain_color=GROUT_COLOR):
    """Randomly tiles the given marble/tile photos across a flat square texture,
    with grout lines and random rotation per tile — the same 'apply slabs
    randomly' idea as the existing 3d-modeling visualizer's tile canvas, just
    computed server-side. An unassigned surface comes back as a plain neutral fill."""
    if not image_paths:
        return Image.new("RGB", size, plain_color)
    texture = Image.new("RGB", size, GROUT_COLOR)

    cols = size[0] // TILE_PX + 2
    rows = size[1] // TILE_PX + 2
    tile_inner = TILE_PX - GROUT_PX

    for row in range(rows):
        for col in range(cols):
            src_path = rng.choice(image_paths)
            with Image.open(src_path) as im:
                tile = im.convert("RGB")
                rotation = rng.choice([0, 90, 180, 270])
                if rotation:
                    tile = tile.rotate(rotation, expand=True)
                tile = tile.resize((tile_inner, tile_inner))
            x = col * TILE_PX + GROUT_PX // 2
            y = row * TILE_PX + GROUT_PX // 2
            texture.paste(tile, (x, y))

    return texture


def render_layout(surface_images: dict, seed=None, room_dimensions: dict | None = None) -> Image.Image:
    """surface_images: surface_id -> list of image file paths. Returns a flat,
    perspective 'unfolded room' composite with each surface's marble tiles
    randomly arranged — this is the '3D modelling app's own output, produced
    without any AI model call. room_dimensions (floorWidth/floorDepth/wallHeight,
    cm) shapes the box; unset keys fall back to the default room template.
    Surfaces with no images render as a plain neutral fill, so an empty
    surface_images dict yields an empty room at the given dimensions."""
    rng = random.Random(seed)
    canvas = Image.new("RGB", CANVAS_SIZE, BACKGROUND_COLOR)
    quads = room_quads(room_dimensions)

    for surface_id in SURFACE_IDS:
        quad = quads[surface_id]
        paths = surface_images.get(surface_id) or []
        texture = _build_tiled_texture(
            paths, TEXTURE_SIZE, rng,
            plain_color=SURFACE_PLAIN_COLORS.get(surface_id, GROUT_COLOR),
        )

        src_corners = [(0, 0), (TEXTURE_SIZE[0], 0), TEXTURE_SIZE, (0, TEXTURE_SIZE[1])]
        coeffs = _find_perspective_coeffs(quad, src_corners)
        warped = texture.transform(CANVAS_SIZE, Image.PERSPECTIVE, coeffs, Image.BICUBIC)

        mask = Image.new("L", CANVAS_SIZE, 0)
        ImageDraw.Draw(mask).polygon(quad, fill=255)
        canvas.paste(warped, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    for quad in quads.values():
        draw.polygon(quad, outline=OUTLINE_COLOR, width=2)

    return canvas


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Render an empty room (no tiles) at the given real-world dimensions."
    )
    parser.add_argument("--width", type=float, default=DEFAULT_ROOM_DIMENSIONS["floorWidth"],
                        help="floor/back-wall width in cm")
    parser.add_argument("--depth", type=float, default=DEFAULT_ROOM_DIMENSIONS["floorDepth"],
                        help="floor depth in cm")
    parser.add_argument("--height", type=float, default=DEFAULT_ROOM_DIMENSIONS["wallHeight"],
                        help="wall height in cm")
    parser.add_argument("--out", default="empty_room.png", help="output image path")
    args = parser.parse_args()

    image = render_layout({}, room_dimensions={
        "floorWidth": args.width,
        "floorDepth": args.depth,
        "wallHeight": args.height,
    })
    image.save(args.out)
    print(f"Saved {args.width:g}x{args.depth:g}cm room ({args.height:g}cm walls) to {args.out}")
