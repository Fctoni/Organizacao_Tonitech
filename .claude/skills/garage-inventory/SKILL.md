---
name: garage-inventory
description: Tracks physical garage inventory in this Obsidian vault. Use for ANY inventory operation — find where an item is stored, update quantity when the user takes or adds stock, register a new item, relocate it, recategorize it, or check what is running low. One note per item; all reads and writes go through inventory.sh. This skill owns workflows; the script's --help owns commands and .claude/CONTEXT.md owns domain language.
---

# Garage Inventory

This vault tracks physical items stored in the garage. **One note = one item.**
**Never grep or hand-edit notes** — every read and write goes through the script,
which parses and rewrites frontmatter deterministically:

Requires Bash, Python 3 (standard library only), and Git for repository discovery. Run this from the current repository or any directory inside it. Paths below are relative to that repository root, not to this skill's folder.

```bash
ROOT="$(git rev-parse --show-toplevel)" &&
SCRIPT="$ROOT/.claude/scripts/inventory.sh" &&
test -x "$SCRIPT" &&
export VAULT_DIR="$ROOT" &&
"$SCRIPT" --help
```

If discovery or the executable check fails, stop and report it. Keep `SCRIPT` and `VAULT_DIR` in the same shell for subsequent calls; when tools use separate shells, repeat the setup. Setting `VAULT_DIR` explicitly prevents an inherited override from selecting another vault.

**Run `"$SCRIPT" --help` at the start of any inventory task.** It is the single
source of truth for the command surface — every subcommand, its flags, the `place`
code format, and the validation rules. Do not reproduce that list in this skill; read
it live so this skill can never drift from the script.

Operational reads print **TSV** (header row + one row per item); full export prints deterministic JSON with recoverable originals. Single-item writes print the resulting item as a **JSON object**. Migration prints a JSON summary. Errors print `{"error": ...}` to stderr. Report warnings too, including malformed locations. Domain terms and the controlled category vocabulary live in `.claude/CONTEXT.md`; read it before choosing a category or interpreting a location.

## Workflows — the judgment that `--help` can't carry

### Find — "where are the ESP32 modules?"
`find <query>` matches name + aliases (case/accent-insensitive). Report **shelf,
place, qty** from the TSV. Header row only → not tracked yet. Multiple rows → list
them and let the user pick.

### Take / Add — "I took 2 ESP32" / "I added 3"
1. Run `find` first to resolve the **exact** note name (ask the user if several match).
2. Call `take` / `add` on that exact name.
3. Confirm the returned `qty`. Take floors at 0 and flips `status` to `out`; a
   `warning` means you took more than on hand.

### Low stock — "what's running low?"
`low-stock` returns items where `qty < minimum_safe_stock`.

### New item — ASK FIRST, never create silently
1. Run `find` to confirm it isn't already tracked.
2. **Always ask the user for the full location — Shelf and Place (box or wall). There
   is no default location: do not assume a shelf, box, or wall.**
3. Ask for the initial **qty**, **category**, **aliases**, and **minimum_safe_stock** (suggest sensible
   defaults for the last two; `minimum_safe_stock` defaults to 0). `category` MUST be a
   canonical value from `.claude/CONTEXT.md` — the script rejects anything else and its
   error tells you what to do (read the glossary / ask the user before coining one).
4. Create with `new`, passing exactly one of `--box` / `--wall` (see `--help`). The
   script rejects duplicate names.

### Relocate — "I moved the drill to the wall"
Resolve the exact name via `find` first. Items physically move between boxes and the wall. Use `relocate` (the sanctioned path;
never hand-edit). It **restates the full location every time**: always pass `--shelf`
AND exactly one of `--box` / `--wall`, even if one value is unchanged (`B05` → `B05`).
There is no shelf-only move — you must declare the place explicitly so it can't be left
ambiguous.

### Recategorize — "this should be Hardware, not Electronics"
Resolve the exact name via `find`, then `set-category`. It updates `category` and recomputes `status`, preserving the body and other fields. It rejects values outside the controlled vocabulary. This is the ONLY sanctioned way to change a category.

## Conventions & decisions
- Domain language → `.claude/CONTEXT.md` (glossary; source of truth for terms).
- Why the design is the way it is → `.claude/docs/adr/` (TSV-reads/JSON-writes,
  script-mediated mutation, coded `place` for Surface + position).
- `migrate` converts legacy `box: N` notes to the coded `place` schema and removes orphan `box` fields when `place` already exists. It is idempotent. Review its `migrated`, `cleaned`, and `skipped` summary; skipped invalid notes still need attention.

## Notes
- After editing, run `TMPDIR=/tmp/opencode bash "$ROOT/.claude/scripts/test-inventory.sh"` and `TMPDIR=/tmp/opencode python3 "$ROOT/.claude/scripts/test-inventory-boundaries.py"`. Create `/tmp/opencode` first if absent. Tests use isolated fixtures; never point mutation tests at the real vault. Raw fixture construction and assertions are confined to the test harness; real item access always uses `inventory.sh`.
- After changing export, also run `TMPDIR=/tmp/opencode python3 "$ROOT/.claude/scripts/test-inventory-export.py"`.
- Root `.md` files are Item notes except `Inventory Dashboard.md` (live Dataview tables; needs the Dataview plugin) and `AGENTS.md` (agent instructions).
