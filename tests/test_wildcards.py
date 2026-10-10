# -*- coding: utf-8 -*-
"""Wildcard file resolution tests."""
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))

from PerfectLab import perfectlab_studio as ps  # noqa: E402


def test_wildcards_resolve_and_reload():
    test_file = os.path.join(ps._WC_DIR, "lintertest.txt")
    try:
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("alpha\nbeta\n# comment stays out\n\ngamma\n")
        out = ps.resolve_wildcards("mood: __lintertest__", 20260204)
        assert "mood:" in out
        assert out.split(": ", 1)[1] in ("alpha", "beta", "gamma")
        # deterministic per seed
        assert ps.resolve_wildcards("__lintertest__", 20260204) == \
            ps.resolve_wildcards("__lintertest__", 20260204)
        # unknown file: the token stays, the linter flags it
        assert ps.resolve_wildcards("__missingfile__", 5) == "__missingfile__"
        # a file change on disk re-reads (mtime moves)
        time.sleep(0.02)
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("delta\n")
        assert ps.resolve_wildcards("__lintertest__", 20260204) == "delta"
    finally:
        if os.path.exists(test_file):
            os.remove(test_file)
        ps._WC_CACHE.pop("lintertest", None)


def test_wildcard_then_choices_order():
    """a wildcard line may carry {a|b|c} -- wildcards resolve first"""
    test_file = os.path.join(ps._WC_DIR, "lintertest2.txt")
    try:
        with open(test_file, "w", encoding="utf-8") as f:
            f.write("{red|blue} sky\n")
        out = ps.resolve_choices(
            ps.resolve_wildcards("__lintertest2__", 7), 7)
        assert out in ("red sky", "blue sky")
    finally:
        if os.path.exists(test_file):
            os.remove(test_file)
        ps._WC_CACHE.pop("lintertest2", None)
