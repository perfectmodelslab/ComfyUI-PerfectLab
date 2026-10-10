"""PerfectLab Shot Series: the session engine.

The Series owns the SESSION -- count, seed, template, quality -- and walks
every creative feed the Studio config hands it:

    person, persona_data   (who; owns the hair)
    wardrobe               (outfits, walked in blocks)
    scene                  (where)
    Light     -> light                  (one light writer)
    Style     -> style                  (grade and film)
    Pose      -> poses                  (one pose per shot)
    Expression-> expressions            (one face action per shot)
    Camera    -> framings, focus, formats

A wired slot is consumed per shot index (shorter lists cycle); an unwired
slot resolves empty in the template. Wardrobe looks walk in blocks and the
framing walk restarts per look, so each outfit is shot wide and close.

The composition engine re-weights the description per framing: close shots
keep the face and drop footwear and far placements; wide shots keep the
figure with the proportions written into the framing itself; shoe macros
drop to floor level; back-to-camera poses strip the facial tokens, and the
focus and the aspect ratio are filtered against the crop so a wide shot
never focuses on the lips and a close crop never lands in 16:9. With
mood_subject on, the expression rides the persona's lead clause instead of
standing in its own sentence after the framing. And when the Expression
node's ARC LEVEL output is wired in, the arc's energy bends the session
along the dramaturgy: quiet shots read the light line's intensity words
softer, climax shots push them bolder -- with pose_arc on the same energy
pulls the pose, swapping a contradiction for a compatible entry from the
wired feed, with place_arc on it moves the placement, a distant speck
at a climax traded for a dominating stance (the crop's law still wins: a
close framing keeps near placements only), with crop_arc on the crop
itself rides the energy: a climax tightens it, a quiet point lets it
breathe wider, swapped within the framings the camera feed walks, and
with focus_arc on the focus follows too: a climax draws the eye onto the
person, a quiet point lets it drift off her, swapped within the feed --
never onto a face a wide framing or a back view cannot carry. The tone
swap table itself is user-extensible: entries in
userdata/perfectlab_tone.json merge over the built-in one, and
userdata/perfectlab_energy.json re-tunes the energies every coupling
swaps by. Each shot's META carries the arc level and those energies, so
the CSV export doubles as calibration material for the file. With
takes_arc on the arc leads the take budget too: quiet points render
once, climaxes get the full stack to pick from, the build-up keeps one
spare -- the same bands the light tone reads.

Outputs are lists: PROMPT, WIDTH, HEIGHT, SEED -- plus META, one JSON per
shot for contact cards and overlays.
"""

import json
import math
import os
import re

# label, detail tier -- wider shots read better with a shorter person block
TIERS = {
    "extreme close-up": "close",
    "close-up": "close",
    "portrait shot": "close",
    "profile shot": "close",
    "medium shot": "medium",
    "cowboy shot": "medium",
    "over-the-shoulder shot": "medium",
    "low-angle shot": "medium",
    "high-angle shot": "medium",
    "dutch-angle shot": "medium",
    "full body shot": "figure",
    "wide shot": "figure",
}

RATIOS = {
    "1:1": 1.0,
    "4:5": 0.8,
    "3:4": 0.75,
    "2:3": 2.0 / 3.0,
    "9:16": 0.5625,
    "3:2": 1.5,
    "16:9": 16.0 / 9.0,
}

TIER_RATIOS = {
    "close": "1:1",
    "medium": "4:5",
    "figure": "2:3",
}

# which ratios a tier can carry at all. A close crop in 16:9 fills the rest of
# the frame with a second full-length figure; a wide shot in 9:16 has no room
# for the environment it is supposed to show. A formats feed that repeats one
# value is a pin and passes through unfiltered -- the user asked for it.
TIER_FORMATS = {
    "close": ("1:1", "4:5", "3:4", "2:3"),
    "medium": ("4:5", "3:4", "2:3", "1:1"),
    "figure": ("2:3", "3:4", "9:16", "4:5", "16:9"),
}

PIXEL_BUDGET = 1_572_864  # ~1.5 MP; width/height are scaled to fit this area

# how far a take's seed sits from the shot's own seed: a take re-renders the
# same plan under new noise, and the panel's re-shoot counts takes from the
# last one the session rendered, so every take index maps to one seed
TAKE_STRIDE = 7919

PLACEMENTS = [
    "centered in frame",
    "on the left third",
    "on the right third",
    "close to the camera",
    "deep in the scene",
    "framed by the surroundings",
    "slightly off-center, looking into the empty space",
    "dominating the lower half of the frame",
]

# placements that contradict a tight crop: a person "deep in the scene" in an
# extreme close-up makes the model paint her twice
NEAR_PLACEMENTS = {"centered in frame", "on the left third", "on the right third",
                   "close to the camera"}

MACRO_SHOES = ("extreme close-up macro shot at floor level, camera focused tightly on the "
               "shoes and ankles, low angle")

# framing labels with their camera-side wording. The bare label leaves the
# proportioning to the person block -- and a wide shot without explicit
# negative space loses frame area to a long description, so every framing
# past the portrait carries its own space note. Custom framings fall back to
# the label itself.
FRAMING_TEXTS = {
    "extreme close-up": "extreme close-up shot",
    "close-up": "close-up shot",
    "portrait shot": "portrait shot, head and shoulders",
    "profile shot": ("profile shot, exact side view, the contour of the face "
                     "drawing the frame"),
    "over-the-shoulder shot": ("over-the-shoulder shot, the camera just behind "
                               "her shoulder, her face and the far scene visible"),
    "low-angle shot": ("low-angle shot, the camera below eye level looking up, "
                       "a heroic perspective, sky or ceiling behind the figure"),
    "high-angle shot": ("high-angle shot, the camera above eye level looking "
                        "down, the ground visible behind the figure"),
    "dutch-angle shot": ("dutch-angle shot, the camera tilted, a dynamic "
                         "diagonal horizon"),
    "medium shot": ("medium shot, waist up, natural head-to-body proportions, "
                    "visible space around the subject"),
    "cowboy shot": ("cowboy shot, from mid-thigh up, realistic head-to-body "
                    "proportions, clear space around the figure"),
    "full body shot": ("full body shot, entire figure visible head to toe, "
                       "realistic head-to-body proportions with a proportionally small head"),
    "wide shot": ("environmental wide establishing shot, the figure small in the "
                  "middle ground, ample negative space, realistic proportions"),
}

# focus points that name the face. Invisible on a wide shot, yet they still
# load the prompt with face tokens and pull the composition onto the head;
# a back view cannot carry them either -- the pose already dropped the
# expression for the same reason.
FACE_FOCUS = frozenset(("the face", "the eyes", "the lips", "the profile line"))
TIER_FALLBACK_FOCUS = {"close": "the face", "medium": "the face", "figure": "the full figure"}

# Arc-driven light tone. The dramaturgy's energy per shot (ARC LEVEL from the
# Expression node) bends the light line's intensity words: at a quiet point
# the hot words read softer, at a climax the calm ones harden. Swaps, not
# appends -- the Light node's phrasing stays the source of truth, only its
# adjectives move, so the bend never fights the setup it describes. A word
# with no calm half simply stays calm; a word with no bold half stays bold.
# Keys are [a-z ]+ only -- the joined pattern needs no escaping (mirrors
# LIGHT_TONE_SWAPS in web/perfectlab_lib.js, order included: the alternation
# prefers the first key, so both sides must list them identically).
LIGHT_TONE_SWAPS = {
    "hard lighting": ("soft lighting", "hard lighting"),
    "strong highlights": ("gentle highlights", "strong highlights"),
    "sharp deep shadows": ("soft open shadows", "sharp deep shadows"),
    "high contrast": ("low contrast", "high contrast"),
    "vivid colors": ("muted colors", "vivid colors"),
    "bright exposure": ("balanced exposure", "bright exposure"),
    "dramatic lighting": ("understated lighting", "dramatic lighting"),
    "moody atmosphere": ("calm atmosphere", "moody atmosphere"),
    "dark surroundings": ("hushed surroundings", "dark surroundings"),
    "mysterious vibe": ("quiet vibe", "mysterious vibe"),
    "mystery mood": ("serene mood", "mystery mood"),
    "direct sunlight": ("filtered sunlight", "direct sunlight"),
    "dim lighting": ("dim lighting", "dramatic lighting"),
    "low contrast": ("low contrast", "high contrast"),
    "soft contrast": ("soft contrast", "strong contrast"),
    "soft shadows": ("soft shadows", "hard shadows"),
    "muted colors": ("muted colors", "vivid colors"),
    "diffuse illumination": ("diffuse illumination", "sculpted illumination"),
    "airy atmosphere": ("airy atmosphere", "electric atmosphere"),
    "balanced exposure": ("balanced exposure", "bold exposure"),
}
QUIET_BAND = 0.34
BOLD_BAND = 0.66

# How much motion each library pose carries, 0..1 -- the same scale the
# arc's energy speaks. A pose contradicting the arc's point at that shot (a
# jump at a serene opening, a slump at a climax) is swapped for a
# compatible entry from the wired feed; the neutral middle stays put, the
# same way a tone word without a calm half stays calm. A custom pose reads
# as the 0.5 middle until the user gives it an energy of its own in
# userdata/perfectlab_energy.json. Mirrors POSE_ENERGY in
# web/perfectlab_lib.js.
POSE_ENERGY = {
    "standing relaxed": 0.1,
    "leaning against a wall": 0.15,
    "sitting on a stool": 0.1,
    "walking toward the camera": 0.5,
    "arms crossed": 0.2,
    "hands in pockets": 0.15,
    "looking over the shoulder": 0.4,
    "sitting on the floor, knees up": 0.1,
    "stretching arms overhead": 0.55,
    "crouching low": 0.45,
    "lying on the grass": 0.1,
    "mid-step turn": 0.6,
    "adjusting their hair": 0.3,
    "holding a coffee cup": 0.15,
    "back to the camera": 0.2,
    "reaching out toward the lens": 0.8,
    "one hand on the hip": 0.45,
    "leaning on a railing, looking into the distance": 0.2,
    "sitting sideways on steps": 0.15,
    "walking away, glancing back": 0.5,
    "twisting the torso toward the camera": 0.7,
    "leaning toward the camera with hands framing the face": 0.6,
    "jumping mid-air, hair flying": 1.0,
    "squatting on tiptoes": 0.55,
    "sitting cross-legged on the ground": 0.1,
    "lying on the stomach, propped on the elbows": 0.1,
    "leaning against a car door": 0.2,
    "brim of a hat pulled down with one hand": 0.4,
    "knee up on a bench, arms wrapped around it": 0.15,
    "shoulder against the wall, head tilted": 0.2,
    "blowing a kiss toward the camera": 0.75,
    "spinning on the spot, skirt in motion": 0.95,
}

# How much stage presence each placement carries, 0..1 -- the same scale
# the arc's energy speaks. A placement contradicting the arc's point at
# that shot (a distant speck at a climax, a dominating stance over a quiet
# opening) is swapped for a compatible one from the same library list; the
# rule-of-thirds slots are neutral geometry and never move, the same way a
# pose in the middle band stays put. Mirrors PLACEMENT_ENERGY in
# web/perfectlab_lib.js.
PLACEMENT_ENERGY = {
    "centered in frame": 0.3,
    "on the left third": 0.45,
    "on the right third": 0.45,
    "close to the camera": 0.8,
    "deep in the scene": 0.15,
    "framed by the surroundings": 0.2,
    "slightly off-center, looking into the empty space": 0.25,
    "dominating the lower half of the frame": 0.9,
}

# How much air each framing lets into the frame, 0..1 -- the same scale
# the arc's energy speaks, read crop-wise: tight crops hold attention,
# wide ones let the scene breathe. A crop contradicting the arc's point
# at that shot (a speck-in-the-landscape wide at a climax, an extreme
# close-up over a quiet opening) is swapped for a compatible entry from
# the camera feed; the middle framings stay put. A custom framing reads
# as the 0.5 middle until the user gives it an openness of its own in
# userdata/perfectlab_energy.json (the "framings" section). Mirrors
# FRAMING_OPENNESS in web/perfectlab_lib.js.
FRAMING_OPENNESS = {
    "extreme close-up": 0.0,
    "close-up": 0.15,
    "portrait shot": 0.3,
    "profile shot": 0.35,
    "medium shot": 0.5,
    "dutch-angle shot": 0.5,
    "over-the-shoulder shot": 0.45,
    "low-angle shot": 0.6,
    "high-angle shot": 0.6,
    "cowboy shot": 0.65,
    "full body shot": 0.85,
    "wide shot": 1.0,
}

# How intimately each focus point pins the subject, 0..1 -- the same
# scale the arc's energy speaks. A focus contradicting the arc's point
# at that shot (a wallpaper read at a climax, the lips pinned over a
# quiet opening) is swapped for a compatible entry from the camera's
# focus feed; the middle band stays put. The crop's law still wins: a
# face focus never lands on a wide framing or a back view, so the swap
# pool is filtered by the same rules _focus_for_shot applies after it. A
# custom focus is not ours to move until the user gives it an intimacy
# of its own in userdata/perfectlab_energy.json (the "focuses" section).
# Mirrors FOCUS_INTIMACY in web/perfectlab_lib.js.
FOCUS_INTIMACY = {
    "the lips": 1.0,
    "the eyes": 0.9,
    "the face": 0.8,
    "the profile line": 0.7,
    "the jewelry": 0.6,
    "the hair movement": 0.55,
    "the hands": 0.5,
    "the outfit": 0.45,
    "the full figure": 0.3,
    "the shoes": 0.2,
    "the silhouette": 0.1,
    "the background mood": 0.0,
}

# The user's tone overrides: userdata/perfectlab_tone.json, one object of
# {"word": ["calm read", "bold read"]}. Entries merge over LIGHT_TONE_SWAPS
# -- the same key keeps its place in the order (the joined pattern prefers
# the first key), a new key appends. Keys are lowercase letters and spaces
# only, both halves non-empty; anything else is skipped, and an unreadable
# file leaves the code table in charge. The file is re-read when its mtime
# moves, so edits land without a restart.
_TONE_KEY_OK = re.compile(r"[a-z ]+")
_TONE_CACHE = {"mtime": None, "table": None, "re": None}


def _user_tone_path():
    """the current user's perfectlab_tone.json, walking up to the ComfyUI
    userdata tree the same way the panel's /userdata fetches resolve"""
    here = os.path.dirname(os.path.realpath(__file__))
    for _ in range(5):
        here = os.path.dirname(here)
        for cand in ("user/default/userdata", "userdata"):
            d = os.path.join(here, cand)
            if os.path.isdir(d):
                return os.path.join(d, "perfectlab_tone.json")
    return None


def _tone_tables():
    path = _user_tone_path()
    mtime = None
    if path:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = None
    if _TONE_CACHE["mtime"] == mtime and _TONE_CACHE["table"] is not None:
        return _TONE_CACHE["table"], _TONE_CACHE["re"]
    merged = dict(LIGHT_TONE_SWAPS)
    if mtime is not None:
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (ValueError, OSError):
            data = None
        if isinstance(data, dict):
            for k, v in data.items():
                if (_TONE_KEY_OK.fullmatch(k) and isinstance(v, list) and len(v) == 2
                        and all(isinstance(x, str) and x for x in v)):
                    merged[k] = (v[0], v[1])
    rx = re.compile("|".join(merged), re.I)
    _TONE_CACHE.update(mtime=mtime, table=merged, re=rx)
    return merged, rx


# The user's energy overrides: userdata/perfectlab_energy.json, one object
# of {"poses": {...}, "placements": {...}, "framings": {...},
# "focuses": {...}}. Entries merge over POSE_ENERGY, PLACEMENT_ENERGY,
# FRAMING_OPENNESS and FOCUS_INTIMACY -- a custom library pose gets an
# energy of its own and starts travelling along the arc, a built-in entry
# can be re-tuned in place, a custom framing gets an openness and starts
# riding the crop coupling, a custom focus gets an intimacy and starts
# following the focus coupling. Values are numbers 0..1 keyed by the
# exact entry text; anything else is skipped, and an unreadable file
# leaves the code tables in charge. The file is re-read when its mtime
# moves, so edits land without a restart.
_ENERGY_CACHE = {"mtime": None, "poses": None, "placements": None, "framings": None,
                 "focuses": None, "u_poses": set(), "u_places": set(),
                 "u_frames": set(), "u_focuses": set()}


def _user_energy_path():
    """the current user's perfectlab_energy.json, walking up to the ComfyUI
    userdata tree the same way the panel's /userdata fetches resolve"""
    here = os.path.dirname(os.path.realpath(__file__))
    for _ in range(5):
        here = os.path.dirname(here)
        for cand in ("user/default/userdata", "userdata"):
            d = os.path.join(here, cand)
            if os.path.isdir(d):
                return os.path.join(d, "perfectlab_energy.json")
    return None


def _energy_tables():
    path = _user_energy_path()
    mtime = None
    if path:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            mtime = None
    if _ENERGY_CACHE["mtime"] == mtime and _ENERGY_CACHE["poses"] is not None:
        return (_ENERGY_CACHE["poses"], _ENERGY_CACHE["placements"],
                _ENERGY_CACHE["framings"], _ENERGY_CACHE["focuses"])
    poses_e = dict(POSE_ENERGY)
    places_e = dict(PLACEMENT_ENERGY)
    frames_e = dict(FRAMING_OPENNESS)
    focuses_e = dict(FOCUS_INTIMACY)
    u_poses, u_places, u_frames, u_focuses = set(), set(), set(), set()
    if mtime is not None:
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (ValueError, OSError):
            data = None
        if isinstance(data, dict):
            for key, table, user_keys in (("poses", poses_e, u_poses),
                                          ("placements", places_e, u_places),
                                          ("framings", frames_e, u_frames),
                                          ("focuses", focuses_e, u_focuses)):
                part = data.get(key)
                if isinstance(part, dict):
                    for k, v in part.items():
                        if (isinstance(k, str) and k.strip()
                                and isinstance(v, (int, float)) and not isinstance(v, bool)
                                and 0.0 <= v <= 1.0):
                            table[k] = float(v)
                            user_keys.add(k)
    _ENERGY_CACHE.update(mtime=mtime, poses=poses_e, placements=places_e,
                         framings=frames_e, focuses=focuses_e,
                         u_poses=u_poses, u_places=u_places,
                         u_frames=u_frames, u_focuses=u_focuses)
    return poses_e, places_e, frames_e, focuses_e


def _user_energy_keys():
    """which entries the user's file actually set -- the answer to "whose
    swap was it": a replacement whose energy the user tuned moved because
    of their table, and the calibration file should own its swaps in the
    sheet and the CSV. Shares the cache _energy_tables fills, so a fresh
    file is picked up on the same mtime re-read; an absent or broken file
    leaves the sets empty and every swap reads as built-in."""
    _energy_tables()
    return (_ENERGY_CACHE["u_poses"], _ENERGY_CACHE["u_places"],
            _ENERGY_CACHE["u_frames"], _ENERGY_CACHE["u_focuses"])


def _tone_light(line, side):
    """read the light line at the arc's quiet (side 0) or bold (side 1) point.
    Single pass over the line, so a flipped word is never flipped back by its
    own counterpart ('high contrast' -> 'low contrast' stays flipped even
    though 'low contrast' is itself a key)."""
    table, rx = _tone_tables()
    hits = [0]

    def _sub(m):
        hits[0] += 1
        return table[m.group(0).lower()][side]

    return rx.sub(_sub, line), hits[0]


def _takes_for_level(lvl, budget):
    """how many takes this shot renders when the arc leads the budget.
    Reads the same bands as the light tone -- a quiet point is certain
    enough to render once, a climax wants the full stack to pick from,
    the build-up keeps one spare. The numbering stays take-by-shot, so
    a re-shoot continues after whatever the shot actually rendered.
    Mirrors takeLadder in web/perfectlab_lib.js."""
    budget = max(1, min(4, int(budget or 1)))
    if lvl <= QUIET_BAND:
        return 1
    if lvl >= BOLD_BAND:
        return budget
    return 2 if budget >= 2 else 1


def _placement_for_level(placement, lvl, i, near_only):
    """swap a placement that fights the arc's energy for a compatible one
    from the library list: a dominating stance over a quiet opening reads
    blown, a distant speck at a climax undersells it. The replacement comes
    from the same list the walk uses -- nothing is invented -- and the pick
    is index-stable, so the same session always composes the same plan. A
    close tier restricts the pool to its near placements (the crop's law
    outranks the dramaturgy); the thirds are neutral geometry and never
    move at all."""
    places_e = _energy_tables()[1]
    pe = places_e.get(placement, 0.5)
    if lvl <= QUIET_BAND and pe >= BOLD_BAND:
        pool = [p for p in PLACEMENTS if places_e.get(p, 0.5) <= QUIET_BAND]
    elif lvl >= BOLD_BAND and pe <= QUIET_BAND:
        pool = [p for p in PLACEMENTS if places_e.get(p, 0.5) >= BOLD_BAND]
    else:
        return placement, False
    if near_only:
        pool = [p for p in pool if p in NEAR_PLACEMENTS]
    if not pool:
        return placement, False
    return pool[i % len(pool)], True


def _framing_for_level(framings_l, framing, lvl, i):
    """swap a crop that fights the arc's energy for a compatible one from
    the same camera feed: a climax reads blown on a speck-in-the-landscape
    wide, a quiet opening overpromises on an extreme close-up. The
    replacement keeps the feed's own labels -- nothing is invented -- and
    the pick is index-stable, so the same session always composes the same
    plan. The tier moves with it, so focus, format, placement and persona
    re-weighting all follow the crop the arc chose; a custom framing is
    not ours to move and reads as the neutral middle."""
    frames_e = _energy_tables()[2]
    fe = frames_e.get(framing)
    if fe is None:
        return framing, False
    if lvl <= QUIET_BAND and fe <= QUIET_BAND:
        pool = [f for f in framings_l if frames_e.get(f, 0.5) >= BOLD_BAND]
    elif lvl >= BOLD_BAND and fe >= BOLD_BAND:
        pool = [f for f in framings_l if frames_e.get(f, 0.5) <= QUIET_BAND]
    else:
        return framing, False
    if not pool:
        return framing, False
    return pool[i % len(pool)], True


def _focus_for_level(focus_l, focus, lvl, i, tier, pose):
    """swap a focus that fights the arc's energy for a compatible one from
    the same camera feed: a climax pulls the eye onto the person, a quiet
    point lets it drift off her. The replacement keeps the feed's own
    wording -- nothing is invented -- and the pick is index-stable, so the
    same session always composes the same plan. The crop's law outranks
    the dramaturgy: the pool drops whatever the tier filter below would
    throw away anyway, so a face focus never lands on a wide framing or a
    back view. A custom focus is not ours to move and reads as the
    neutral middle."""
    focuses_e = _energy_tables()[3]
    fe = focuses_e.get(focus)
    if fe is None:
        return focus, False
    if lvl <= QUIET_BAND and fe >= BOLD_BAND:
        pool = [f for f in focus_l if focuses_e.get(f, 0.5) <= QUIET_BAND]
    elif lvl >= BOLD_BAND and fe <= QUIET_BAND:
        pool = [f for f in focus_l if focuses_e.get(f, 0.5) >= BOLD_BAND]
    else:
        return focus, False
    if "back to the camera" in pose or tier == "figure":
        pool = [f for f in pool if f not in FACE_FOCUS]
    if not pool:
        return focus, False
    return pool[i % len(pool)], True


def _pose_for_level(poses_l, pose, lvl, i):
    """swap a pose that fights the arc's energy for a compatible one from
    the same wired feed: a dynamic pose at a quiet point, a still one at a
    climax. The replacement keeps the feed's own wording -- nothing is
    invented -- and the pick is index-stable, so the same session always
    composes the same plan. A feed with nothing compatible leaves the pose
    alone; poses in the neutral middle never move at all."""
    poses_e = _energy_tables()[0]
    pe = poses_e.get(pose, 0.5)
    if lvl <= QUIET_BAND and pe >= BOLD_BAND:
        pool = [p for p in poses_l if poses_e.get(p, 0.5) <= QUIET_BAND]
    elif lvl >= BOLD_BAND and pe <= QUIET_BAND:
        pool = [p for p in poses_l if poses_e.get(p, 0.5) >= BOLD_BAND]
    else:
        return pose, False
    if not pool:
        return pose, False
    return pool[i % len(pool)], True

TEMPLATE_KEYS = ("person", "scene", "style", "framing", "focus", "pose",
                 "placement", "expression", "lighting", "outfit", "quality")

DEFAULT_TEMPLATE = ("{framing}, focused on {focus}. {expression}. {style}. "
                    "{scene} {person}, {pose}, wearing {outfit}, {placement}. "
                    "{lighting}. {quality}")


def _ratio_size(name):
    r = RATIOS[name]
    w = max(64, int(round(math.sqrt(PIXEL_BUDGET * r) / 16.0)) * 16)
    h = max(64, int(round((w / r) / 16.0)) * 16)
    return w, h


def _first(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return str(value[0]) if value else ""
    return str(value)


def _lines(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    s = str(value).strip()
    return [s] if s else []


def _cycle(items, i):
    return items[i % len(items)] if items else ""


def _person_blocks(persona_data):
    try:
        d = json.loads(_first(persona_data) or "{}")
        blocks = d.get("blocks")
        return blocks if isinstance(blocks, dict) else None
    except (ValueError, TypeError):
        return None


def _focus_for_shot(focus, tier, pose):
    """filter the walked focus against the framing; empty falls back to the
    tier's default so the template's 'focused on {focus}' never goes bare"""
    back = "back to the camera" in pose
    if back and focus in FACE_FOCUS:
        return "the silhouette"
    if tier == "figure" and focus in FACE_FOCUS:
        return TIER_FALLBACK_FOCUS[tier]
    return focus


def _person_for_shot(blocks, tier, focus, pose):
    """re-weight persona blocks for this framing, or None to use plain text"""
    if not blocks:
        return None
    back = "back to the camera" in pose
    if back:
        keys = ["identity", "figure", "hair"]
    elif tier == "close":
        keys = ["identity"] if focus == "the shoes" else ["identity", "hair", "face", "skin", "signature"]
    elif tier == "medium":
        keys = ["identity", "figure", "hair", "face", "signature"]
    else:
        keys = ["identity", "figure"]
    return ", ".join(blocks[k] for k in keys if blocks.get(k))


# expression tests on the reference repo converged on one thing: a mood the
# framing sentence outranks stays neutral. It has to ride the subject noun --
# "a woman laughing out loud, ..." -- instead of standing in its own sentence
# after the crop. The weave hangs the expression on the persona's lead clause;
# the connector follows the expression's shape: a participle appends directly,
# an article-led noun phrase takes "with", a bare absolute is set off by commas.
_SUBJECT_ARTICLE = re.compile(r"^(?:a|an|the)\s+", re.I)


def _subject_weave(person, expression):
    head, sep, rest = person.partition(", ")
    if _SUBJECT_ARTICLE.match(expression):
        woven = f"{head} with {expression}"
    elif expression.split()[0].endswith("ing"):
        woven = f"{head} {expression}"
    else:
        woven = f"{head}, {expression}"
    return woven + (sep + rest if rest else "")


class PerfectLabSeries:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "count": ("INT", {"default": 12, "min": 1, "max": 100}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "template": ("STRING", {"multiline": True, "default": DEFAULT_TEMPLATE}),
                "quality_line": ("STRING", {"default": "editorial photography, 85mm, natural light"}),
                "token_limit": (["off", "SDXL · 75", "512", "1024"], {"default": "512"}),
                "look_rotation": (["blocks", "mixed"], {"default": "blocks"}),
                "auto_trim": ("BOOLEAN", {"default": True,
                              "tooltip": "When a shot exceeds the token limit, low-priority slots (lighting, placement, style) are dropped until it fits."}),
                "shot_pick": ("INT", {"default": -1, "min": -1, "max": 99,
                              "tooltip": "-1 renders the whole session; 0..N renders ONLY that shot (used by the panel's RE-SHOOT)."}),
                "takes": ("INT", {"default": 1, "min": 1, "max": 4,
                              "tooltip": "Renders per shot, each with its own noise -- draft the session at 2-3 and pick the best take per shot in the SHEET tab. A re-shoot continues the take numbering."}),
                "takes_arc": ("BOOLEAN", {"default": False,
                              "tooltip": "The arc leads the take budget too (needs ARC LEVEL wired and 2+ takes): quiet shots render once -- a certain frame needs no draft -- climax shots get the full stack, the build-up keeps one spare. A draft session stops paying for the shots it will keep anyway. The take numbering stays take-by-shot, so re-shoots still never collide."}),
                "mood_subject": ("BOOLEAN", {"default": False,
                              "tooltip": "Weave each shot's expression into the persona's lead clause (\"a woman laughing out loud, ...\") instead of a standalone sentence after the framing. Moods read stronger on the subject noun. Back views and shoe macros keep the plain phrasing."}),
                "pose_arc": ("BOOLEAN", {"default": False,
                              "tooltip": "Pull each shot's pose toward the arc's energy (needs ARC LEVEL wired): a still pose at a climax, a dynamic one at a quiet point, swapped from the same wired feed. Only contradictions move; custom poses read as neutral and never swap."}),
                "place_arc": ("BOOLEAN", {"default": False,
                              "tooltip": "Pull each shot's placement toward the arc's energy (needs ARC LEVEL wired): a distant placement at a climax, a dominating one at a quiet point, swapped within the crop's legal set. Rule-of-thirds placements are neutral geometry and never move."}),
                "crop_arc": ("BOOLEAN", {"default": False,
                              "tooltip": "Pull each shot's crop toward the arc's energy (needs ARC LEVEL wired): a climax tightens it, a quiet point lets it breathe wider, swapped within the framings the Camera feed walks. The tier moves with it -- focus, format, placement and persona blocks all follow the crop the arc chose."}),
                "focus_arc": ("BOOLEAN", {"default": False,
                              "tooltip": "Pull each shot's focus toward the arc's energy (needs ARC LEVEL wired): a climax draws the eye onto the person, a quiet point lets it drift off her, swapped within the focus feed the Camera walks. The crop's law still wins -- a face focus never lands on a wide framing or a back view."}),
            },
            "optional": {
                "person": ("STRING", {"forceInput": True}),
                "persona_data": ("STRING", {"forceInput": True}),
                "wardrobe": ("STRING", {"forceInput": True}),
                "scene": ("STRING", {"forceInput": True}),
                "light": ("STRING", {"forceInput": True}),
                "style": ("STRING", {"forceInput": True}),
                "poses": ("STRING", {"forceInput": True}),
                "expressions": ("STRING", {"forceInput": True}),
                "arc_level": ("FLOAT", {"forceInput": True,
                              "tooltip": "The arc's energy per shot, 0..1 -- the Expression node's ARC LEVEL output. Quiet points pull the light line's intensity words softer, climaxes push them bolder; the middle band leaves the Light node's wording untouched."}),
                "framings": ("STRING", {"forceInput": True}),
                "focus": ("STRING", {"forceInput": True}),
                "formats": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("PROMPT", "WIDTH", "HEIGHT", "SEED", "META")
    OUTPUT_IS_LIST = (True, True, True, True, True)
    INPUT_IS_LIST = (False,) * 15 + (True,) * 12
    FUNCTION = "process"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "The connector. Owns the session -- count, seed, template, quality, a token guard and the takes-per-shot setting -- and nothing else: every creative slot is a wire to a sub-node (Persona, Wardrobe, Scene, Light, Style, Pose, Expression, Camera). Wardrobe looks walk in blocks; the framing walk restarts per look; several wired personas alternate with the blocks. The arc's energy bends the whole session when ARC LEVEL is wired: light tone, poses, placements, the crop, the focus itself, and -- with takes_arc on -- the take budget: quiet shots render once, climaxes get every take to pick from. Live progress, the last run's results and per-shot META are built in. Press START SHOOT to queue the session."

    def process(self, count, seed, template, quality_line, token_limit="512", look_rotation="blocks", auto_trim=True, shot_pick=-1, takes=1, takes_arc=False, mood_subject=False, pose_arc=False, place_arc=False, crop_arc=False, focus_arc=False,
                person=None, persona_data=None, wardrobe=None, scene=None,
                light=None, style=None, poses=None, expressions=None,
                arc_level=None, framings=None, focus=None, formats=None):
        unwrap = lambda v: v[0] if isinstance(v, list) and v else v
        count, seed, template, quality_line, token_limit, look_rotation, auto_trim, shot_pick, takes, takes_arc, mood_subject, pose_arc, place_arc, crop_arc, focus_arc = map(
            unwrap, (count, seed, template, quality_line, token_limit, look_rotation, auto_trim, shot_pick, takes, takes_arc, mood_subject, pose_arc, place_arc, crop_arc, focus_arc))
        count = max(1, min(100, int(count)))
        takes = max(1, min(4, int(takes or 1)))
        persons = _lines(person)
        scenes = _lines(scene)
        lights = _lines(light)
        styles = _lines(style)
        looks = _lines(wardrobe)
        poses_l = _lines(poses)
        exprs_l = _lines(expressions)
        framings_l = _lines(framings)
        focus_l = _lines(focus)
        formats_l = _lines(formats)
        levels = []
        if arc_level is not None:
            raw = arc_level if isinstance(arc_level, list) else [arc_level]
            levels = [float(v) for v in raw if isinstance(v, (int, float))]
        blocks = _person_blocks(persona_data)
        template = _first(template) or DEFAULT_TEMPLATE
        quality = _first(quality_line).strip()

        persons_all = persons
        prompts, widths, heights, seeds, metas = [], [], [], [], []
        looks_n = len(looks)
        per_look = math.ceil(count / looks_n) if looks_n > 1 else count
        picked = int(shot_pick) if shot_pick is not None else -1
        single = 0 <= picked < count
        indices = [picked] if single else range(count)
        for i in indices:
            framing = _cycle(framings_l, i)
            tier = TIERS.get(framing, "medium")
            focus_v = _cycle(focus_l, i)
            pose = _cycle(poses_l, i)
            expression = _cycle(exprs_l, i)
            lighting = _cycle(lights, i) if lights else ""
            # the arc's energy at this shot drives the couplings: the light
            # line's intensity words bend (swap-bent, the setup's nouns
            # survive), with pose_arc on a contradicting pose swaps, with
            # place_arc on a contradicting placement moves within the crop's
            # legal set, and the crop/focus swaps land after the wardrobe
            # restart below
            tone = None
            pose_swap = False
            place_swap = False
            crop_swap = False
            focus_swap = False
            # whose swap it was: "user" when the replacement's energy came
            # from perfectlab_energy.json, "builtin" otherwise -- None until
            # a swap actually lands
            pose_src = place_src = crop_src = focus_src = None
            u_poses, u_places, u_frames, u_focuses = _user_energy_keys()
            lvl = levels[i % len(levels)] if levels else None
            if lvl is not None:
                if lighting and (lvl <= QUIET_BAND or lvl >= BOLD_BAND):
                    lighting, _hits = _tone_light(lighting, 0 if lvl <= QUIET_BAND else 1)
                    tone = "quiet" if lvl <= QUIET_BAND else "bold"
                if pose_arc and pose:
                    pose, pose_swap = _pose_for_level(poses_l, pose, lvl, i)
                    if pose_swap:
                        pose_src = "user" if pose in u_poses else "builtin"
            style_text = _cycle(styles, i)
            scene_text = _cycle(scenes, i)
            fmt = _cycle(formats_l, i)

            # a wardrobe feed walks looks in blocks and restarts the framing
            # walk per look, so every look is shot wide and close
            outfit = ""
            look_name = ""
            mixed = str(look_rotation[0] if isinstance(look_rotation, list) and look_rotation else look_rotation) == "mixed"
            if looks_n > 0:
                if mixed:
                    k = i % looks_n
                    outfit = looks[k]
                    look_name = f"Look {k + 1}"
                else:
                    block = min(i // per_look, looks_n - 1)
                    outfit = looks[block]
                    look_name = f"Look {block + 1}"
                    if looks_n > 1 and framings_l:
                        framing = framings_l[(i % per_look) % len(framings_l)]
                        tier = TIERS.get(framing, "medium")

            # the arc's energy moves the crop itself: a climax tightens it,
            # a quiet point lets it breathe -- swapped within the camera
            # feed, after the wardrobe's wide-and-close restart so the look
            # blocks stay intact. The tier moves with it and everything
            # downstream (format, focus, placement, persona blocks)
            # re-reads the crop the arc chose
            if lvl is not None and crop_arc and framings_l:
                framing, crop_swap = _framing_for_level(framings_l, framing, lvl, i)
                tier = TIERS.get(framing, "medium")
                if crop_swap:
                    crop_src = "user" if framing in u_frames else "builtin"

            # the arc's energy moves the focus: a climax pulls it onto the
            # person, a quiet point lets it drift off her -- swapped within
            # the feed, inside the crop's law (the tier filter below still
            # applies to whatever lands)
            if lvl is not None and focus_arc and focus_l:
                focus_v, focus_swap = _focus_for_level(focus_l, focus_v, lvl, i, tier, pose)
                if focus_swap:
                    focus_src = "user" if focus_v in u_focuses else "builtin"

            # format: a wired format wins unless it asks to follow the framing.
            # A walked feed is filtered against the tier -- a close crop in
            # 16:9 fills the rest of the frame with a second full-length
            # figure -- while a one-value feed is a pin and passes through.
            ratio = TIER_RATIOS[tier]
            if fmt and fmt != "follows framing" and fmt in RATIOS:
                if len(set(formats_l)) <= 1 or fmt in TIER_FORMATS[tier]:
                    ratio = fmt
            w, h = _ratio_size(ratio)

            # placements that fight the crop are filtered, not composed; the
            # arc's energy moves them first, but the crop's law still wins
            placement = PLACEMENTS[i % len(PLACEMENTS)]
            if lvl is not None and place_arc:
                placement, place_swap = _placement_for_level(placement, lvl, i, tier == "close")
                if place_swap:
                    place_src = "user" if placement in u_places else "builtin"
            if tier == "close" and placement not in NEAR_PLACEMENTS:
                placement = "close to the camera"
            # a back view cannot also sell a facial expression -- or a focus
            # that names the face
            if pose == "back to the camera":
                expression = ""
            focus_v = _focus_for_shot(focus_v, tier, pose)
            # framing label -> camera-side wording; floor-level macro for
            # shoe shots on a close framing
            framing_text = FRAMING_TEXTS.get(framing, framing)
            if tier == "close" and focus_v == "the shoes":
                framing_text = MACRO_SHOES

            # several personas alternate with the wardrobe blocks:
            # character A shoots looks 1..k, character B the next ones.
            # explicit multi-persona texts are the source of truth -- the
            # blocks of persona A must never overwrite persona B's text
            block_idx = min(i // per_look, max(looks_n - 1, 0)) if looks_n > 1 else 0
            person_text = None
            if len(persons_all) > 1:
                person_text = persons_all[block_idx % len(persons_all)]
            else:
                person_text = _person_for_shot(blocks, tier, focus_v, pose)
                if person_text is None:
                    person_text = _cycle(persons_all, i)

            # the mood rides the subject noun: the expression is woven into
            # the persona's lead clause and its own sentence dissolves. A shoe
            # macro has no face to carry it, so it keeps the classic phrasing.
            wove = False
            if mood_subject and expression and person_text and framing_text != MACRO_SHOES:
                person_text = _subject_weave(person_text, expression)
                wove = True
                meta_expression = expression
                expression = ""
            else:
                meta_expression = expression

            if template.strip():
                vals = {"person": person_text, "scene": scene_text, "style": style_text,
                        "framing": framing_text, "focus": focus_v, "pose": pose,
                        "placement": placement, "expression": expression,
                        "lighting": lighting, "outfit": outfit, "quality": quality}
                line = template
                for key in TEMPLATE_KEYS:
                    line = line.replace("{" + key + "}", vals[key])
                # auto-trim: when over the model's token limit, drop low-priority
                # slots (lighting -> placement -> style) and recompose
                limit_now = {"off": None, "SDXL · 75": 75, "512": 512, "1024": 1024}.get(
                    str(token_limit[0] if isinstance(token_limit, list) and token_limit else token_limit), 512)
                dropped = []
                if limit_now and auto_trim:
                    def _tokens(text):
                        return max(1, round(len(text) / 3.6))
                    for drop_key in ("lighting", "placement", "style"):
                        if _tokens(line) <= limit_now:
                            break
                        if not vals.get(drop_key):
                            continue
                        vals[drop_key] = ""
                        dropped.append(drop_key)
                        line = template
                        for key in TEMPLATE_KEYS:
                            line = line.replace("{" + key + "}", vals[key])
                # empty slots dissolve their leading phrase instead of leaving holes
                if not focus_v:
                    line = re.sub(r"focused on\s*(\.|,|$)\s*", " ", line)
            else:
                parts = [framing_text, f"focused on {focus_v}", expression, style_text,
                         scene_text, person_text, pose]
                line = ", ".join(p for p in parts if p.strip())
                if outfit:
                    line += f", wearing {outfit}"
                line += f", {placement}. {lighting}. {quality}".replace(" .", ".")
            if not outfit:
                line = re.sub(r"wearing\s*(?:,|\.|$)\s*", "", line)
            # dropped slots leave holes; dissolve them phrase by phrase
            line = re.sub(r",\s*\.", ".", line)
            line = re.sub(r"\.\s*,", ". ", line)
            line = re.sub(r"(?:\s*,\s*){2,}", ", ", line)
            line = re.sub(r"(?:\.\s*){2,}", ". ", line)
            line = re.sub(r"\s+\.", ".", line)
            line = re.sub(r"\.\s*\.", ".", line)
            line = re.sub(r"^\s*[.,]\s*", "", line)
            line = re.sub(r"\s{2,}", " ", line).strip(" ,.")
            if line and not line.endswith((".", "!", "?")):
                line += "."

            # takes: the shot rendered N times, each under its own noise. A
            # re-shoot renders one entry -- the widget seed carries the take.
            # With takes_arc on the arc leads the budget: the same bands the
            # light tone reads decide how many drafts this shot gets
            arc_takes = bool(takes_arc) and takes > 1 and lvl is not None
            t_count = _takes_for_level(lvl, takes) if arc_takes else takes
            shot_seed = (int(seed) + i) % (1 << 64)
            tokens = max(1, round(len(line) / 3.6))
            limit = {"off": None, "SDXL · 75": 75, "512": 512, "1024": 1024}.get(str(token_limit[0] if isinstance(token_limit, list) and token_limit else token_limit), 512)
            # the energies behind this shot's couplings, read from the same
            # merged tables the swaps used (the user's file included). META
            # carries them next to the arc level, and the sheet's CSV export
            # turns them into columns -- calibration material for
            # perfectlab_energy.json: which value moved which shot
            energies = {}
            if lvl is not None:
                poses_e, places_e, frames_e, focuses_e = _energy_tables()
                for table, key, entry in ((poses_e, "pose", pose),
                                          (places_e, "place", placement),
                                          (frames_e, "framing", framing),
                                          (focuses_e, "focus", focus_v)):
                    val = table.get(entry)
                    if val is not None:
                        energies[key] = val
            # the swaps' origins, next to the energies: whose table moved
            # this shot -- "user" keys live in the src flags, the CSV export
            # turns them into columns; None when the arc moved nothing
            srcs = {k: v for k, v in (("pose", pose_src), ("place", place_src),
                                      ("framing", crop_src), ("focus", focus_src)) if v}
            meta = {
                "shot": i + 1, "framing": framing, "tier": tier, "focus": focus_v,
                "focus_swap": focus_swap,
                "pose": pose, "pose_swap": pose_swap, "expression": meta_expression, "lighting": lighting,
                "tone": tone, "lvl": (round(lvl, 2) if lvl is not None else None),
                "energies": (energies if energies else None),
                "srcs": (srcs if srcs else None),
                "style": style_text, "outfit": (look_name if look_name else ""),
                "placement": placement, "place_swap": place_swap, "crop_swap": crop_swap,
                "width": w, "height": h,
                "rotation": str(look_rotation),
                "mood_subject": wove,
                "tokens": tokens,
                "overload": bool(limit and tokens > limit),
                "trimmed": dropped,
                "takes": (t_count if arc_takes else None),
            }
            for t in range(1 if single else t_count):
                entry_seed = (shot_seed + t * TAKE_STRIDE) % (1 << 64)
                meta["take"] = t
                meta["seed"] = entry_seed
                prompts.append(line)
                widths.append(w)
                heights.append(h)
                seeds.append(entry_seed)
                metas.append(json.dumps(meta, ensure_ascii=False))

        return (prompts, widths, heights, seeds, metas)


NODE_CLASS_MAPPINGS = {"PerfectLabSeries": PerfectLabSeries}
NODE_DISPLAY_NAME_MAPPINGS = {"PerfectLabSeries": "🧪 PerfectLab – Shot Series"}
