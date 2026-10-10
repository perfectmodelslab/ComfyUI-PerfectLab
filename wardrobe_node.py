"""PerfectLab Wardrobe: the looks composer.

Holds the looks of one shoot as tabs. A look is built from separate slots --
top, bottom, footwear, accessories, a free detail line -- not one baked
phrase, so every piece stays adjustable on its own (and RND-able from the
Shot Series in a later step). The output is one clothing paragraph per look;
the Shot Series walks them in blocks and restarts the framing walk per look,
so each outfit is shot wide and close.

A look replaces the whole outfit -- nothing of one look survives into the
next, which keeps costume changes clean on a shared face.
"""

import json
import re

TOPS = [
    "a shiny oversized cropped puffer jacket worn open",
    "a tiny baby tee",
    "an oversized blazer",
    "a crop top",
    "an oversized white crop hoodie",
    "a vintage oversized jacket",
    "a cropped tank top",
    "an open flannel shirt",
    "a turtleneck",
    "a cozy oversized sweater",
    "a biker jacket over a band tee",
    "a track jacket with piping details",
    "a slip top",
    "a sheer blouse",
    "a preppy cardigan",
    "a trench coat",
    "a bustier top",
    "an oversized varsity jacket",
    "a mesh long-sleeve top",
    "a wrap blouse",
    "a faux-fur hooded jacket",
    "a cropped button-down shirt",
    "a thermal long-sleeve top",
    "a mock-neck top",
    "a crop top with a chest cutout",
    "a boxy cropped blazer",
]

BOTTOMS = [
    "low-rise baggy sweatpants",
    "a short pleated skirt",
    "cycling shorts",
    "a short sundress with tiny flowers",
    "baggy cargo pants",
    "a pleated mini skirt",
    "sheer tights",
    "distressed skinny jeans",
    "loose track pants",
    "high-waisted wide-leg trousers",
    "a pleated tennis skirt",
    "a satin midi skirt",
    "distressed denim shorts",
    "a maxi skirt",
    "a pencil skirt",
    "cargo shorts",
    "high-waisted flared yoga pants",
    "flared jeans",
    "low-slung black trousers",
]

FOOTWEAR = [
    "chunky sneakers", "slim stiletto heels", "classic pumps",
    "tall boots", "sneakers", "lug-sole combat boots",
    "platform loafers", "strappy sandals", "knee-high riding boots",
    "retro skate sneakers", "black ballet flats", "worn cowboy boots",
    "mary janes", "kitten heels", "hiking boots", "pool slides",
    "chunky platform moon boots", "fur leg warmers over platform boots",
]

COLORS = ["jet black", "off-white", "charcoal gray", "glossy red", "chrome silver",
          "champagne gold", "pastel pink", "warm beige", "navy blue", "olive green",
          "steel blue", "burgundy", "mustard yellow", "emerald green",
          "bright bubblegum pink", "crisp white", "light wash denim"]

ACCESSORIES = ["thin choker", "layered necklaces", "hoop earrings",
               "stacked thin bracelets", "tinted sunglasses", "small shoulder bag",
               "belt bag", "chunky watch", "a single strand necklace",
               "a wide belt", "a neck scarf", "long drop earrings",
               "fingerless gloves", "a hair clip", "an anklet",
               "aviator sunglasses", "a tote bag", "a chunky chain necklace",
               "a cuff bracelet", "a charm bracelet",
               "pearl drop earrings", "a glasses chain", "a waist chain",
               "a chunky metal cuff",
               "an oversized wool scarf", "fuzzy white earmuffs",
               "a slim necktie", "a leather garter strap"]


NONE_PLACEHOLDERS = {"— none —", "- none -", "none"}


def compose_look(look):
    """One clothing paragraph out of slotted look dict.

    Slots: top, top_color, outerwear, bottom, bottom_color, footwear,
    accessories, details. A literal "none" placeholder in any slot reads
    as an empty slot."""
    slot = lambda key: "" if (look.get(key) or "").strip().lower() in NONE_PLACEHOLDERS \
        else (look.get(key) or "").strip()
    top = slot("top")
    top_color = slot("top_color")
    top_material = slot("top_material")
    outer = slot("outerwear")
    bottom = slot("bottom")
    bottom_color = slot("bottom_color")
    bottom_material = slot("bottom_material")
    headwear = slot("headwear")
    headwear_color = slot("headwear_color")
    acc_color = slot("acc_color")
    shoes = slot("footwear")
    acc = look.get("accessories") or []
    if isinstance(acc, str):
        acc = [acc] if acc.strip() else []
    acc = [a.strip() for a in acc if a.strip() and a.strip().lower() not in NONE_PLACEHOLDERS]
    # a look may be footwear- or headwear- or accessories-only (a shoes
    # catalog tile, a hat close-up) -- the tail carries those on its own
    if not top and not bottom and not shoes and not headwear and not acc:
        return ""
    piece = lambda name, color, material: " ".join(
        p for p in ((material + " " + name[2:].strip()) if material and name[:2].lower() in ("a ", "an") and name.lower().startswith(("a ", "an "))
                    else (material + " " + name) if material else name, ) if p
    ) + (f" in {color}" if color else "")
    if top or bottom:
        if top and bottom:
            body = f"wearing {piece(top, top_color, top_material)} with {piece(bottom, bottom_color, bottom_material)}"
        elif top:
            body = f"wearing {piece(top, top_color, top_material)}"
        else:
            body = f"wearing {piece(bottom, bottom_color, bottom_material)}"
        if outer:
            body += f", layered with {outer}"
    else:
        body = ""
    tail = []
    if shoes:
        tail.append(piece(shoes, slot("footwear_color"), slot("footwear_material")))
    if acc:
        if acc_color:
            acc = [f"{a} in {acc_color}" for a in acc]
        tail.append(" and ".join(acc))
    if headwear:
        if headwear_color:
            m = re.match(r"^(a|an|the)\s+(.*)$", headwear, re.I)
            hw = f"{m.group(1)} {headwear_color} {m.group(2)}" if m                 else f"{headwear_color} {headwear}"
        else:
            hw = headwear
        tail.append(f"wearing {hw}")
    details = slot("details")
    if details:
        tail.append(details)
    return ", ".join([p for p in [body] + tail if p])


def looks_from_state(state):
    """[{"name", "text"}] -- unnamed looks still count ("Look 2")."""
    out = []
    for i, look in enumerate(state.get("looks") or []):
        if not isinstance(look, dict):
            continue
        text = compose_look(look)
        if not text:
            continue
        name = (look.get("name") or "").strip() or f"Look {i + 1}"
        out.append({"name": name, "text": text})
    return out


class PerfectLabWardrobe:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "wardrobe_data": ("STRING", {"default": "{}", "multiline": False}),
            },
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("looks", "look_count")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "Holds the looks of one shoot as tabs. A look is assembled from separate slots -- top and its color, outerwear, bottom and its color, footwear, accessories, a free detail -- so every piece stays editable on its own. Wire 'looks' into the Shot Series: looks walk in blocks (or mixed) and the framing walk restarts per look, so each outfit is shot wide and close."

    def build(self, wardrobe_data=None):
        try:
            state = json.loads(wardrobe_data) if wardrobe_data else {}
        except (ValueError, TypeError):
            state = {}
        looks = looks_from_state(state)
        texts = [l["text"] for l in looks] or [""]
        return (texts, max(1, len(looks)))


NODE_CLASS_MAPPINGS = {"PerfectLabWardrobe": PerfectLabWardrobe}
NODE_DISPLAY_NAME_MAPPINGS = {"PerfectLabWardrobe": "🧪 PerfectLab – Wardrobe"}
