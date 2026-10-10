"""PerfectLab Studio: one node, the whole photoshoot.

A single photoshoot prompt builder. The panel switches each layer section
on or off and flips between SINGLE SHOT and SESSION mode; every choice is
written into one config (schema v2). Each section maps to a library
composer, and a single shot is a session of one, so walks, arcs, takes and
re-shoot continuity behave identically in both modes.

Sections (config keys, all optional; config.off lists disabled ones):
    persona     -- person_node state: trigger, fields{...}, signature_text
    look        -- wardrobe_node state: looks[{top,bottom,footwear,...}]
    scene       -- look_nodes scene state: location, weather, details
    light       -- look_nodes light state: setup or hour
    style       -- look_nodes style state: grade, film, palette, details
    pose        -- shoot_nodes state: poses {mode,set,pin} (+custom)
    expression  -- shoot_nodes state: arc, or expressions {mode,set,pin}
    camera      -- shoot_nodes state: framings/focus/formats + framing_order
    shot        -- single-shot extras: main_prompt, template, quality_line
    session     -- count, template, quality_line, token_limit, look_rotation,
                   takes, takes_arc, mood_subject, pose_arc, place_arc,
                   crop_arc, focus_arc, reshoot_shot
    negative    -- {enabled, text}
    off         -- ["light", ...] sections switched off in the panel
"""

import json
import os
import re

from .person_node import compose_blocks, BLOCK_ORDER
from .wardrobe_node import looks_from_state
from .look_nodes import PerfectLabScene, PerfectLabLight, PerfectLabStyle
from .shoot_nodes import PerfectLabPose, PerfectLabExpression, PerfectLabCamera
from .series_nodes import PerfectLabSeries, DEFAULT_TEMPLATE
from .prompt_assistant import PerfectLabAssistant

CONFIG_VERSION = 2

SECTIONS = ("persona", "look", "scene", "light", "style", "pose", "expression", "camera")


def read_config(node_data):
    try:
        config = json.loads(node_data) if node_data else {}
    except (ValueError, TypeError):
        config = {}
    return config if isinstance(config, dict) else {}


def _section(config, key):
    """the section's state, or None when it is absent or switched off"""
    off = config.get("off")
    if isinstance(off, list) and key in off:
        return None
    state = config.get(key)
    return state if isinstance(state, dict) and state else None


def compose_slots(config, count, seed):
    """(slots dict, custom count override) -- slot strings for the session
    machinery, straight out of the proven composers"""
    slots = {}

    persona = _section(config, "persona")
    if persona is not None:
        blocks = compose_blocks(dict(persona))
        if blocks:
            slots["person"] = ", ".join(blocks[k] for k in BLOCK_ORDER if k in blocks)
            slots["persona_data"] = json.dumps(
                {"blocks": blocks, "trigger": persona.get("trigger", "")},
                ensure_ascii=False)

    look = _section(config, "look")
    if look is not None:
        texts = [l["text"] for l in looks_from_state(dict(look))]
        # compose_look leads with "wearing", but the template's outfit slot
        # already carries it -- strip the duplicate
        texts = [t[8:].strip() if t.lower().startswith("wearing ") else t for t in texts]
        if texts:
            slots["wardrobe"] = "\n".join(texts)

    for key, builder in (("scene", PerfectLabScene), ("light", PerfectLabLight),
                         ("style", PerfectLabStyle)):
        state = _section(config, key)
        if state is not None:
            text = builder().build(json.dumps(state, ensure_ascii=False))[0]
            if text:
                slots[key] = text

    pose = _section(config, "pose")
    if pose is not None:
        slots["poses"] = PerfectLabPose().build(json.dumps(pose, ensure_ascii=False),
                                                count, seed)[0]

    expression = _section(config, "expression")
    if expression is not None:
        exprs, levels = PerfectLabExpression().build(
            json.dumps(expression, ensure_ascii=False), count, seed)
        slots["expressions"] = exprs
        # a picked arc carries real energies; a flat walk keeps a neutral 0.5
        vals = [v for v in (levels or []) if isinstance(v, (int, float))]
        slots["arc_level"] = vals if vals and set(vals) != {0.5} else None

    camera = _section(config, "camera")
    if camera is not None:
        framings, focus, formats = PerfectLabCamera().build(
            json.dumps(camera, ensure_ascii=False), count, seed)
        slots["framings"] = framings
        slots["focus"] = focus
        slots["formats"] = formats
        lens = (camera.get("lens") or "").strip()
        if lens:
            slots["style"] = ((slots.get("style") or "") + ", " + lens).strip(", ")

    return slots


def _run_session(config, count, seed, shot_pick):
    """the shared engine: one call into the proven session machinery"""
    session = config.get("session") if isinstance(config.get("session"), dict) else {}
    shot = config.get("shot") if isinstance(config.get("shot"), dict) else {}
    single = count == 1 and not session.get("count")
    template = (shot.get("template") or session.get("template") or DEFAULT_TEMPLATE).strip()
    quality = (shot.get("quality_line") or session.get("quality_line")
               or "editorial photography, natural light").strip()
    slots = compose_slots(config, count, seed)
    # SDXL tag mode: per-shot substitution. Every multi-select feeds ONE
    # value per frame, rotating across the session -- the same walk
    # semantics the natural mode has, in tag form. The frame's size comes
    # from its own format pin or its framing tier.
    if (shot.get("style_mode") or "natural") == "tags":
        from .series_nodes import TIERS, TIER_RATIOS, _ratio_size
        looks = [t for t in str(slots.get("wardrobe") or "").split("\n") if t.strip()]
        poses_l = list(slots.get("poses") or [])
        exprs_l = list(slots.get("expressions") or [])
        frams_l = list(slots.get("framings") or [])
        focus_l = list(slots.get("focus") or [])
        fmts_l = list(slots.get("formats") or [])
        pick = lambda seq, i: str(seq[i % len(seq)]).strip() if seq else ""
        main = (shot.get("main_prompt") or "").strip()
        custom = (shot.get("custom") or "").strip()
        prompts, widths, heights, seeds, metas = [], [], [], [], []
        for i in range(count):
            parts = [slots.get("person"),
                     pick(looks, i).replace("wearing ", ""),
                     slots.get("scene"), slots.get("light"), slots.get("style"),
                     pick(poses_l, i), pick(exprs_l, i), pick(frams_l, i), pick(focus_l, i)]
            prompt = ", ".join(str(x).strip().replace("the setting is ", "")
                               for x in parts if x and str(x).strip())
            if main:
                prompt = f"{main}, {prompt}"
            if custom:
                prompt = f"{prompt}, {custom}"
            prompts.append(prompt)
            if fmts_l:
                w, h = _ratio_size(fmts_l[i % len(fmts_l)])
            else:
                tier = TIERS.get(pick(frams_l, i), "medium")
                w, h = _ratio_size(TIER_RATIOS[tier])
            widths.append(w)
            heights.append(h)
            seeds.append((int(seed) + i) % (1 << 64))
            metas.append({"node": "studio", "mode": "sdxl tags", "shot": i + 1})
        return prompts, widths, heights, seeds, metas
    prompts, widths, heights, seeds, metas = PerfectLabSeries().process(
        count, int(seed), template, quality,
        session.get("token_limit", "off" if single else "512"),
        session.get("look_rotation", "blocks"),
        True, shot_pick,
        int(session.get("takes", 1) or 1),
        bool(session.get("takes_arc")),
        bool(session.get("mood_subject")),
        bool(session.get("pose_arc")),
        bool(session.get("place_arc")),
        bool(session.get("crop_arc")),
        bool(session.get("focus_arc")),
        person=slots.get("person"), persona_data=slots.get("persona_data"),
        wardrobe=slots.get("wardrobe"), scene=slots.get("scene"),
        light=slots.get("light"), style=slots.get("style"),
        poses=slots.get("poses"), expressions=slots.get("expressions"),
        arc_level=slots.get("arc_level"),
        framings=slots.get("framings"), focus=slots.get("focus"),
        formats=slots.get("formats"))
    metas = [json.loads(m) if isinstance(m, str) else m for m in metas]
    # the trigger / prefix line rides in front, the custom additions ride
    # behind every composed shot
    main = (shot.get("main_prompt") or "").strip()
    if main:
        prompts = [f"{main}\n\n{p}" if p else main for p in prompts]
    custom = (shot.get("custom") or "").strip()
    if custom:
        prompts = [f"{p}\n\n{custom}" if p else custom for p in prompts]
    prompts = [resolve_choices(resolve_wildcards(p, s), s)
               for p, s in zip(prompts, seeds)]
    return prompts, widths, heights, seeds, metas


_CHOICE_RE = re.compile(r"\{([^{}]+)\}")
_WC_RE = re.compile(r"__([A-Za-z0-9_-]+)__")

# wildcard files: __name__ in any text pulls a line from
# web/wildcards/name.txt next to the engine; re-read when the file changes
_WC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "wildcards")
_WC_CACHE = {}  # name -> (mtime, lines)


def _wc_lines(name):
    path = os.path.join(_WC_DIR, name + ".txt")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    cached = _WC_CACHE.get(name)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        with open(path, encoding="utf-8") as f:
            lines = [l.strip() for l in f
                     if l.strip() and not l.strip().startswith("#")]
    except OSError:
        return None
    _WC_CACHE[name] = (mtime, lines)
    return lines


def resolve_wildcards(text, seed):
    """__filename__ tokens resolve to a line of web/wildcards/filename.txt,
    picked from the shot's seed with the same FNV the JS mirror runs.
    An unknown file leaves the token as-is -- the panel linter flags it."""
    text = str(text)
    if "__" not in text:
        return text

    def pick(m):
        lines = _wc_lines(m.group(1))
        if not lines:
            return m.group(0)
        return lines[_fnv("{}|__{}__|wc".format(seed, m.group(1))) % len(lines)]

    return _WC_RE.sub(pick, text)


def _fnv(data):
    """FNV-1a 32-bit -- the same hash the JS mirror runs, so the panel
    preview picks the same alternative the engine picks"""
    h = 2166136261
    for ch in data.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def resolve_choices(text, seed, salt=0):
    """{a|b|c} inline choices resolved from the shot's own seed.

    Nested braces go inside-out; the pick is deterministic per
    (seed, content, occurrence), so a take re-renders identically."""
    text = str(text)
    if "{" not in text:
        return text
    seen = [0]

    def pick(m):
        parts = [p.strip() for p in m.group(1).split("|") if p.strip()]
        if len(parts) <= 1:
            return m.group(1)
        seen[0] += 1
        return parts[_fnv("{}|{}|{}|{}".format(seed, m.group(1), salt, seen[0])) % len(parts)]

    prev = None
    while prev != text:
        prev = text
        text = _CHOICE_RE.sub(pick, text)
    return text


def _negatives(config, n, seed=0):
    neg = config.get("negative") if isinstance(config.get("negative"), dict) else {}
    presets = [str(x).strip() for x in (neg.get("presets") or []) if str(x).strip()]
    custom = (neg.get("text") or "").strip()
    text = ", ".join(presets + ([custom] if custom else []))
    if not neg.get("enabled") or not text:
        return [""] * max(1, n)
    text = resolve_wildcards(text, seed)
    return [PerfectLabAssistant().clean_for_natural_language(text)] * max(1, n)


class PerfectLabStudio:
    """One node for everything: the layer sections toggle in the panel, the
    mode switch picks a single shot or a full session. PROMPT is a list --
    ComfyUI iterates it downstream; wire WIDTH/HEIGHT into the latent."""

    DESCRIPTION = ("The all-in-one PerfectLab node. Sections in the panel -- persona, "
                    "look, scene, light, style, camera, pose, expression -- toggle on and "
                    "off; the mode switch renders a single shot or a whole session with "
                    "the proven walk, arc and take machinery. Fixed-height panel with an "
                    "8-tile preview dock.")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # hidden by JS; carries the whole panel state (schema v2)
                "node_data": ("STRING", {"default": "{}", "multiline": False}),
                "mode": (["single shot", "session"], {"default": "session"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff}),
                "variations": ("INT", {"default": 1, "min": 1, "max": 100,
                                       "tooltip": "Single-shot mode: how many prompt "
                                                  "variations to produce."}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = ("PROMPT", "NEGATIVE", "WIDTH", "HEIGHT", "SEED", "META")
    OUTPUT_IS_LIST = (True,) * 6
    FUNCTION = "process"
    CATEGORY = "PerfectLab"

    def process(self, node_data, mode="session", seed=0, variations=1):
        config = read_config(node_data)
        single = (mode == "single shot")
        count = max(1, min(int(variations or 1), 100)) if single else int(
            (config.get("session") or {}).get("count", 6) or 6)
        prompts, widths, heights, seeds, metas = _run_session(
            config, count, int(seed), -1)
        for meta in metas:
            meta["node"] = "studio"
            meta["mode"] = mode
        return (prompts, _negatives(config, len(prompts), int(seed)),
                widths, heights, seeds, metas)


NODE_CLASS_MAPPINGS = {
    "PerfectLabStudio": PerfectLabStudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PerfectLabStudio": "PerfectLab Studio",
}
