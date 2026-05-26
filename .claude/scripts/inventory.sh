#!/usr/bin/env bash
# inventory.sh — canonical interface to the garage inventory.
# Encapsulates every read/write so the agent never composes grep/edits by hand.
#
# Reads (find/list/low-stock) print TSV: a header row, then one row per item.
# Writes (take/add/new) print the resulting item as a JSON object to stdout.
# Errors print {"error": "..."} to stderr and exit non-zero.
#
# Writes target an EXACT note name (resolve fuzzy queries with `find` first).
# `status` is always derived from qty (qty>0 -> in_stock, qty==0 -> out).
#
# Dependencies: bash, python3 (stdlib only).
# Usage: inventory.sh <subcommand> [args]   —   see `inventory.sh --help`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export VAULT_DIR="${VAULT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

python3 - "$@" <<'PY'
import sys, os, json, glob, unicodedata, re

VAULT = os.environ["VAULT_DIR"]
DASHBOARD = "Inventory Dashboard.md"
FIELDS_INT = ("shelf", "qty", "minimum_safe_stock")
# A place is a coded spot: B<n> for a box, W<n> for a wall position, zero-padded to
# >=2 digits. Writes compose it from a validated int (so the script never *produces*
# an invalid place); this pattern is the contract reads check against so a malformed
# value (e.g. a hand-edit) is surfaced rather than trusted silently.
PLACE_RE = re.compile(r"^[BW][0-9]{2,}$")
# Controlled vocabulary for Category — mirror of CONTEXT.md (single source of truth).
CANONICAL_CATEGORIES = ("Electronics", "Cables", "Hardware", "Tools",
                        "Lighting", "Computers", "Household", "Safety",
                        "Instruments", "Uncategorized")

USAGE = """inventory.sh — garage inventory interface

READS (print TSV: header row + one row per item):
  find <query>        items whose name or aliases match <query> (case/accent-insensitive)
  list                every item
  low-stock           items where qty < minimum_safe_stock

WRITES (print resulting item as JSON object; target EXACT note name):
  take --note NAME --n N         decrement qty by N (floors at 0 -> status out)
  add  --note NAME --n N         increment qty by N (status back to in_stock)
  new  --note NAME --shelf S (--box B | --wall W) --qty Q [--min M]
       [--category C] [--aliases "a,b,c"]   create a new item note
                                            (pass exactly one of --box / --wall;
                                             C must be in the controlled vocabulary,
                                             defaults to Uncategorized)
  relocate --note NAME --shelf S (--box B | --wall W)
                                 move an item; restate the FULL location every time —
                                 --shelf and one of --box/--wall are both required,
                                 even if a value is unchanged (forces an explicit place)
  set-category --note NAME --category C    change an item's category
                                           (C must be in the controlled vocabulary)
  migrate                        one-time: rewrite legacy `box: N` to a coded
                                 `place` (zero-padded, e.g. box: 12 -> B12)

A `place` is a coded spot on a shelf: B<n> for a box, W<n> for a wall position,
zero-padded to >=2 digits (B03, W12). Positions and shelves are >= 1 (no zero).
Resolve a fuzzy phrase with `find` first, then call take/add on the exact name.
"""

def die(msg, code=1):
    sys.stderr.write(json.dumps({"error": msg}) + "\n")
    sys.exit(code)

def fold(s):
    return "".join(c for c in unicodedata.normalize("NFKD", str(s))
                    if not unicodedata.combining(c)).lower()

def item_paths():
    for p in sorted(glob.glob(os.path.join(VAULT, "*.md"))):
        if os.path.basename(p) != DASHBOARD:
            yield p

def split_frontmatter(text):
    """Return (fm_lines, start_idx, end_idx, all_lines) or (None, ...) if no frontmatter."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, None, None, lines
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return lines[1:i], 1, i, lines
    return None, None, None, lines

def parse_aliases(val):
    val = val.strip()
    if val.startswith("[") and val.endswith("]"):
        val = val[1:-1]
    return [a.strip().strip('"\'') for a in val.split(",") if a.strip()]

def parse(path):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm, _, _, _ = split_frontmatter(text)
    rec = {"note": os.path.splitext(os.path.basename(path))[0], "path": path,
           "shelf": None, "place": None, "qty": None, "minimum_safe_stock": 0,
           "category": None, "aliases": [], "status": None}
    if fm is None:
        return rec
    for line in fm:
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip(), val.strip()
        if key in FIELDS_INT:
            try: rec[key] = int(val)
            except ValueError: pass
        elif key == "aliases":
            rec[key] = parse_aliases(val)
        elif key in ("category", "status", "place"):
            rec[key] = val or None
    return rec

def record(rec):
    return {k: rec[k] for k in
            ("note", "shelf", "place", "qty", "minimum_safe_stock", "category", "status")}

def malformed_place(place):
    """A place is malformed when present but not matching the contract. Composed
    writes are always valid, so this only ever fires on hand-edited/corrupt notes."""
    return place is not None and not PLACE_RE.match(place)

def warn_malformed(recs):
    """Reads must not trust a stored place silently: emit a non-fatal warning to
    stderr for every record whose place is malformed. The TSV (stdout) still prints."""
    for r in recs:
        if malformed_place(r["place"]):
            sys.stderr.write(json.dumps(
                {"warning": f"note '{r['note']}' has a malformed place '{r['place']}' "
                            f"(expected B<n>/W<n>, e.g. B03)"}) + "\n")

def attach_place_warning(out):
    """Single-note writes flag (not fail) a pre-existing malformed place so the
    operator sees the corruption. Kept on its own key to never clobber other warnings."""
    if malformed_place(out.get("place")):
        out["place_warning"] = (f"place '{out['place']}' is malformed "
                                 f"(expected B<n>/W<n>, e.g. B03)")
    return out

# Reads emit TSV: keys stated once in the header, then one row per item.
# Leaner than JSON for a flat list and still trivially parseable. Writes stay JSON.
TSV_COLS = ("note", "shelf", "place", "qty", "minimum_safe_stock", "category", "status")
TSV_HEADER = ("note", "shelf", "place", "qty", "min", "category", "status")

def tsv(recs):
    rows = ["\t".join(TSV_HEADER)]
    for r in recs:
        rows.append("\t".join("" if r[c] is None else str(r[c]) for c in TSV_COLS))
    return "\n".join(rows)

def find_matches(query):
    q = fold(query)
    out = []
    for p in item_paths():
        r = parse(p)
        hay = [r["note"]] + (r["aliases"] or [])
        if any(q in fold(h) for h in hay):
            out.append(r)
    return out

def resolve_exact(name):
    path = os.path.join(VAULT, name + ".md")
    if not os.path.isfile(path):
        die(f"no item note named '{name}' (resolve with `find` first)")
    return path

def status_for(qty):
    return "in_stock" if qty > 0 else "out"

def rewrite_qty(path, new_qty):
    """Line-level rewrite of qty + status, preserving everything else."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm, start, end, lines = split_frontmatter(text)
    if fm is None:
        die(f"note '{os.path.basename(path)}' has no frontmatter")
    new_status = status_for(new_qty)
    saw_qty = saw_status = False
    for i in range(start, end):
        key = lines[i].split(":", 1)[0].strip()
        if key == "qty":
            lines[i] = f"qty: {new_qty}"; saw_qty = True
        elif key == "status":
            lines[i] = f"status: {new_status}"; saw_status = True
    if not saw_qty:
        die(f"note '{os.path.basename(path)}' has no qty field")
    if not saw_status:
        lines.insert(end, f"status: {new_status}")
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

def rewrite_category(path, new_category):
    """Line-level rewrite of the category field, preserving everything else."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm, start, end, lines = split_frontmatter(text)
    if fm is None:
        die(f"note '{os.path.basename(path)}' has no frontmatter")
    saw_category = False
    for i in range(start, end):
        key = lines[i].split(":", 1)[0].strip()
        if key == "category":
            lines[i] = f"category: {new_category}"; saw_category = True
    if not saw_category:
        lines.insert(end, f"category: {new_category}")
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

# ---------- argument helpers ----------
def get_flags(args):
    flags, i = {}, 0
    while i < len(args):
        a = args[i]
        if not a.startswith("--"):
            die(f"unexpected argument '{a}'")
        if i + 1 >= len(args) or args[i + 1].startswith("--"):
            die(f"flag '{a}' expects a value")
        flags[a[2:]] = args[i + 1]
        i += 2
    return flags

def need_int(flags, key):
    if key not in flags:
        die(f"missing required --{key}")
    try:
        return int(flags[key])
    except ValueError:
        die(f"--{key} must be an integer, got '{flags[key]}'")

def validate_category(category):
    if category not in CANONICAL_CATEGORIES:
        die(f"category '{category}' is not in the controlled vocabulary "
            f"({', '.join(CANONICAL_CATEGORIES)}). "
            f"DO NOT invent a category. First read .claude/CONTEXT.md and reuse a "
            f"canonical value if one fits. If none fits, ASK THE USER to approve a new "
            f"category before proceeding — and on approval add it to BOTH CONTEXT.md "
            f"and the CANONICAL_CATEGORIES tuple in inventory.sh, then retry.")

def need_int_min(flags, key, minimum):
    v = need_int(flags, key)
    if v < minimum:
        die(f"--{key} must be >= {minimum}, got {v}")
    return v

def place_from_flags(flags):
    """Compose a normalized place code from exactly one of --box / --wall.

    `place` is the only Location field besides `shelf`: B<n> for a box, W<n> for a
    wall position, zero-padded to >=2 digits. The Surface (box vs wall) is encoded in
    the prefix and read back from it — never stored separately.
    """
    has_box, has_wall = "box" in flags, "wall" in flags
    if has_box and has_wall:
        die("pass exactly one of --box / --wall, not both")
    if not (has_box or has_wall):
        die("pass exactly one of --box / --wall")
    key = "box" if has_box else "wall"
    n = need_int_min(flags, key, 1)
    return f"{'B' if has_box else 'W'}{n:02d}"

def rewrite_fields(path, updates):
    """Update the given frontmatter fields in place, inserting any missing ones just
    before the closing fence. `updates` maps field name -> stringified value."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    fm, start, end, lines = split_frontmatter(text)
    if fm is None:
        die(f"note '{os.path.basename(path)}' has no frontmatter")
    seen = set()
    for i in range(start, end):
        key = lines[i].split(":", 1)[0].strip()
        if key in updates:
            lines[i] = f"{key}: {updates[key]}"; seen.add(key)
    for off, key in enumerate(k for k in updates if k not in seen):
        lines.insert(end + off, f"{key}: {updates[key]}")
    text = "\n".join(lines)
    if not text.endswith("\n"):
        text += "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)

# ---------- dispatch ----------
args = sys.argv[1:]
if not args or args[0] in ("-h", "--help", "help"):
    sys.stdout.write(USAGE)
    sys.exit(0)

cmd, rest = args[0], args[1:]

if cmd == "find":
    if not rest:
        die("find needs a query")
    recs = [record(r) for r in find_matches(" ".join(rest))]
    warn_malformed(recs)
    print(tsv(recs))

elif cmd == "list":
    recs = [record(parse(p)) for p in item_paths()]
    warn_malformed(recs)
    print(tsv(recs))

elif cmd == "low-stock":
    recs = [record(parse(p)) for p in item_paths()]
    recs = [r for r in recs if r["qty"] is not None and r["qty"] < (r["minimum_safe_stock"] or 0)]
    warn_malformed(recs)
    print(tsv(recs))

elif cmd in ("take", "add"):
    flags = get_flags(rest)
    if "note" not in flags:
        die(f"{cmd} requires --note NAME")
    n = need_int(flags, "n")
    if n < 0:
        die("--n must be >= 0")
    path = resolve_exact(flags["note"])
    cur = parse(path)["qty"] or 0
    new_qty = max(0, cur - n) if cmd == "take" else cur + n
    rewrite_qty(path, new_qty)
    out = record(parse(path))
    if cmd == "take" and n > cur:
        out["warning"] = f"requested {n} but only {cur} on hand; floored at 0"
    attach_place_warning(out)
    print(json.dumps(out, ensure_ascii=False))

elif cmd == "new":
    flags = get_flags(rest)
    if "note" not in flags:
        die("new requires --note NAME")
    name = flags["note"]
    path = os.path.join(VAULT, name + ".md")
    if os.path.exists(path):
        die(f"item '{name}' already exists")
    shelf = need_int_min(flags, "shelf", 1)
    place = place_from_flags(flags)
    qty = need_int(flags, "qty")
    if qty < 0:
        die("--qty must be >= 0")
    minimum = need_int_min(flags, "min", 0) if "min" in flags else 0
    category = flags.get("category", "Uncategorized")
    validate_category(category)
    aliases = parse_aliases(flags.get("aliases", ""))
    al = "[" + ", ".join(aliases) + "]" if aliases else "[]"
    body = (f"---\nshelf: {shelf}\nplace: {place}\nqty: {qty}\n"
            f"minimum_safe_stock: {minimum}\ncategory: {category}\n"
            f"aliases: {al}\nstatus: {status_for(qty)}\n---\n\n# {name}\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    print(json.dumps(record(parse(path)), ensure_ascii=False))

elif cmd == "set-category":
    flags = get_flags(rest)
    if "note" not in flags:
        die("set-category requires --note NAME")
    if "category" not in flags:
        die("set-category requires --category C")
    category = flags["category"]
    validate_category(category)
    path = resolve_exact(flags["note"])
    rewrite_category(path, category)
    print(json.dumps(attach_place_warning(record(parse(path))), ensure_ascii=False))

elif cmd == "relocate":
    # Every relocate restates the FULL location: --shelf and exactly one of
    # --box / --wall are both required, even when a value is unchanged (B05 -> B05).
    # This forces the place to be declared explicitly — you can't move only the shelf
    # and silently leave the place ambiguous.
    flags = get_flags(rest)
    if "note" not in flags:
        die("relocate requires --note NAME")
    path = resolve_exact(flags["note"])
    shelf = need_int_min(flags, "shelf", 1)   # required
    place = place_from_flags(flags)            # required: exactly one of --box/--wall
    rewrite_fields(path, {"shelf": str(shelf), "place": place})
    print(json.dumps(record(parse(path)), ensure_ascii=False))

elif cmd == "migrate":
    # One-time: rewrite the legacy integer `box: N` field to a coded `place`
    # (zero-padded to >=2 digits, e.g. box: 12 -> B12; never B012).
    # Idempotent — notes that already carry `place` are left untouched, except that
    # a leftover legacy `box:` line is stripped (place is authoritative).
    migrated, cleaned, skipped = [], [], []
    for p in item_paths():
        base = os.path.splitext(os.path.basename(p))[0]
        with open(p, encoding="utf-8") as f:
            text = f.read()
        fm, start, end, lines = split_frontmatter(text)
        if fm is None:
            skipped.append({"note": base, "reason": "no frontmatter"}); continue
        keys = [lines[i].split(":", 1)[0].strip() for i in range(start, end)]
        if "place" in keys:
            if "box" in keys:
                # already on the place schema but carries an orphan legacy box: drop it
                del lines[start + keys.index("box")]
                out = "\n".join(lines)
                if not out.endswith("\n"):
                    out += "\n"
                with open(p, "w", encoding="utf-8") as f:
                    f.write(out)
                cleaned.append({"note": base, "reason": "removed orphan box field"})
            else:
                skipped.append({"note": base, "reason": "already has place"})
            continue
        if "box" not in keys:
            skipped.append({"note": base, "reason": "no box field"}); continue
        i = start + keys.index("box")
        raw = lines[i].split(":", 1)[1].strip()
        try:
            n = int(raw)
        except ValueError:
            skipped.append({"note": base, "reason": f"box not an integer: '{raw}'"}); continue
        if n < 1:
            skipped.append({"note": base, "reason": f"box < 1: {n}"}); continue
        code = f"B{n:02d}"
        lines[i] = f"place: {code}"
        out = "\n".join(lines)
        if not out.endswith("\n"):
            out += "\n"
        with open(p, "w", encoding="utf-8") as f:
            f.write(out)
        migrated.append({"note": base, "place": code})
    print(json.dumps({"migrated": migrated, "cleaned": cleaned, "skipped": skipped},
                     ensure_ascii=False))

else:
    die(f"unknown subcommand '{cmd}' (try --help)")
PY
