# Garage Inventory

The ubiquitous language for the garage inventory vault: what each domain term means
and which words to avoid. This is a glossary, not a spec — workflows live in the
`garage-inventory` skill.

## Language

**Item**:
A *kind* of thing stored in the garage, represented by exactly one note. `qty` counts
identical units of that kind — the vault never tracks an individual physical unit.
An Item has exactly one location; the same product split across two boxes is not one
Item with two locations.
_Avoid_: product, unit, piece, SKU (a "unit"/"piece" is one of the things an Item counts).

**Category**:
The single bucket an Item belongs to, from a controlled vocabulary. One Item has
exactly one Category. Canonical values: **Electronics**, **Hardware**, **Cables**,
**Tools**, plus **Uncategorized** as the catch-all. Title Case. Extend this list
deliberately (record the addition here) — don't coin a category ad hoc.
_Avoid_: type, kind, group, tag (a "tag" would be multi-valued; Category is single).

**Aliases**:
Alternative search terms for an Item so `find` matches loose phrasing (e.g. ESP32 →
"microcontroller", parafuso). Purely for retrieval — Aliases are NOT classification
and carry no grouping meaning.
_Avoid_: tags, labels, synonyms-as-categories.

**Location**:
Where an Item is stored, given as a (**Shelf**, **Box**) pair. Shelf and Box are
integers. Box numbering restarts on each Shelf, so the full address is always both
numbers together — Shelf 1 / Box 3 is a different Box from Shelf 2 / Box 3.
_Avoid_: place, spot, bin, position.

**Quantity** (`qty`):
The number of units of an Item currently on hand. Changed only via Take and Add.
_Avoid_: count, amount, stock (reserve "stock" for the threshold terms below).

**Minimum Safe Stock** (`minimum_safe_stock`):
The reorder threshold for an Item. When Quantity drops below it, the Item is Low
Stock. `0` means never flag.
_Avoid_: min, reorder point, par level.

**Status**:
A *derived* label, never set by hand: **in_stock** when Quantity > 0, **out** when
Quantity is 0. The script recomputes it on every write.
_Avoid_: state, availability.

**Low Stock**:
The condition where an Item's Quantity is below its Minimum Safe Stock (`qty <
minimum_safe_stock`). A derived condition, not a stored field.
_Avoid_: running low, understocked, needs reorder.

**Take**:
The action of removing units from an Item, decreasing Quantity (floors at 0).
_Avoid_: remove, withdraw, use, consume.

**Add**:
The action of putting units into an existing Item, increasing Quantity. Distinct from
creating a brand-new Item (which registers a note that did not exist).
_Avoid_: restock, deposit, increment, return.
