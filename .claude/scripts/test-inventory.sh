#!/usr/bin/env bash
# test-inventory.sh — lightweight checks for inventory.sh against a throwaway vault.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INV="$SCRIPT_DIR/inventory.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export VAULT_DIR="$TMP"

pass=0; fail=0
ok()   { printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }

# Writes emit a JSON object: field <key> reads one value from stdin.
field() { python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(sys.argv[1],""))' "$1"; }
# Reads emit TSV (header + rows). rows = data rows (excludes header).
rows()  { python3 -c 'import sys; lines=[l for l in sys.stdin.read().splitlines() if l]; print(max(0,len(lines)-1))'; }
# col <header> — value in the first data row for the named column.
col()   { python3 -c 'import sys; L=[l for l in sys.stdin.read().splitlines() if l]; h=L[0].split("\t"); print(L[1].split("\t")[h.index(sys.argv[1])] if len(L)>1 else "")' "$1"; }

run() { bash "$INV" "$@"; }

# seed sample notes (already on the place schema)
cat > "$TMP/ESP32 DevKit V1.md" <<'EOF'
---
shelf: 1
place: B03
qty: 5
minimum_safe_stock: 10
category: Electronics
aliases: [ESP32, microcontroller, dev board]
status: in_stock
---

# ESP32 DevKit V1
EOF
cat > "$TMP/M3 Screws 10mm.md" <<'EOF'
---
shelf: 2
place: B01
qty: 50
minimum_safe_stock: 20
category: Hardware
aliases: [screws, parafuso]
status: in_stock
---

# M3 Screws 10mm
EOF
cat > "$TMP/Inventory Dashboard.md" <<'EOF'
# 📦 Inventory Dashboard
EOF

echo "== find =="
n=$(run find esp32 | rows)
[ "$n" = "1" ] && ok "find by alias hits 1" || bad "find by alias ($n)"
[ "$(run find nonsense | rows)" = "0" ] && ok "find miss -> header only" || bad "find miss"
[ "$(run find esp32 | col place)" = "B03" ] && ok "find returns place" || bad "find place"

echo "== list (excludes dashboard) =="
[ "$(run list | rows)" = "2" ] && ok "list = 2 items" || bad "list count"

echo "== low-stock =="
ls_out=$(run low-stock)
[ "$(echo "$ls_out" | rows)" = "1" ] && ok "low-stock = 1 (ESP32 5<10)" || bad "low-stock count"
[ "$(echo "$ls_out" | col note)" = "ESP32 DevKit V1" ] && ok "low-stock names ESP32" || bad "low-stock note"

echo "== take =="
out=$(run take --note "ESP32 DevKit V1" --n 2)
[ "$(echo "$out" | field qty)" = "3" ] && ok "take 2: 5->3" || bad "take qty"
[ "$(echo "$out" | field status)" = "in_stock" ] && ok "take keeps in_stock" || bad "take status"

echo "== take to zero -> out =="
out=$(run take --note "ESP32 DevKit V1" --n 99)
[ "$(echo "$out" | field qty)" = "0" ] && ok "take floors at 0" || bad "take floor"
[ "$(echo "$out" | field status)" = "out" ] && ok "qty 0 -> status out" || bad "zero status"
echo "$out" | grep -q '"warning"' && ok "over-take warns" || bad "over-take warning"

echo "== add brings back in_stock =="
out=$(run add --note "ESP32 DevKit V1" --n 4)
[ "$(echo "$out" | field qty)" = "4" ] && ok "add 4: 0->4" || bad "add qty"
[ "$(echo "$out" | field status)" = "in_stock" ] && ok "out -> in_stock on add" || bad "add status"

echo "== new (box) + dup reject =="
out=$(run new --note "USB Cable 1m" --shelf 3 --box 2 --qty 8 --min 3 --category Cables --aliases "usb, cabo")
[ "$(echo "$out" | field qty)" = "8" ] && ok "new creates item" || bad "new create"
[ "$(echo "$out" | field place)" = "B02" ] && ok "new --box 2 -> place B02" || bad "new box place"
[ -f "$TMP/USB Cable 1m.md" ] && ok "new writes file" || bad "new file"
grep -q '^place: B02$' "$TMP/USB Cable 1m.md" && ok "new persists place" || bad "new place persist"
if run new --note "USB Cable 1m" --shelf 1 --box 1 --qty 1 2>/dev/null; then
  bad "dup not rejected"
else
  ok "dup rejected"
fi
if run new --note "Bad Cat Item" --shelf 1 --box 1 --qty 1 --category Bogus 2>/dev/null; then
  bad "new accepted non-canonical category"
else
  ok "new rejects non-canonical category"
fi
[ ! -f "$TMP/Bad Cat Item.md" ] && ok "new aborts before writing on bad category" || bad "new wrote file despite bad category"
err=$(run new --note "Bad Cat Item 2" --shelf 1 --box 1 --qty 1 --category Bogus 2>&1 >/dev/null)
if echo "$err" | grep -q "CONTEXT.md" && echo "$err" | grep -q "ASK THE USER"; then
  ok "rejection message directs the agent (read CONTEXT.md / ask user)"
else
  bad "rejection message is not directive"
fi

echo "== new (wall) + place validation =="
out=$(run new --note "Cordless Drill" --shelf 1 --wall 3 --qty 1 --category Tools)
[ "$(echo "$out" | field place)" = "W03" ] && ok "new --wall 3 -> place W03" || bad "new wall place"
grep -q '^place: W03$' "$TMP/Cordless Drill.md" && ok "wall item persists place" || bad "wall place persist"
if run new --note "Both Surfaces" --shelf 1 --box 1 --wall 1 --qty 1 2>/dev/null; then
  bad "new accepted both --box and --wall"
else
  ok "new rejects both --box and --wall"
fi
if run new --note "No Surface" --shelf 1 --qty 1 2>/dev/null; then
  bad "new accepted neither --box nor --wall"
else
  ok "new rejects neither --box nor --wall"
fi
if run new --note "Zero Box" --shelf 1 --box 0 --qty 1 2>/dev/null; then
  bad "new accepted --box 0"
else
  ok "new rejects --box 0 (positions are >= 1)"
fi
if run new --note "Zero Shelf" --shelf 0 --box 1 --qty 1 2>/dev/null; then
  bad "new accepted --shelf 0"
else
  ok "new rejects --shelf 0 (shelves are >= 1)"
fi
[ ! -f "$TMP/Both Surfaces.md" ] && [ ! -f "$TMP/No Surface.md" ] && ok "rejected new items leave no file" || bad "rejected new wrote a file"

echo "== relocate =="
out=$(run relocate --note "M3 Screws 10mm" --wall 5)
[ "$(echo "$out" | field place)" = "W05" ] && ok "relocate to wall: place W05" || bad "relocate wall place"
grep -q '^place: W05$' "$TMP/M3 Screws 10mm.md" && ok "relocate persists place" || bad "relocate persist"
grep -q '^qty: 50$' "$TMP/M3 Screws 10mm.md" && ok "relocate preserves qty" || bad "relocate clobbered qty"
grep -q '^# M3 Screws 10mm$' "$TMP/M3 Screws 10mm.md" && ok "relocate preserves body" || bad "relocate body lost"
out=$(run relocate --note "M3 Screws 10mm" --box 7 --shelf 4)
[ "$(echo "$out" | field place)" = "B07" ] && ok "relocate to box: place B07" || bad "relocate box place"
[ "$(echo "$out" | field shelf)" = "4" ] && ok "relocate --shelf moves shelf" || bad "relocate shelf"
if run relocate --note "M3 Screws 10mm" --box 1 --wall 1 2>/dev/null; then
  bad "relocate accepted both --box and --wall"
else
  ok "relocate rejects both --box and --wall"
fi
if run relocate --note "Ghost Item" --box 1 2>/dev/null; then
  bad "relocate accepted missing note"
else
  ok "relocate rejects non-existent note"
fi

echo "== fuzzy write refused =="
if run take --note "esp32" --n 1 2>/dev/null; then
  bad "non-exact name accepted"
else
  ok "non-exact name rejected"
fi

echo "== set-category =="
out=$(run set-category --note "ESP32 DevKit V1" --category Tools)
[ "$(echo "$out" | field category)" = "Tools" ] && ok "set-category changes category" || bad "set-category value"
[ "$(run find esp32 | col category)" = "Tools" ] && ok "set-category persists" || bad "set-category persist"
grep -q '^# ESP32 DevKit V1$' "$TMP/ESP32 DevKit V1.md" && ok "set-category preserves body" || bad "set-category body lost"
grep -q '^place: B03$' "$TMP/ESP32 DevKit V1.md" && ok "set-category preserves place" || bad "set-category clobbered place"
if run set-category --note "ESP32 DevKit V1" --category Bogus 2>/dev/null; then
  bad "non-canonical category accepted"
else
  ok "non-canonical category rejected"
fi

echo "== migrate (legacy box -> place) =="
cat > "$TMP/Legacy Sensor.md" <<'EOF'
---
shelf: 2
box: 12
qty: 3
minimum_safe_stock: 0
category: Electronics
aliases: []
status: in_stock
---

# Legacy Sensor
EOF
mig=$(run migrate)
grep -q '^place: B12$' "$TMP/Legacy Sensor.md" && ok "migrate box:12 -> place B12 (zero-pad, not B012)" || bad "migrate place"
grep -q '^box:' "$TMP/Legacy Sensor.md" && bad "migrate left a box field" || ok "migrate removes box field"
grep -q '^# Legacy Sensor$' "$TMP/Legacy Sensor.md" && ok "migrate preserves body" || bad "migrate body lost"
echo "$mig" | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if any(m["note"]=="Legacy Sensor" and m["place"]=="B12" for m in d["migrated"]) else 1)' \
  && ok "migrate reports the migrated note" || bad "migrate report"
# idempotency: a second run migrates nothing
mig2=$(run migrate)
echo "$mig2" | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if not d["migrated"] else 1)' \
  && ok "migrate is idempotent (second run migrates nothing)" || bad "migrate not idempotent"
# place-schema notes are skipped, never rewritten
grep -q '^place: B03$' "$TMP/ESP32 DevKit V1.md" >/dev/null 2>&1
echo "$mig" | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if any(s["note"]=="ESP32 DevKit V1" for s in d["skipped"]) else 1)' \
  && ok "migrate skips notes that already have place" || bad "migrate touched a place note"

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
