# Reads emit TSV, writes emit JSON

`inventory.sh` read subcommands (`find`, `list`, `low-stock`) print TSV — a single
header row then one row per Item — while write subcommands (`take`, `add`, `new`)
print a single JSON object.

The split is deliberate, not an inconsistency to "unify". A list repeats the field
names on every row in JSON, which wastes tokens for the LLM that consumes the output;
TSV states the keys once and scales better as the inventory grows, and the flat
fixed schema has no nesting or delimiter hazards that would need JSON. A write returns
exactly one record where repetition costs nothing, and JSON keeps the optional
`warning` field (e.g. over-take) cleanly structured. So: many rows → TSV, single
result → JSON.
