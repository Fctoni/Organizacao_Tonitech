---
name: garage-inventory
description: Track physical garage inventory in this Obsidian vault. Use for ANY inventory operation — find where an item is stored, update quantity when the user takes or adds stock, register a new item, relocate it, recategorize it, or check what is running low. One note per item; all reads and writes go through inventory.sh. This skill is the source of truth for the vault's WORKFLOWS; run `inventory.sh --help` for the command/schema surface and see .claude/CONTEXT.md for domain language.
---

# Garage Inventory

This vault tracks physical items stored in the garage. **One note = one item.**
**Never grep or hand-edit notes** — every read and write goes through the script,
which parses and rewrites frontmatter deterministically:

```
SCRIPT=~/obsidian/vaults/Organizacao_Tonitech/.claude/scripts/inventory.sh
```

**Run `"$SCRIPT" --help` at the start of any inventory task.** It is the single
source of truth for the command surface — every subcommand, its flags, the `place`
code format, and the validation rules. Do not reproduce that list in this skill; read
it live so this skill can never drift from the script.

Reads print **TSV** (header row + one row per item); writes print the resulting item
as a **JSON object**; errors print `{"error": ...}` to stderr. `status` is always
derived from `qty`. Domain terms (Item, Location, Shelf, Place, Surface, Box, Wall,
Category, …) are defined in `.claude/CONTEXT.md` — the glossary is the source of truth
for language.

## Location in one line

An Item's location is a **Shelf** (integer) plus a **Place** — a coded spot written
`B<n>` for a box or `W<n>` for a wall position (e.g. `B03`, `W12`). `--help` shows how
`new`/`relocate` take `--box` / `--wall`; `CONTEXT.md` defines the concepts.

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
3. Ask for **category**, **aliases**, and **minimum_safe_stock** (suggest sensible
   defaults for the last two; `minimum_safe_stock` defaults to 0). `category` MUST be a
   canonical value from `.claude/CONTEXT.md` — the script rejects anything else and its
   error tells you what to do (read the glossary / ask the user before coining one).
4. Create with `new`, passing exactly one of `--box` / `--wall` (see `--help`). The
   script rejects duplicate names.

### Relocate — "I moved the drill to the wall"
Items physically move between boxes and the wall. Use `relocate` to change an Item's
Place (and optionally its Shelf) — it is the sanctioned path; never hand-edit the
frontmatter.

### Recategorize — "this should be Hardware, not Electronics"
Resolve the exact name via `find`, then `set-category`. It rewrites only `category`
(body and other fields preserved) and rejects any value outside the controlled
vocabulary. This is the ONLY sanctioned way to change a category.

## Conventions & decisions
- Domain language → `.claude/CONTEXT.md` (glossary; source of truth for terms).
- Why the design is the way it is → `.claude/docs/adr/` (TSV-reads/JSON-writes,
  script-mediated mutation, coded `place` for Surface + position).
- `migrate` is a one-time command converting legacy `box: N` notes to the coded
  `place` schema; run it once when adopting the new schema.

## Notes
- `test-inventory.sh` (same folder) runs the script against a throwaway vault — run it
  after editing `inventory.sh`.
- Vault is inventory-ONLY: every root `.md` is an item note except
  `Inventory Dashboard.md` (live Dataview tables; needs the Dataview plugin).
