# Location uses a coded `place`, not a `box` integer

An Item's Location is a Shelf (integer) plus a single coded `place` field. `place`
encodes both the **Surface** the Item sits on and its position there: `B`+number for
a **Box**, `W`+number for a **Wall** position — uppercase, zero-padded to at least 2
digits (e.g. `B03`, `W12`). This replaces the former integer `box` field, because
some Items hang on a Shelf's wall instead of sitting in a box, so a Shelf now offers
two Surfaces (Box and Wall) with independent per-Shelf numbering.

The letter prefix encodes the Surface; the digits encode the position. The Surface is
read *on demand* from the prefix — it is **not** stored as a field (this differs from
`status`, which is materialized in frontmatter and recomputed on every write).

## Format and validation

- Stored form matches `^[BW][0-9]{2,}$`, prefix uppercased.
- The numeric position is **≥ 1** — `B00`/`W00` are rejected. The Shelf is likewise
  **≥ 1**. There is no zero or negative address anywhere.
- The canonical stored value is always the normalized, zero-padded form: position 3 is
  always `B03`, never `B3`. The script normalizes on write so equality and display are
  unambiguous.
- The contract is the regex `^[BW][0-9]{2,}$`, held in the script (`PLACE_RE`). Writes
  *compose* the code from a validated integer, so the script never **produces** an
  invalid place. Reads do not trust the stored value blindly: a note whose `place` is
  malformed (e.g. a hand-edit like `X01` or `caixa 9`) is surfaced — `find`/`list`/
  `low-stock` emit a non-fatal warning to stderr (the row still prints), and a
  single-note write attaches a `place_warning`. So a corrupt place is flagged, not
  parsed silently — a deliberate trade for losing integer typing on `box`.

## Considered options

- **Separate mutually-exclusive `box` / `wall` integer fields.** Additive, leaves
  existing notes untouched. Rejected: two fields to keep mutually exclusive, and reads
  would still need a derived "which one is set" column.
- **Neutral `slot` (int) + `placement` (box|wall).** Rejected: forces migrating every
  note *and* splits one concept across two fields with no gain over the code.
- **Coded single `place` string (chosen).** One field carries Surface + position in
  the operator's own shorthand (`B03`/`W03`); the contract is one regex enforced in the
  script. Sorting is *not* a justification — see Consequences.

## Consequences

- **Glossary (CONTEXT.md) must be updated**, since this changes the ubiquitous
  language: redefine **Location** as `(Shelf, place)`; add **Surface** and **Wall**;
  reposition **Box** as one of two Surfaces; and remove `place`/`position` from
  Location's `_Avoid_` list — "Place" is promoted to a canonical term with the narrow
  meaning "the Surface-plus-position within a Shelf" (distinct from Location = Shelf +
  Place). Without this, code and glossary contradict each other.
- **Reads (ADR-0001).** The TSV `box` column and the JSON `box` key are replaced by
  `place`, carrying the raw code (`B03`/`W03`). No separate `surface` column is added —
  the prefix is self-describing and keeps the read contract lean.
- **The Inventory Dashboard must migrate too.** It references `box` in 7 Dataview
  queries/filters. Dataview reads raw frontmatter and does **not** run the script, so it
  cannot derive the Surface — dashboard queries filter on the `place` string itself
  (e.g. `contains(place, "W")` for wall Items). A lone box filter becomes
  `place = "B03"` rather than `box = 3`: less ergonomic, an accepted cost.
- **No clean lexicographic sort.** Because `place` is a string, Dataview's
  string sort puts all `B*` before all `W*`, and breaks once positions exceed 99
  (`B100 < B99`). The script sorts numerically by parsing the digits; the dashboard's
  string sort is a known, accepted limitation (a garage shelf is unlikely to exceed 99
  positions on a Surface).
- **All mutation of `place` goes through the script (ADR-0002), including
  relocation.** `place` is written by `new` and by a `relocate` subcommand. Both take
  exactly one of `--box N` / `--wall N` (N ≥ 1); passing both, or neither, is an error.
  `relocate` **also requires `--shelf`** — every relocate restates the *full* location
  (shelf + place), even when a value is unchanged (`B05` → `B05`). This is deliberate:
  it forbids an implicit shelf-only move that would leave the place undeclared, forcing
  the operator (or agent) to state the place explicitly each time. Items physically move
  between box and wall, so relocation is in scope precisely so nobody hand-edits
  frontmatter.
- **Migration is a one-time sanctioned script routine, not a hand-edit.** It reads each
  legacy `box: N` and rewrites it to `place: B<zero-padded N>` (so `box: 12` → `B12`,
  not `B012`), guarded by `test-inventory.sh`. After migration the script knows only
  `place`; a note left with a bare `box:` fails with "no place" until migrated.
