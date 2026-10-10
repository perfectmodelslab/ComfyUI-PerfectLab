# -*- coding: utf-8 -*-
"""PerfectLab composer and mirror-parity tests.

Run from the custom_nodes directory:  pytest PerfectLab/tests -q

The parity test regenerates web/perfectlab_libraries.js from the Python
sources and fails when the committed copy is stale, so the panel can
never ship fewer chips than the engine has entries.
"""
import os
import subprocess
import sys

import pytest

CUSTOM_NODES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, CUSTOM_NODES)

from PerfectLab.person_node import compose_blocks  # noqa: E402
from PerfectLab.wardrobe_node import compose_look  # noqa: E402
from PerfectLab import perfectlab_studio  # noqa: E402


def test_footwear_color_and_material_ride():
    text = compose_look({
        "top": "a cropped tank top", "bottom": "a pleated mini skirt",
        "footwear": "chunky sneakers", "footwear_color": "white",
        "footwear_material": "leather"})
    assert "leather chunky sneakers in white" in text


def test_footwear_alone_with_color():
    text = compose_look({"footwear": "pool slides", "footwear_color": "gold"})
    assert "pool slides in gold" in text


def test_accessories_take_their_color():
    text = compose_look({"top": "a baby tee",
                         "accessories": ["layered necklaces"], "acc_color": "gold"})
    assert "layered necklaces in gold" in text


def test_headwear_color_prefixes():
    text = compose_look({"top": "a baby tee", "headwear": "a beret", "headwear_color": "red"})
    assert "red beret" in text


def test_none_placeholder_clears_slot():
    text = compose_look({"top": "— none —", "bottom": "cargo shorts"})
    assert "wearing cargo shorts" in text


def test_trigger_leads_and_drops_face_blocks():
    blocks = compose_blocks({
        "trigger": "JW",
        "fields": {"gender": "a young woman", "hair": "beachy curls",
                   "eyes": "emerald green eyes", "skin": "sun-kissed skin",
                   "signature": ["a tiny beauty mark"]}})
    joined = ", ".join(blocks.values())
    assert "JW" in blocks.get("identity", "")
    assert "beachy curls" not in joined          # hair is a face block
    assert "emerald green eyes" not in joined   # eyes ride the face block
    assert "sun-kissed skin" not in joined      # skin rides the skin block
    assert "tiny beauty mark" in joined         # signature stays


def test_no_trigger_keeps_face_blocks():
    blocks = compose_blocks({"fields": {"hair": "beachy curls", "eyes": "emerald green eyes"}})
    joined = ", ".join(blocks.values())
    assert "beachy curls" in joined
    assert "emerald green eyes" in joined


def test_negative_presets_join_the_custom_line():
    negs = perfectlab_studio._negatives({
        "negative": {"enabled": True,
                     "presets": ["deformed hands, extra fingers", "text, watermark"],
                     "text": "my own line"}}, 2)
    assert "deformed hands, extra fingers" in negs[0]
    assert "text, watermark" in negs[0]
    assert "my own line" in negs[0]


def test_negative_disabled_is_empty():
    negs = perfectlab_studio._negatives({
        "negative": {"enabled": False, "presets": ["text, watermark"], "text": "x"}}, 2)
    assert negs == ["", ""]


def test_lens_rides_the_style_slot():
    config = {"_v": 2,
              "style": {"grade": "cinematic teal and orange grade"},
              "camera": {"framings": {"mode": "all", "set": [], "pin": None},
                         "focus": {"mode": "all", "set": [], "pin": None},
                         "formats": {"mode": "pin", "set": [], "pin": 0},
                         "lens": "an 85mm portrait lens with shallow depth of field"}}
    slots = perfectlab_studio.compose_slots(config, 1, 42)
    assert "85mm" in slots["style"]
    assert "cinematic teal and orange grade" in slots["style"]


def test_mirror_file_is_fresh():
    repo = os.path.join(CUSTOM_NODES, "PerfectLab")
    gen = os.path.join(repo, "web", "perfectlab_libraries.js")
    before = open(gen, encoding="utf-8").read()
    subprocess.run([sys.executable, os.path.join(repo, "tools", "build_libraries.py")],
                   check=True, capture_output=True)
    after = open(gen, encoding="utf-8").read()
    assert before == after, (
        "web/perfectlab_libraries.js is stale -- a Python library list changed. "
        "Run: python tools/build_libraries.py")


def test_js_compose_look_matches_engine():
    """the panel preview must compose the exact text the engine outputs"""
    import json
    repo = os.path.join(CUSTOM_NODES, "PerfectLab")
    cases = [
        {"top": "a cropped tank top", "top_color": "champagne gold", "top_material": "silk",
         "bottom": "a pleated mini skirt", "bottom_color": "jet black", "bottom_material": "satin",
         "footwear": "chunky sneakers", "footwear_color": "white", "footwear_material": "leather",
         "accessories": ["layered necklaces"], "acc_color": "gold",
         "headwear": "a beret", "headwear_color": "red", "details": "windswept"},
        {"footwear": "pool slides", "footwear_color": "gold"},
        {"headwear": "a beret", "headwear_color": "red"},
        {"top": "— none —", "bottom": "cargo shorts"},
        {"accessories": ["a choker"], "acc_color": "silver"},
    ]
    lib_url = "file:///" + os.path.join(repo, "web", "perfectlab_lib.js").replace("\\", "/")
    code = ("import { composeLook } from '" + lib_url + "';\n" +
            "const cases = " + json.dumps(cases) + ";\n" +
            "console.log(JSON.stringify(cases.map(c => composeLook(c))));")
    r = subprocess.run(["node", "--input-type=module", "-e", code],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    js_results = json.loads(r.stdout)
    for case, js_text in zip(cases, js_results):
        py_text = compose_look(case)
        assert js_text == py_text, f"drift: {case} | js: {js_text} | py: {py_text}"


def test_inline_choices_deterministic_and_nested():
    from PerfectLab.perfectlab_studio import resolve_choices
    t = "a {red|green|blue} dress on a {rainy|sunny} day, {a {one|two} nested}"
    a = resolve_choices(t, 20260204)
    b = resolve_choices(t, 20260204)
    assert a == b, "the same seed must pick the same alternatives"
    assert "{" not in a, "all braces must resolve: " + a
    assert resolve_choices(t, 7) != a or resolve_choices(t, 11) != a,         "some other seed must roll at least one different alternative"


def test_inline_choices_parity_js():
    """the panel preview must pick what the engine picks"""
    import json
    from PerfectLab.perfectlab_studio import resolve_choices
    repo = os.path.join(CUSTOM_NODES, "PerfectLab")
    lib_url = "file:///" + os.path.join(repo, "web", "perfectlab_lib.js").replace("\\", "/")
    cases = [
        ["{red|green|blue} dress", 20260204],
        ["a {rainy|sunny} day and {one|two|three} more", 999],
        ["{a {x|y} nest}", 42],
        ["no braces at all", 5],
    ]
    code = ("import { resolveChoices } from '" + lib_url + "';\n" +
            "const cases = " + json.dumps(cases) + ";\n" +
            "console.log(JSON.stringify(cases.map(c => resolveChoices(c[0], c[1]))));")
    r = subprocess.run(["node", "--input-type=module", "-e", code],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    js = json.loads(r.stdout)
    for (text, seed), js_text in zip(cases, js):
        py_text = resolve_choices(text, seed)
        assert js_text == py_text, f"choice drift: {text} | js: {js_text} | py: {py_text}"


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
