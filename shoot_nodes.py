"""PerfectLab shoot composers -- Pose, Expression, Camera.

Each owns one shoot parameter and speaks the same list language as the rest
of the kit: walk the library, or pin one value, and output one entry per
shot. The Shot Series consumes whatever is wired per shot index and leaves
the slot empty when nothing is wired -- one writer per slot, zero hidden
libraries inside the connector.

Camera packs the three framing-related parameters: framing (crop), focus
(where the attention sits) and format (aspect ratio; "follows framing" keeps
the tier coupling). Each section walks or pins independently.
"""

import json
import math
import os

POSES = [
    "standing relaxed",
    "leaning against a wall",
    "sitting on a stool",
    "walking toward the camera",
    "arms crossed",
    "hands in pockets",
    "looking over the shoulder",
    "sitting on the floor, knees up",
    "stretching arms overhead",
    "crouching low",
    "lying on the grass",
    "mid-step turn",
    "adjusting their hair",
    "holding a coffee cup",
    "back to the camera",
    "reaching out toward the lens",
    "one hand on the hip",
    "leaning on a railing, looking into the distance",
    "sitting sideways on steps",
    "walking away, glancing back",
    "twisting the torso toward the camera",
    "leaning toward the camera with hands framing the face",
    "jumping mid-air, hair flying",
    "squatting on tiptoes",
    "sitting cross-legged on the ground",
    "lying on the stomach, propped on the elbows",
    "leaning against a car door",
    "brim of a hat pulled down with one hand",
    "knee up on a bench, arms wrapped around it",
    "shoulder against the wall, head tilted",
    "blowing a kiss toward the camera",
    "spinning on the spot, skirt in motion",
    "holding a steaming cup of coffee with both hands",
    "holding a waffle cone with one hand",
    "taking a selfie at night with city lights",
    "holding a jacket open with both hands, hood up",
]

EXPRESSIONS = [
    "laughing out loud, wide open mouth, crinkled joyful eyes",
    "soft closed-lip smile, cheeks gently raised",
    "biting her lower lip, heavy-lidded eyes",
    "one eyebrow raised, a crooked half-smile",
    "winking one eye, a cheeky asymmetric grin",
    "gasping in surprise, wide round eyes, lips parted",
    "furrowed brows, a cold hard stare",
    "wide-eyed wonder, lips slightly parted",
    "eyes closed, face tilted into the light, calm brow",
    "smirking from the corner of the mouth",
    "a daydreaming gaze past the camera, soft unfocused eyes",
    "an exaggerated pout, big pleading eyes",
    "a squinting toothy grin",
    "lips pressed together, looking away pensively",
    "a sharp sideways glance, chin slightly down",
    "blowing a kiss, lips puckered",
    "a hand covering the mouth in a surprised gasp",
    "a tired soft gaze, heavy-lidded relaxed eyes",
    "a tongue-in-cheek grin",
    "chin up, steady direct eye contact",
    "a shy smile, eyes flicked down",
    "a fierce glare, jaw set, nostrils flared",
    "a serene still expression, a soft direct gaze",
    "an excited open-mouth smile, eyebrows high",
    "a skeptical squint, one eye narrowed",
    "a distant melancholic stare, mouth relaxed",
    "a curious head tilt, brows raised, a small smile",
    "a steely determined look, jaw tight, eyes narrow",
]

FRAMINGS = ["extreme close-up", "close-up", "portrait shot", "medium shot",
            "cowboy shot", "full body shot", "wide shot"]
FOCUS = ["the face", "the eyes", "the outfit", "the hands", "the full figure",
         "the silhouette", "the background mood", "the hair movement",
         "the shoes", "the jewelry", "the profile line", "the lips"]
FORMATS = ["follows framing", "1:1", "4:5", "3:4", "2:3", "9:16", "3:2", "16:9"]

# Emotional arcs: named keypoint sequences over EXPRESSIONS indices, one
# curve per dramaturgy -- a session that starts calm and peaks instead of a
# flat walk. Resampled to the session length, so any count keeps the arc's
# shape (a 5-shot session still ends on the climax). Mirrors ARC_LIB in
# web/perfectlab_lib.js -- edit both together.
ARCS = {
    "quiet to climax": [22, 26, 1, 3, 23, 0],
    "slow burn":       [13, 10, 14, 26, 9, 2],
    "first date":      [20, 26, 18, 4, 2, 15],
    "joy run":         [20, 1, 26, 12, 23, 0],
    "cold front":      [22, 19, 24, 6, 27, 21],
    "melancholy fade": [17, 10, 13, 25, 22, 8],
    "story wave":      [8, 22, 26, 3, 5, 23, 0, 12, 15, 2, 25, 17],
}

# The same curves as energy, 0..1 per keypoint: how charged the dramaturgy
# is at that point. The Shot Series reads it off the ARC LEVEL output and
# bends its light line along it -- a serene opening reads better with soft
# light, a climax wants punch. Mirrors ARC_LEVELS in web/perfectlab_lib.js.
ARC_LEVELS = {
    "quiet to climax": [0.05, 0.25, 0.45, 0.65, 0.85, 1.0],
    "slow burn":       [0.1, 0.2, 0.4, 0.6, 0.85, 1.0],
    "first date":      [0.15, 0.3, 0.5, 0.7, 0.9, 1.0],
    "joy run":         [0.4, 0.5, 0.65, 0.8, 0.9, 1.0],
    "cold front":      [0.25, 0.4, 0.55, 0.75, 0.9, 1.0],
    "melancholy fade": [0.85, 0.7, 0.5, 0.35, 0.2, 0.05],
    "story wave":      [0.1, 0.3, 0.5, 0.75, 0.95, 1.0, 0.75, 0.55, 0.7, 0.9, 0.4, 0.1],
}


# The user's own dramaturgies: userdata/perfectlab_arcs.json, one object of
# {"name": {"kp": [expression indices], "lv": [energy 0..1]}}. Entries
# merge over ARCS and ARC_LEVELS -- a user entry under a built-in name
# replaces it, a new name joins the panel's picker. Keypoints reference the
# 28 library expressions by index, two to twelve of them, with lv the same
# length; anything malformed is skipped, and an unreadable file leaves the
# code arcs in charge. The file is re-read when its mtime moves, so edits
# land without a restart.
_ARC_CACHE = {"mtime": None, "seq": None, "lv": None}


def _user_arcs_path():
    """the current user's perfectlab_arcs.json, walking up to the ComfyUI
    userdata tree the same way the panel's /userdata fetches resolve"""
    here = os.path.dirname(os.path.realpath(__file__))
    for _ in range(5):
        here = os.path.dirname(here)
        for cand in ("user/default/userdata", "userdata"):
            d = os.path.join(here, cand)
            if os.path.isdir(d):
                return os.path.join(d, "perfectlab_arcs.json")
    return None


def _arc_tables():
    path = _user_arcs_path()
    mtime = None
    if path:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = None
    if _ARC_CACHE["mtime"] == mtime and _ARC_CACHE["seq"] is not None:
        return _ARC_CACHE["seq"], _ARC_CACHE["lv"]
    seq = dict(ARCS)
    lv = dict(ARC_LEVELS)
    if mtime is not None:
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (ValueError, OSError):
            data = None
        if isinstance(data, dict):
            for name, spec in data.items():
                if not (isinstance(name, str) and name.strip() and isinstance(spec, dict)):
                    continue
                kp = spec.get("kp")
                lvs = spec.get("lv")
                if not (isinstance(kp, list) and isinstance(lvs, list)
                        and 2 <= len(kp) <= 12 and len(kp) == len(lvs)):
                    continue
                if not all(isinstance(x, int) and not isinstance(x, bool)
                           and 0 <= x < len(EXPRESSIONS) for x in kp):
                    continue
                if not all(isinstance(x, (int, float)) and not isinstance(x, bool)
                           and 0.0 <= x <= 1.0 for x in lvs):
                    continue
                seq[name.strip()] = [int(x) for x in kp]
                lv[name.strip()] = [float(x) for x in lvs]
    _ARC_CACHE.update(mtime=mtime, seq=seq, lv=lv)
    return seq, lv


def arc_seq(arc, count):
    """one expression per shot along the arc; keypoints resample proportionally.
    Half-up rounding to match Math.round in the JS mirror exactly."""
    kp = _arc_tables()[0].get(arc)
    if not kp:
        return []
    if count <= 1:
        return [EXPRESSIONS[kp[0]]]
    return [EXPRESSIONS[kp[math.floor(i * (len(kp) - 1) / (count - 1) + 0.5)]] for i in range(count)]


def arc_levels(arc, count):
    """the arc's energy per shot, 0..1, resampled with the same proportional
    formula as arc_seq so the curve and its tone stay in step. No arc picked
    (or an unknown name) reads as a flat 0.5 -- the neutral middle that never
    touches the light line."""
    lv = _arc_tables()[1].get(arc)
    if not lv:
        return [0.5] * max(1, count)
    if count <= 1:
        return [lv[0]]
    return [lv[math.floor(i * (len(lv) - 1) / (count - 1) + 0.5)] for i in range(count)]


def _stride(n, salt):
    if n <= 1:
        return 1
    k = 2 + (salt % 7)
    while math.gcd(k, n) != 1:
        k += 1
    return k


def walk_list(items, sel, count, seed, salt):
    """one entry per shot. sel is the panel state: {mode: all|multi|pin,
    set: [idx], pin: idx} -- walk everything, a chosen subset, or one pin."""
    items = [i for i in items if isinstance(i, str) and i.strip()] or [""]
    n = len(items)
    if isinstance(sel, (int, float)):
        sel = {"mode": "pin", "pin": int(sel)}
    sel = sel if isinstance(sel, dict) else {}
    mode = sel.get("mode", "all")
    if mode == "pin" and sel.get("pin") is not None:
        pin = int(sel["pin"]) % n
        return [items[pin]] * count
    if mode == "multi" and sel.get("set"):
        set_ = [int(x) % n for x in sel["set"] if isinstance(x, (int, float))]
        if set_:
            return [items[set_[i % len(set_)]] for i in range(count)]
    return [items[(i * _stride(n, salt)) % n] for i in range(count)]


def _sel(state, key):
    v = state.get(key)
    if isinstance(v, (int, float)):
        return {"mode": "pin", "pin": int(v)}
    if isinstance(v, dict):
        if "mode" not in v and v.get("pin") is not None:
            return {"mode": "pin", "pin": v["pin"]}
        return v
    # legacy top-level pin widgets (framing_pin / pin)
    legacy = state.get(key + "_pin")
    if legacy is None and key == "formats":
        legacy = state.get("format_pin")
    if legacy is None and key == "framings":
        legacy = state.get("framing_pin")
    if legacy is None and key == "focus":
        legacy = state.get("focus_pin")
    if legacy is None:
        legacy = state.get("pin")
    if isinstance(legacy, (int, float)):
        return {"mode": "pin", "pin": int(legacy)}
    return {}


def _read(data):
    try:
        state = json.loads(data or "{}")
        return state if isinstance(state, dict) else {}
    except (ValueError, TypeError):
        return {}


def _customs(state, key):
    c = state.get("custom") or {}
    v = c.get(key) if isinstance(c, dict) else None
    return v if isinstance(v, list) else []


class PerfectLabPose:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "pose_data": ("STRING", {"default": "{}", "multiline": False}),
            "count": ("INT", {"default": 12, "min": 1, "max": 100}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
        }}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("poses",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "One pose per shot: walk the 32-pose library, shoot a selected subset, or pin a single pose. Wire into the Shot Series poses slot."

    def build(self, pose_data=None, count=12, seed=0):
        state = _read(pose_data)
        items = POSES + [c for c in _customs(state, "poses") if c.strip()]
        return (walk_list(items, _sel(state, "poses"), int(count), int(seed), 1),)


class PerfectLabExpression:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "expression_data": ("STRING", {"default": "{}", "multiline": False}),
            "count": ("INT", {"default": 12, "min": 1, "max": 100}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
        }}

    RETURN_TYPES = ("STRING", "FLOAT")
    RETURN_NAMES = ("expressions", "arc_level")
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = ("One facial action per shot, phrased as physical muscle actions -- abstract "
                   "mood words render as the same resting face. Optional dramaturgy arcs bend "
                   "the walk into a curve: calm first shots that build to a climax, or your own "
                   "curve saved in userdata/perfectlab_arcs.json. The ARC LEVEL "
                   "output carries the arc's energy per shot (0..1) -- wire it into the Shot Series "
                   "and the light line bends along it (quiet shots read softer, climaxes punchier); "
                   "with pose_arc on the pose follows the same energy, with place_arc on the "
                   "placement moves within the crop's legal set, with crop_arc on the crop "
                   "itself rides the energy, with focus_arc on the eye is drawn onto the person "
                   "at a climax and off her at quiet points. With no arc picked "
                   "it stays a flat 0.5 and nothing changes.")

    def build(self, expression_data=None, count=12, seed=0):
        n = max(1, int(count))
        state = _read(expression_data)
        arc = state.get("arc")
        if isinstance(arc, str) and arc in _arc_tables()[0]:
            return (arc_seq(arc, n), arc_levels(arc, n))
        items = EXPRESSIONS + [c for c in _customs(state, "expressions") if c.strip()]
        return (walk_list(items, _sel(state, "expressions"), n, int(seed), 2), [0.5] * n)


class PerfectLabCamera:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "camera_data": ("STRING", {"default": "{}", "multiline": False}),
            "count": ("INT", {"default": 12, "min": 1, "max": 100}),
            "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
        }}

    RETURN_TYPES = ("STRING", "STRING", "STRING")
    RETURN_NAMES = ("framings", "focus", "formats")
    OUTPUT_IS_LIST = (True, True, True)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "Three shot parameters as lists: framing (seven crops), focus (twelve attention points) and format ('follows framing' keeps the aspect ratio coupled to the crop). Wire into the framings / focus / formats slots of the Shot Series."

    def build(self, camera_data=None, count=12, seed=0):
        state = _read(camera_data)
        framings = FRAMINGS + [c for c in _customs(state, "framings") if c.strip()]
        focus = FOCUS + [c for c in _customs(state, "focus") if c.strip()]
        formats = FORMATS + [c for c in _customs(state, "formats") if c.strip()]
        sel_f = _sel(state, "framings")
        if state.get("framing_order") == "wide-to-close" and sel_f.get("mode", "all") == "all" and not sel_f.get("set"):
            # dramaturgy: the session opens wide and ends on the closest crop
            order = list(range(len(framings)))[::-1]
            f = [framings[order[i % len(order)]] for i in range(int(count))]
        else:
            f = walk_list(framings, sel_f, int(count), int(seed), 0)
        fo = walk_list(focus, _sel(state, "focus"), int(count), int(seed), 3)
        fm = walk_list(formats, _sel(state, "formats"), int(count), int(seed), 4)
        return (f, fo, fm)


NODE_CLASS_MAPPINGS = {
    "PerfectLabPose": PerfectLabPose,
    "PerfectLabExpression": PerfectLabExpression,
    "PerfectLabCamera": PerfectLabCamera,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PerfectLabPose": "🧪 PerfectLab – Pose",
    "PerfectLabExpression": "🧪 PerfectLab – Expression",
    "PerfectLabCamera": "🧪 PerfectLab – Camera",
}
