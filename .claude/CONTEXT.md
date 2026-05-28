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
exactly one Category. Canonical values:

- **Electronics** — signal/logic-level components and modules you wire into a circuit:
  boards, sensors, relay modules, level shifters, DACs, micro switches, connectors, servos.
- **Cables** — conductors of any gauge: USB cables, power wires (e.g. 4mm/6mm).
- **Hardware** — mechanical / power-electromechanical / fluid parts: valves, pumps, fasteners.
  Acts on the physical world, not on a circuit.
- **Tools** — hand and power tools.
- **Lighting** — bulbs and luminaires.
- **Computers** — PC parts and peripherals (e.g. CPU coolers).
- **Household** — non-workshop home goods: coolers, small appliances, storage containers.
- **Safety** — PPE and protective equipment.
- **Instruments** — bench test & measurement equipment: oscilloscopes, multimeters,
  bench power supplies, signal generators. Distinct from *Tools* (hand/power tools that
  shape or fasten) and from *Electronics* (components wired into a circuit) — an
  Instrument measures or sources signals for testing, it isn't a circuit component.
- **Groceries** — consumable food and pantry staples stored in the garage (flour,
  pet food, and the like). Distinct from *Household* (durable non-food home goods).
- **Uncategorized** — the catch-all.

The **Electronics × Hardware** boundary is the one to get right: *Electronics* is a
signal/circuit component; *Hardware* is a mechanical/fluid/power actuator. A **relay**
— whether a bare electromechanical component (e.g. Songle SRD) or a driver module — is
Electronics; a solenoid **valve** or a **pump** is Hardware.

Title Case. Extend this list deliberately — don't coin a category ad hoc. The script
**enforces** this vocabulary: `inventory.sh new` and `set-category` reject any value
outside it. To add a category you must update **both** this list **and** the
`CANONICAL_CATEGORIES` tuple in `.claude/scripts/inventory.py` (this glossary is the
source of truth; the tuple mirrors it).
_Avoid_: type, kind, group, tag (a "tag" would be multi-valued; Category is single).

**Aliases**:
Alternative search terms for an Item so `find` matches loose phrasing (e.g. ESP32 →
"microcontroller", parafuso). Purely for retrieval — Aliases are NOT classification
and carry no grouping meaning.
_Avoid_: tags, labels, synonyms-as-categories.

**Location**:
Where an Item is stored, given as a (**Shelf**, **Place**) pair. The Shelf is an
integer (≥ 1); the Place names a spot on one of the Shelf's two **Surfaces**. The
address is always both together — Place numbering restarts on each Shelf, so
Shelf 1 / B03 is a different spot from Shelf 2 / B03.
_Avoid_: collapsing Shelf and Place into one field; "address" as a stored value.

**Surface**:
One of the two kinds of spot a Shelf offers: a **Box** or the **Wall**. Every Item
sits on exactly one Surface. The Box↔Wall distinction is *physical placement*, not a
Category — a Tool may live in a Box and an Electronics module may hang on the Wall.

**Box**:
An opaque container on a Shelf, identified by a number. One of the two Surfaces.
Because a Box hides its contents, it needs an index to be found at all.
_Avoid_: bin, container, drawer.

**Wall**:
The visible panel of a Shelf where Items are hung or clamped, with numbered
positions. The other Surface alongside Box. Box and Wall numbering are *independent*
per Shelf — B03 and W03 on the same Shelf are different spots.
_Avoid_: pegboard, panel, rack, hook (those are the physical object; Wall is the term).

**Place** (`place`):
The second component of a Location: the Surface plus its number on a Shelf, written
as a single code — `B` + number for a Box, `W` + number for a Wall position,
zero-padded to ≥ 2 digits (e.g. `B03`, `W12`); numbers are ≥ 1. An Item has exactly
one Place. `place` itself is a stored field; the **Surface** is *derived* from its
prefix on read, never stored separately.
_Avoid_: using "Place" for the whole Location (Place is only the in-Shelf spot;
Location = Shelf + Place); spot, bin, slot. ("Position" is the accepted word for the
number within a Surface — e.g. "Wall position 3".)

**Quantity** (`qty`):
The number of units of an Item currently on hand. Changed only via Take and Add.
For **bulk continuous** Items (e.g. wire/cable sold by length), `qty` counts the
natural unit of measure — **metres**, not pieces — and Take/Add operate in metres
(`take --n 3` = "took 3 m"). Likewise Minimum Safe Stock for such Items is in metres.
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
