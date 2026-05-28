"""Unit tests for the pure functions in inventory.py.

These complement test-inventory.sh (the black-box CLI contract gate): here we exercise
the now-importable functions directly. VAULT_DIR must exist in the env before importing
the module, because inventory.py reads it at import time; we point it at a throwaway dir.

Run with:  python3 -m pytest .claude/scripts/test_inventory.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("VAULT_DIR", tempfile.mkdtemp(prefix="inv-unit-"))

import pytest

import inventory as inv


# ---------- fold (accent/case-insensitive normalization) ----------
def test_fold_lowercases():
    assert inv.fold("ESP32") == "esp32"

def test_fold_strips_accents():
    assert inv.fold("Parafuso Ção") == "parafuso cao"

def test_fold_accepts_non_str():
    assert inv.fold(42) == "42"


# ---------- status_for (status derived from qty) ----------
@pytest.mark.parametrize("qty,expected", [
    (5, "in_stock"),
    (1, "in_stock"),
    (0, "out"),
])
def test_status_for(qty, expected):
    assert inv.status_for(qty) == expected


# ---------- split_frontmatter ----------
def test_split_frontmatter_well_formed():
    text = "---\nshelf: 1\nqty: 5\n---\n\n# Item\n"
    fm, start, end, lines = inv.split_frontmatter(text)
    assert fm == ["shelf: 1", "qty: 5"]
    assert (start, end) == (1, 3)

def test_split_frontmatter_no_fence_returns_none():
    fm, start, end, lines = inv.split_frontmatter("# Just a body\n")
    assert fm is None and start is None and end is None
    assert lines == ["# Just a body"]

def test_split_frontmatter_unterminated_returns_none():
    fm, *_ = inv.split_frontmatter("---\nshelf: 1\nno closing fence\n")
    assert fm is None


# ---------- parse_aliases ----------
def test_parse_aliases_bracketed_list():
    assert inv.parse_aliases("[ESP32, microcontroller, dev board]") == \
        ["ESP32", "microcontroller", "dev board"]

def test_parse_aliases_empty():
    assert inv.parse_aliases("[]") == []
    assert inv.parse_aliases("") == []

def test_parse_aliases_strips_quotes():
    assert inv.parse_aliases('["usb", \'cabo\']') == ["usb", "cabo"]


# ---------- place_from_flags (Surface encoded in the prefix, zero-padded >=2) ----------
def test_place_from_flags_box_zero_pads():
    assert inv.place_from_flags({"box": "3"}) == "B03"

def test_place_from_flags_wall_zero_pads():
    assert inv.place_from_flags({"wall": "12"}) == "W12"

def test_place_from_flags_large_number_keeps_width():
    assert inv.place_from_flags({"box": "150"}) == "B150"

def test_place_from_flags_rejects_both():
    with pytest.raises(SystemExit):
        inv.place_from_flags({"box": "1", "wall": "1"})

def test_place_from_flags_rejects_neither():
    with pytest.raises(SystemExit):
        inv.place_from_flags({})

def test_place_from_flags_rejects_zero():
    with pytest.raises(SystemExit):
        inv.place_from_flags({"box": "0"})


# ---------- validate_category (controlled vocabulary) ----------
@pytest.mark.parametrize("cat", inv.CANONICAL_CATEGORIES)
def test_validate_category_accepts_canonical(cat):
    assert inv.validate_category(cat) is None  # returns normally, no exit

def test_validate_category_rejects_unknown(capsys):
    with pytest.raises(SystemExit):
        inv.validate_category("Bogus")
    err = capsys.readouterr().err
    assert "CONTEXT.md" in err and "ASK THE USER" in err

def test_validate_category_message_points_at_inventory_py(capsys):
    with pytest.raises(SystemExit):
        inv.validate_category("Bogus")
    assert "inventory.py" in capsys.readouterr().err


# ---------- malformed_place (contract reads check against) ----------
@pytest.mark.parametrize("place,bad", [
    ("B03", False),
    ("W12", False),
    ("B150", False),
    (None, False),       # absent place is not malformed
    ("caixa 9", True),
    ("B3", True),        # not zero-padded to >=2
    ("X01", True),       # bad prefix
])
def test_malformed_place(place, bad):
    assert inv.malformed_place(place) is bad


# ---------- parse (round-trips a note through the filesystem) ----------
def test_parse_reads_fields(tmp_path):
    note = tmp_path / "Widget.md"
    note.write_text(
        "---\nshelf: 2\nplace: B07\nqty: 9\nminimum_safe_stock: 3\n"
        "category: Tools\naliases: [w, gizmo]\nstatus: in_stock\n---\n\n# Widget\n",
        encoding="utf-8")
    rec = inv.parse(str(note))
    assert rec["note"] == "Widget"
    assert rec["shelf"] == 2 and rec["qty"] == 9 and rec["minimum_safe_stock"] == 3
    assert rec["place"] == "B07"
    assert rec["category"] == "Tools"
    assert rec["aliases"] == ["w", "gizmo"]

def test_parse_defaults_min_to_zero(tmp_path):
    note = tmp_path / "Bare.md"
    note.write_text("---\nshelf: 1\nplace: B01\nqty: 1\n---\n\n# Bare\n", encoding="utf-8")
    rec = inv.parse(str(note))
    assert rec["minimum_safe_stock"] == 0
    assert rec["category"] is None
