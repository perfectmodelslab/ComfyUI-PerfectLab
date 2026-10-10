import json
import os
import random
import re

MODE_LIMITS = {
    "SDXL": 75,
    "Flux/Z-Image": 512,
    "Flux": 512,
    "Z-Image Turbo": 512,
    "Qwen-Image": 1024,
    "Wan (video)": 512,
}
NL_MODES = set(MODE_LIMITS) - {"SDXL"}

BASE_DIR = os.path.dirname(os.path.realpath(__file__))
WILDCARDS_DIR = os.path.join(BASE_DIR, "web", "wildcards")

CONFIG_VERSION = 1

PLACEHOLDER_RE = re.compile(r"\{\{\s*([^{}|]+?)\s*((?:\|[^{}]*)?)\}\}")

_WILDCARD_CACHE = {}


def _load_wildcard(name):
    """Read wildcards/<name>.txt lines (cached by mtime); None if missing."""
    safe = re.sub(r"[^A-Za-z0-9_\-]", "", name)
    if not safe:
        return None
    path = os.path.join(WILDCARDS_DIR, safe + ".txt")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    cached = _WILDCARD_CACHE.get(safe)
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        with open(path, encoding="utf-8") as fh:
            lines = [ln.strip() for ln in fh
                     if ln.strip() and not ln.strip().startswith("#")]
    except OSError:
        return None
    _WILDCARD_CACHE[safe] = (mtime, lines)
    return lines or None


def _as_dict(v, default=None):
    return v if isinstance(v, dict) else (dict(default) if default else {})


def migrate_config(cfg):
    """Normalize configs from any older version to the current shape.
    Unknown keys are preserved; missing keys get their defaults."""
    if not isinstance(cfg, dict):
        return {}
    cfg.setdefault("_v", CONFIG_VERSION)
    cfg.setdefault("time_of_day", -1)
    if not isinstance(cfg.get("palette"), list):
        cfg["palette"] = []
    cfg.setdefault("camera", "")
    cfg["_usage"] = _as_dict(cfg.get("_usage"))
    neg = _as_dict(cfg.get("_negative"), {"enabled": False, "main": "", "cats": {}})
    neg.setdefault("enabled", False)
    neg.setdefault("main", "")
    neg["cats"] = _as_dict(neg.get("cats"))
    cfg["_negative"] = neg
    cfg["_characters"] = _as_dict(cfg.get("_characters"))
    cfg["_form"] = _as_dict(cfg.get("_form"))
    ui = _as_dict(cfg.get("_ui"))
    ui.setdefault("lang", "en")
    cfg["_ui"] = ui
    return cfg


class PerfectLabAssistant:
    # read by the server for the node tooltip in the UI (must be a class attribute,
    # NOT a key inside INPUT_TYPES)
    DESCRIPTION = "Interactive visual prompt builder: time-of-day lighting, camera & film simulation, color palettes and randomizable categories (lock/random/cycle per category). Configure everything in the embedded UI."

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                # hidden by JS; carries the visual UI config as JSON
                "node_data": ("STRING", {"default": "{}", "multiline": False}),
                "main_prompt": ("STRING", {"multiline": True, "default": "score_9, rating_explicit,", "dynamicPrompts": False,
                                           "tooltip": "Base prompt. Categories, lighting, camera and palette from the visual UI are appended after it. Supports {a|b|c} choices and __wildcard__ files."}),
                "mode": (list(MODE_LIMITS.keys()), {"tooltip": "Target model family: sets the token limit and natural-language cleanup. SDXL keeps tag/weight syntax; the other modes strip weights and brackets."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff,
                                 "tooltip": "Base seed for RND category picks and {a|b|c} choices. Variation i uses seed+i. CYC categories advance every N seeds."}),
                "variations": ("INT", {"default": 1, "min": 1, "max": 100,
                                       "tooltip": "How many prompt variations to produce per run. The output is a list -- ComfyUI iterates it downstream automatically (batch of prompts)."}),
            },
            "optional": {
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("PROMPT", "NEGATIVE")
    OUTPUT_IS_LIST = (True, True)
    FUNCTION = "process"
    CATEGORY = "PerfectLab"

    def clean_for_natural_language(self, text):
        # strip weight syntax (word:1.2), [word:0.5], leftover brackets, doubled commas
        text = re.sub(r'\(([^:)]+):[\d.]+\)', r'\1', text)
        text = re.sub(r'\[([^:\]]+):[\d.]+\]', r'\1', text)
        text = text.replace('(', '').replace(')', '').replace('[', '').replace(']', '')
        text = re.sub(r',\s*,', ',', text)

        # collapse horizontal whitespace only -- line breaks are kept as block separators
        text = re.sub(r'[ \t]+', ' ', text).strip()

        return text.strip(',')

    def get_lighting_description(self, hour):
        h = int(hour)
        if 0 <= h < 4: return "dim lighting, low key, dark atmosphere, minimal illumination, cold color temp, high contrast shadows, mystery mood"
        if 4 <= h < 6: return "blue hour, cold ambient lighting, soft dim light, low contrast, melancholic atmosphere, predawn glow"
        if 6 <= h < 8: return "soft warm glow, morning light, diffuse illumination, long shadows, rising light source, golden hour vibes"
        if 8 <= h < 11: return "bright clean lighting, neutral white balance, soft shadows, airy atmosphere, clear illumination, balanced exposure"
        if 11 <= h < 16: return "hard lighting, strong highlights, sharp deep shadows, high contrast, bright exposure, vivid colors, direct sunlight"
        if 16 <= h < 18: return "warm ambient light, soft contrast, golden tones, rich lighting, atmospheric glow, volumetric sun"
        if 18 <= h < 21: return "dramatic lighting, cinematic light, orange and teal contrast, rim lighting, volumetric mood, dusk atmosphere"
        if 21 <= h <= 24: return "night lighting, moody atmosphere, practical lights, dark surroundings, mysterious vibe, cinematic noir"
        return ""

    def _expand_dynamic(self, text, rng):
        # resolve {a|b|c} dynamic choices, innermost braces first
        if "{" not in text:
            return text
        pattern = re.compile(r"\{([^{}]*)\}")
        for _ in range(32):
            if "{" not in text or "}" not in text:
                break
            new = pattern.sub(lambda m: rng.choice(m.group(1).split("|")), text)
            if new == text:
                break
            text = new
        return text

    def _expand_wildcards(self, text, rng):
        # __name__ -> random line of wildcards/<name>.txt (left as-is when missing)
        if "__" not in text:
            return text
        def repl(m):
            lines = _load_wildcard(m.group(1))
            return rng.choice(lines) if lines else m.group(0)
        return re.sub(r"__([A-Za-z0-9_\-]+)__", repl, text)

    def _pick_category_value(self, s, seed_eff, rng):
        items = s.get("items", [])
        if not items:
            return None
        mode = s.get("mode", "RND")
        if mode == "LCK":
            return s.get("selected", items[0])
        if mode == "CYC":
            every = max(1, int(s.get("every", 5) or 5))
            return items[(int(seed_eff) // every) % len(items)]
        return rng.choice(items)

    def _expand_form(self, text, form, rng):
        # {{name}} / {{name|a|b}} -- values from the UI form; an empty field with
        # options rolls a fresh choice per variation, an unresolved token stays visible
        if "{{" not in text or not isinstance(form, dict):
            return text
        def repl(m):
            name = m.group(1).strip()
            opts = [o.strip() for o in m.group(2).split("|") if o.strip()]
            spec = form.get(name)
            val = ""
            if isinstance(spec, dict):
                val = str(spec.get("value", "") or "")
            elif isinstance(spec, str):
                val = spec
            if val.strip():
                return val.strip()
            if opts:
                return rng.choice(opts)
            return m.group(0)
        return PLACEHOLDER_RE.sub(repl, text)

    def _compose_categories(self, cats, seed_eff, rng):
        if not isinstance(cats, dict):
            return ""
        reserved = {"time_of_day", "palette", "camera", "_usage", "_negative", "_characters", "_ui", "_v", "_form"}
        chosen = []
        for cat in sorted(k for k in cats if k not in reserved):
            s = cats[cat]
            if not isinstance(s, dict) or not s.get("active", True):
                continue
            val = self._pick_category_value(s, seed_eff, rng)
            if val and str(val).strip():
                chosen.append(str(val))
        return "\n\n".join(chosen)

    def _compose_prompt(self, config, main_prompt, mode, seed_eff, rng):
        parts = []
        if main_prompt and main_prompt.strip():
            parts.append(main_prompt)

        time_val = config.get("time_of_day", -1)
        if time_val >= 0:
            l_prompt = self.get_lighting_description(time_val)
            if l_prompt:
                parts.append(l_prompt)

        cam = config.get("camera", "")
        if cam:
            parts.append(cam)

        pal = config.get("palette", [])
        if pal:
            parts.append(f"color palette: {', '.join(pal)}")

        parts.append(self._compose_categories(config, seed_eff, rng))

        # blocks are joined with blank lines between them
        text = "\n\n".join(p.strip() for p in parts if p.strip())
        form = config.get("_form")
        text = self._expand_form(text, form, rng)
        text = self._expand_wildcards(self._expand_dynamic(text, rng), rng)
        text = self._expand_dynamic(text, rng)  # wildcards may contain {choices}
        if mode in NL_MODES:
            text = self.clean_for_natural_language(text)
        return text

    def _compose_negative(self, config, mode, seed_eff, rng):
        neg = config.get("_negative")
        if not isinstance(neg, dict) or not neg.get("enabled"):
            return ""
        parts = [neg.get("main", "")]
        parts.append(self._compose_categories(neg.get("cats", {}), seed_eff, rng))
        text = "\n\n".join(p.strip() for p in parts if p.strip())
        text = self._expand_form(text, config.get("_form"), rng)
        text = self._expand_wildcards(self._expand_dynamic(text, rng), rng)
        text = self._expand_dynamic(text, rng)
        if mode in NL_MODES:
            text = self.clean_for_natural_language(text)
        return text

    def process(self, node_data, main_prompt, mode, seed, variations=1, **kwargs):
        try:
            config = json.loads(node_data)
        except (ValueError, TypeError):
            config = {}
        config = migrate_config(config)

        # isolated RNG per variation: variation i is deterministic from seed+i,
        # and global random state is never touched
        count = max(1, min(int(variations or 1), 100))
        prompts, negatives = [], []
        for i in range(count):
            seed_eff = (int(seed) + i) % (1 << 64)
            rng = random.Random(seed_eff)
            prompts.append(self._compose_prompt(config, main_prompt, mode, seed_eff, rng))
            negatives.append(self._compose_negative(config, mode, seed_eff, rng))
        return (prompts, negatives)
