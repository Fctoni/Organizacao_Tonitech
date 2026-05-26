---
name: garage-inventory
description: Track physical garage inventory in this Obsidian vault. Use for ANY inventory operation — find where an item is stored, update quantity when the user takes or adds stock, register a new item, or check what is running low. One note per item; all reads and writes go through inventory.sh. This skill is the single source of truth for the vault's schema and workflows.
---

# Garage Inventory

This vault tracks physical items stored in the garage. **One note = one item.**
**Never grep or hand-edit notes** — every operation goes through the script, which
parses and rewrites frontmatter deterministically:

```
SCRIPT=~/obsidian/vaults/Organizacao_Tonitech/.claude/scripts/inventory.sh
```

Reads print **TSV** (a header row, then one row per item); writes print the resulting
item as a **JSON object**; errors print `{"error": ...}` to stderr. `status` is always
derived from `qty` by the script.

## Item schema (managed by the script)

`shelf` (int) · `box` (int) · `qty` (int) · `minimum_safe_stock` (int, reorder
threshold) · `category` (Title Case) · `aliases` (list) · `status` (`in_stock` |
`out`). Naming: Specific Title Case, e.g. `ESP32 DevKit V1`. Language: English.

## Workflows

### Find — "where are the ESP32 modules?"
```bash
"$SCRIPT" find esp32
```
Matches name + aliases (case/accent-insensitive). Report **shelf, box, qty** from the
TSV. Header row only (no data rows) → not tracked yet. Multiple rows → list them.

### Take — "I took 2 ESP32"
1. Run `find` to resolve the **exact** note name (ask the user if several match).
2. `"$SCRIPT" take --note "ESP32 DevKit V1" --n 2`
3. Confirm the returned `qty`. Script floors at 0 and flips `status` to `out`; a
   `warning` appears if you took more than on hand.

### Add to existing — "I added 3 ESP32"
Resolve the exact name via `find`, then:
```bash
"$SCRIPT" add --note "ESP32 DevKit V1" --n 3
```
Script bumps `qty` and restores `status: in_stock`. Confirm the returned qty.

### Low stock — "what's running low?"
```bash
"$SCRIPT" low-stock
```
Returns items where `qty < minimum_safe_stock`.

### New item (does NOT exist) — ASK FIRST, then create
1. Run `find` to confirm it isn't already tracked.
2. Ask the user for **category**, **aliases**, **minimum_safe_stock** (suggest defaults).
3. Confirm **shelf + box + qty**, then:
```bash
"$SCRIPT" new --note "USB Cable 1m" --shelf 3 --box 2 --qty 8 \
  --min 3 --category Cables --aliases "usb, cabo"
```
The script rejects duplicate names. Never create silently.

### Recategorize — "this should be Hardware, not Electronics"
Resolve the exact name via `find`, then:
```bash
"$SCRIPT" set-category --note "Songle SRD-12VDC-SL-C Relay" --category Electronics
```
Rewrites only the `category` field (body and other fields preserved). The script
**rejects** any category outside the controlled vocabulary in `.claude/CONTEXT.md`.
This is the ONLY sanctioned way to change a category — never hand-edit the frontmatter.

## Conventions & decisions
- Domain language (Item, Category, Location, Take/Add, …) → `.claude/CONTEXT.md` (glossary).
- Why the design is the way it is → `.claude/docs/adr/` (TSV-reads/JSON-writes, script-mediated mutation).

## Notes
- `"$SCRIPT" --help` lists every subcommand.
- `test-inventory.sh` (same folder) runs the script against a throwaway vault — run it after editing `inventory.sh`.
- Vault is inventory-ONLY: every root `.md` is an item note except `Inventory Dashboard.md` (live Dataview tables; needs the Dataview community plugin).
