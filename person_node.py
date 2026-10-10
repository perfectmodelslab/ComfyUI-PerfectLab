"""PerfectLab Persona: the persona composer.

Orthogonal fields, not baked phrases: gender, age, figure, hair, hair color,
eyes, makeup (multi), skin, a free signature line -- each with its own picks,
its own custom entries and its own preview where an asset exists. The text is
composed block by block and the second output (persona_data) hands the blocks
to the Shot Series so the description re-weights per framing.

A LoRA trigger sits in front: when set, the face-carrying blocks (hair, eyes,
makeup, skin) drop out of the text entirely -- the trigger wakes the LoRA and
the model supplies the face.
"""

import json
import re

HAIR = ["long platinum waves", "sleek high ponytail", "messy bun with loose strands",
        "long tight braids", "beachy curls", "blunt shoulder-length bob",
        "half-up half-down hair", "wet-look slicked back hair", "twin tails",
        "space buns", "braided crown", "curtain bangs over loose hair",
        "long straight hair with a middle part", "shaggy layered hair",
        "voluminous blowout", "low chignon", "bubble braids", "crimped hair",
        "wavy lob", "top knot", "fishtail braid", "wolf cut", "side-swept curls",
        "pixie cut"]

# orthogonal fields -- key, label, options, multi, block it lands in
FIELDS = [
    {"key": "gender", "label": "Gender", "options": ["a young woman", "a mature woman",
        "a young man", "a mature man", "an androgynous person"], "multi": False},
    {"key": "age", "label": "Age", "options": ["18 years old", "22 years old", "27 years old",
        "in their early 30s", "ageless"], "multi": False},
    {"key": "figure", "label": "Figure", "options": ["a very slim figure", "a slender figure",
        "a lean toned figure", "an average build", "an athletic figure",
        "a curvy hourglass figure", "a full curvy figure", "a plus-size figure",
        "a petite build", "a tall statuesque build",
        "a large bust", "a small bust", "wide hips", "narrow hips",
        "a big round butt", "a flat butt", "thin arms", "muscular arms",
        "a flat toned stomach", "a soft round belly", "broad shoulders",
        "a wasp waist", "a broad back", "long legs", "muscular legs",
        "narrow shoulders"], "multi": True},
    {"key": "hair", "label": "Hair", "options": HAIR, "multi": False},
    {"key": "hair_color", "label": "Hair color", "options": ["platinum blond", "honey blonde",
        "chestnut brown", "jet black", "copper red", "silver gray", "pastel pink",
        "dirty blonde with dark roots", "ash brown", "auburn", "blue-black",
        "silver-lavender", "copper highlights", "two-tone ombre"], "multi": False},
    {"key": "eyes", "label": "Eyes", "options": ["pale blue eyes", "deep brown eyes",
        "emerald green eyes", "gray eyes", "amber eyes", "heterochromia",
        "violet eyes", "hazel eyes", "very dark brown eyes", "grey-blue eyes"], "multi": False},
    {"key": "makeup", "label": "Makeup", "options": [
        "heavy black winged eyeliner", "dark smokey eyes", "sharp graphic liner",
        "glitter eyeshadow", "electric blue eyeshadow", "purple winged liner",
        "emerald green eyeshadow", "cut crease eyeshadow", "silver glitter liner",
        "glossy pink lips", "bold red lipstick", "matte nude lips", "dark plum lipstick",
        "coral orange lips", "black gothic lipstick", "glazed cherry lips",
        "aubergine lipstick", "peach gloss lips", "berry stained lips",
        "a no-makeup natural look"], "multi": True},
    {"key": "skin", "label": "Skin", "options": ["porcelain skin", "sun-kissed skin",
        "olive skin", "deep tan skin", "freckled skin", "deep ebony skin",
        "golden brown skin", "cool ivory skin"], "multi": False},
    {"key": "signature", "label": "Signature", "options": ["a tiny beauty mark under one eye",
        "a thin gold nose ring", "an old scar over the left brow", "stacked thin bracelets",
        "a single pearl necklace", "round wire-frame glasses",
        "a small wrist tattoo", "a tiny nose stud", "a dimple in the left cheek",
        "a beauty mark above the lip", "a slit in the left eyebrow",
        "a bold signet ring on the index finger"], "multi": True},
]

FIELD_BLOCK = {
    "gender": "identity", "age": "identity", "figure": "figure",
    "hair": "hair", "hair_color": "hair", "eyes": "face", "makeup": "face",
    "skin": "skin", "signature": "signature",
}
BLOCK_ORDER = ["identity", "figure", "hair", "face", "skin", "signature"]
FACE_BLOCKS = {"hair", "face", "skin"}


def _values(state, field):
    """picked values for a field: list of strings (custom entries included)"""
    v = (state.get("fields") or {}).get(field["key"])
    if v is None:
        return []
    vals = [v] if isinstance(v, str) else [str(x) for x in v if str(x).strip()]
    if field["key"] == "age":
        vals = [_floor_age(x) for x in vals]
    return vals


# the kit describes adults: a typed age under 18 is floored, not rejected --
# the same guard the age presets already carry by starting at 18
_AGE_RE = re.compile(r"\b(\d{1,3})(?=\s*(?:years?[- ]old|yo\b))", re.I)


def _floor_age(text):
    return _AGE_RE.sub(lambda m: str(max(int(m.group(1)), 18)), text)


def compose_blocks(state):
    """{block_key: text} from a persona state; trigger leads, face blocks drop"""
    trigger = (state.get("trigger") or "").strip()
    signature_text = (state.get("signature_text") or "").strip()
    blocks = {}
    for f in FIELDS:
        vals = _values(state, f)
        if not vals:
            continue
        block = FIELD_BLOCK[f["key"]]
        text = ", ".join(vals)
        if f["key"] == "skin":
            text = "with " + text
        if block == "identity":
            prev = blocks.get(block, "")
            blocks[block] = (prev + ", " + text).strip(", ")
        else:
            blocks[block] = text
    if signature_text:
        blocks["signature"] = signature_text
    if trigger:
        for k in list(blocks):
            if k in FACE_BLOCKS:
                del blocks[k]
        ident = blocks.get("identity", "")
        blocks["identity"] = f"{ident} ({trigger})" if ident else f"a person ({trigger})"
    return blocks


class PerfectLabPersona:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "persona_data": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("person", "persona_data")
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "Builds the person once, out of orthogonal fields: gender, age, figure, hair, hair color, eyes, makeup, skin and a signature detail. Every field takes a library pick or your own text. The text is composed block by block, and persona_data hands the blocks to the Shot Series, which re-weights the description per framing -- close-ups keep the face, wide shots keep the figure. A LoRA trigger drops the face fields and lets the LoRA draw the face."

    def build(self, persona_data=None):
        try:
            state = json.loads(persona_data) if persona_data else {}
        except (ValueError, TypeError):
            state = {}
        blocks = compose_blocks(state)
        text = ", ".join(blocks[k] for k in BLOCK_ORDER if k in blocks)
        payload = json.dumps({"blocks": blocks, "trigger": state.get("trigger", "")},
                             ensure_ascii=False)
        return (text, payload)


NODE_CLASS_MAPPINGS = {"PerfectLabPersona": PerfectLabPersona}
NODE_DISPLAY_NAME_MAPPINGS = {"PerfectLabPersona": "🧪 PerfectLab – Persona"}
