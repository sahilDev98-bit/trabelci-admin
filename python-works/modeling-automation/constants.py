CATEGORIES = [
    {"id": "kitchen", "label": "Kitchen"},
    {"id": "bathroom", "label": "Bathroom"},
    {"id": "bedroom", "label": "Bedroom"},
    {"id": "commercial", "label": "Commercial Areas"},
    {"id": "shop", "label": "Shop"},
    {"id": "restaurant", "label": "Restaurant"},
    {"id": "other", "label": "Other"},
]

SURFACES = [
    {"id": "back_wall", "label": "Back Wall"},
    {"id": "left_wall", "label": "Left Wall"},
    {"id": "right_wall", "label": "Right Wall"},
    {"id": "ground", "label": "Ground"},
]

CATEGORY_IDS = {c["id"] for c in CATEGORIES}
SURFACE_IDS = {s["id"] for s in SURFACES}
CATEGORY_LABELS = {c["id"]: c["label"] for c in CATEGORIES}
SURFACE_LABELS = {s["id"]: s["label"] for s in SURFACES}

# Mirrors the 3D app's DEFAULT_TILE_SETTINGS (src/store/useStore.ts) so the
# workflow's per-surface controls start from the same defaults it would.
DEFAULT_TILE_SETTINGS = {
    "tileWidth": 120,
    "tileHeight": 120,
    "rotation": 0,
    "flipH": False,
    "flipV": False,
    "bookmatch": "off",
    "groutSize": 1,
    "groutColor": "#dedad4",
}

# Mirrors the 3D app's default room template (Living Room, src/rooms/roomTemplates.ts)
# — used to pre-fill the workflow's Room Dimensions fields before staff override them.
DEFAULT_ROOM_DIMENSIONS = {
    "floorWidth": 720,
    "floorDepth": 600,
    "wallHeight": 300,
}

BOOKMATCH_MODES = [
    {"id": "off", "label": "Off"},
    {"id": "horizontal", "label": "H"},
    {"id": "vertical", "label": "V"},
    {"id": "quad", "label": "Quad"},
]
