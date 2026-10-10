"""PerfectLab scene/light/style composers -- the LOOK layer as pluggable
parts. Each owns one layer and feeds its section of the Studio config;
the composed text carries the where, the light and the grade."""

import json

from .prompt_assistant import PerfectLabAssistant

LOCATIONS = ["a neon-lit arcade", "a night city street with glowing storefronts",
             "a rooftop terrace at dusk", "a modern office lobby with glass walls",
             "a gym with mirrored walls", "an autumn park with golden leaves",
             "a candlelit restaurant", "an underground skatepark with graffiti walls",
             "a quiet old-town street with cobblestones", "a beach at sunset",
             "a retro diner booth", "a subway platform",
             "a rooftop pool", "an old library with tall shelves",
             "a glass greenhouse full of plants", "a lighthouse on a rocky cliff",
             "a yacht deck at sea", "a winter ski chalet interior",
             "an art gallery with white walls", "a night rooftop with string lights",
             "a red brick wall alley",
             "a plain city crosswalk",
             "a minimalist white marble studio"]
WEATHER = ["a clear sky", "light rain", "thick fog", "soft snowfall",
           "an overcast sky", "a golden haze",
           "a thunderstorm with dark clouds", "a misty morning",
           "strong wind", "a rainbow after rain"]
LIGHTS = ["cold low dawn light with long soft shadows",
          "bright clean morning light with soft shadows",
          "hard midday sun with crisp deep shadows",
          "warm late-afternoon light with gentle contrast",
          "golden hour glow with amber side light",
          "blue hour dusk with cool ambient light",
          "night lit by street lamps and warm practical lights",
          "neon-lit night with colored reflections",
          "classic butterfly light with a small soft shadow under the nose",
          "a bright rim light tracing her outline against a dark background",
          "dramatic split light, one side of the face lit and the other in shadow",
          "strong backlight rendering her as a dark silhouette against a bright background",
          "night lit by a single warm street lamp",
          "a neon sign glow on a dark street",
          "candlelight only in a dark room",
          "car headlights cutting through the dark",
          "cold fluorescent office light at night",
          "a single workshop lamp over a workbench",
          "soft even studio light on polished marble",]
STYLES = ["y2k aesthetic", "cinematic teal and orange grade", "editorial magazine look",
          "dreamy soft-focus atmosphere", "grungy raw-flash look", "cozy warm film look",
          "luxurious golden sheen", "sporty high-energy look", "moody noir contrast",
          "clean bright commercial look",
          "vintage sepia grade", "cyberpunk neon grade",
          "desaturated moody grade", "warm 70s film grade",
          "authentic iPhone candid aesthetic",
          "cinematic shallow depth of field with blurred background",]
FILMS = ["Kodak Portra 400 film look", "Cinestill 800T under tungsten light",
         "Fuji Superia grain", "Ilford black and white", "faded film grain",
         "light leaks",
         "Kodak Gold 200 film look", "Polaroid instant film look",
         "Lomography purple film look", "Tri-X push-processed black and white"]


class PerfectLabScene:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"scene_data": ("STRING", {"default": "{}", "multiline": False})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("scene",)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "Builds the location layer of the prompt: a place, the weather and a free add-on. Wire it into the Shot Series scene slot -- one writer per slot."

    def build(self, scene_data=None):
        try:
            state = json.loads(scene_data or "{}")
        except (ValueError, TypeError):
            state = {}
        parts = []
        if (state.get("location") or "").strip():
            parts.append("the setting is " + state["location"].strip())
        if (state.get("weather") or "").strip():
            parts.append(state["weather"].strip())
        if (state.get("details") or "").strip():
            parts.append(state["details"].strip())
        return (", ".join(parts),)


class PerfectLabLight:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"light_data": ("STRING", {"default": "{}", "multiline": False})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("light",)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "One lighting writer for the whole shoot: pick a setup, or set the hour and reuse the Prompt Assistant's clock phrases. Wire it into the Shot Series light slot -- one writer per slot."

    def build(self, light_data=None):
        try:
            state = json.loads(light_data or "{}")
        except (ValueError, TypeError):
            state = {}
        parts = []
        if (state.get("setup") or "").strip():
            parts.append(state["setup"].strip())
        else:
            hour = state.get("hour")
            if isinstance(hour, (int, float)) and 0 <= int(hour) <= 24:
                phrase = PerfectLabAssistant().get_lighting_description(int(hour))
                if phrase:
                    parts.append(phrase)
        if (state.get("details") or "").strip():
            parts.append(state["details"].strip())
        return (", ".join(parts),)


class PerfectLabStyle:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"style_data": ("STRING", {"default": "{}", "multiline": False})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("style",)
    FUNCTION = "build"
    CATEGORY = "PerfectLab"
    DESCRIPTION = "Sets the grade, the film and an optional color palette of the shoot. Wire it into the Shot Series style slot."

    def build(self, style_data=None):
        try:
            state = json.loads(style_data or "{}")
        except (ValueError, TypeError):
            state = {}
        parts = []
        if (state.get("grade") or "").strip():
            parts.append(state["grade"].strip())
        if (state.get("film") or "").strip():
            parts.append(state["film"].strip())
        palette = state.get("palette") or []
        if isinstance(palette, str):
            palette = [palette] if palette.strip() else []
        palette = [x.strip() for x in palette if x.strip()]
        if palette:
            parts.append("color palette: " + ", ".join(palette))
        if (state.get("details") or "").strip():
            parts.append(state["details"].strip())
        return (", ".join(parts),)


NODE_CLASS_MAPPINGS = {
    "PerfectLabScene": PerfectLabScene,
    "PerfectLabLight": PerfectLabLight,
    "PerfectLabStyle": PerfectLabStyle,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PerfectLabScene": "🧪 PerfectLab – Scene",
    "PerfectLabLight": "🧪 PerfectLab – Light",
    "PerfectLabStyle": "🧪 PerfectLab – Style",
}
