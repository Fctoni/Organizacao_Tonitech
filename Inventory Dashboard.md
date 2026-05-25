# 📦 Inventory Dashboard

> Live views of the garage inventory. Needs the **Dataview** plugin (already installed).
> View this note in **Reading** or **Live Preview** mode — Source mode shows raw query code.

## All items — by location

```dataview
TABLE WITHOUT ID file.link AS Item, shelf AS Shelf, box AS Box, qty AS Qty, minimum_safe_stock AS Min, status AS Status
FROM ""
WHERE shelf
SORT shelf ASC, box ASC
```

## Grouped by category

```dataview
TABLE rows.file.link AS Items, rows.shelf AS Shelf, rows.box AS Box, rows.qty AS Qty
FROM ""
WHERE shelf
GROUP BY category AS Category
SORT Category ASC
```

## Low stock (qty below safe minimum)

```dataview
TABLE WITHOUT ID file.link AS Item, shelf AS Shelf, box AS Box, qty AS Qty, minimum_safe_stock AS Min
FROM ""
WHERE minimum_safe_stock AND qty < minimum_safe_stock
SORT qty ASC
```

## Out of stock

```dataview
TABLE WITHOUT ID file.link AS Item, shelf AS Shelf, box AS Box
FROM ""
WHERE status = "out"
```

---

## How to filter & sort

Dataview tables aren't clickable — you **edit the query**. Two lines do everything:

- **`WHERE`** = filter (which rows show)
- **`SORT`** = order (asc/desc)

Copy this block, change the `WHERE` line, and you have a custom view:

```dataview
TABLE WITHOUT ID file.link AS Item, shelf AS Shelf, box AS Box, qty AS Qty
FROM ""
WHERE category = "Electronics"
SORT shelf ASC, box ASC
```

Useful `WHERE` filters (swap the line above):

| Goal | `WHERE` line |
|---|---|
| One category | `WHERE category = "Tools"` |
| Everything on shelf 1 | `WHERE shelf = 1` |
| A specific box | `WHERE shelf = 1 AND box = 3` |
| Fewer than 5 on hand | `WHERE qty < 5` |
| Out of stock | `WHERE status = "out"` |
| Name/alias contains text | `WHERE contains(file.name, "ESP") OR contains(aliases, "ESP")` |

Sorting examples: `SORT qty ASC` (lowest first), `SORT category ASC, qty DESC`.

---

## Ask Claude things like

- "Where are the ESP32 modules?" → shelf, box, qty.
- "I took 2 ESP32" → qty drops by 2 (hits 0 → marked *out*).
- "I added 3 ESP32" → qty rises by 3.
- "What's running low?" → items below their minimum safe stock.
- "Add a new item: …" → Claude asks for the details, then creates it.

Run Claude from inside this vault folder so `.claude/CLAUDE.md` loads automatically.
