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
import sys, os, json, glob, unicodedata

VAULT = os.environ["VAULT_DIR"]
DASHBOARD = "Inventory Dashboard.md"
FIELDS_INT = ("shelf", "box", "qty", "minimum_safe_stock")
# Controlled vocabulary for Category — mirror of CONTEXT.md (single source of truth).
CANONICAL_CATEGORIES = ("Electronics", "Cables", "Hardware", "Tools",
                        "Lighting", "Computers", "Household", "Safety", "Uncategorized")

USAGE = """inventory.sh — garage inventory interface

READS (print TSV: header row + one row per item):
  find <query>        items whose name or aliases match <query> (case/accent-insensitive)
  list                every item
  low-stock           items where qty < minimum_safe_stock

WRITES (print resulting item as JSON object; target EXACT note name):
  take --note NAME --n N         decrement qty by N (floors at 0 -> status out)
  add  --note NAME --n N         increment qty by N (status back to in_stock)
  new  --note NAME --shelf S --box B --qty Q [--min M]
       [--category C] [--aliases "a,b,c"]   create a new item note
  set-category --note NAME --category C    change an item's category
                                           (C must be in the controlled vocabulary)

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
           "shelf": None, "box": None, "qty": None, "minimum_safe_stock": 0,
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
        elif key in ("category", "status"):
            rec[key] = val or None
    return rec

def record(rec):
    return {k: rec[k] for k in
            ("note", "shelf", "box", "qty", "minimum_safe_stock", "category", "status")}

# Reads emit TSV: keys stated once in the header, then one row per item.
# Leaner than JSON for a flat list and still trivially parseable. Writes stay JSON.
TSV_COLS = ("note", "shelf", "box", "qty", "minimum_safe_stock", "category", "status")
TSV_HEADER = ("note", "shelf", "box", "qty", "min", "category", "status")

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

# ---------- dispatch ----------
args = sys.argv[1:]
if not args or args[0] in ("-h", "--help", "help"):
    sys.stdout.write(USAGE)
    sys.exit(0)

cmd, rest = args[0], args[1:]

if cmd == "find":
    if not rest:
        die("find needs a query")
    print(tsv(record(r) for r in find_matches(" ".join(rest))))

elif cmd == "list":
    print(tsv(record(parse(p)) for p in item_paths()))

elif cmd == "low-stock":
    recs = (record(parse(p)) for p in item_paths())
    recs = [r for r in recs if r["qty"] is not None and r["qty"] < (r["minimum_safe_stock"] or 0)]
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
    print(json.dumps(out, ensure_ascii=False))

elif cmd == "new":
    flags = get_flags(rest)
    if "note" not in flags:
        die("new requires --note NAME")
    name = flags["note"]
    path = os.path.join(VAULT, name + ".md")
    if os.path.exists(path):
        die(f"item '{name}' already exists")
    shelf = need_int(flags, "shelf")
    box = need_int(flags, "box")
    qty = need_int(flags, "qty")
    minimum = int(flags["min"]) if "min" in flags else 0
    category = flags.get("category", "Uncategorized")
    aliases = parse_aliases(flags.get("aliases", ""))
    al = "[" + ", ".join(aliases) + "]" if aliases else "[]"
    body = (f"---\nshelf: {shelf}\nbox: {box}\nqty: {qty}\n"
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
    if category not in CANONICAL_CATEGORIES:
        die(f"category '{category}' is not in the controlled vocabulary "
            f"({', '.join(CANONICAL_CATEGORIES)})")
    path = resolve_exact(flags["note"])
    rewrite_category(path, category)
    print(json.dumps(record(parse(path)), ensure_ascii=False))

else:
    die(f"unknown subcommand '{cmd}' (try --help)")
PY
