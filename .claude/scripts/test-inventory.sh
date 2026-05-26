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

# seed sample notes
cat > "$TMP/ESP32 DevKit V1.md" <<'EOF'
---
shelf: 1
box: 3
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
box: 1
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
[ "$(run find esp32 | col box)" = "3" ] && ok "find returns box" || bad "find box"

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

echo "== new + dup reject =="
out=$(run new --note "USB Cable 1m" --shelf 3 --box 2 --qty 8 --min 3 --category Cables --aliases "usb, cabo")
[ "$(echo "$out" | field qty)" = "8" ] && ok "new creates item" || bad "new create"
[ -f "$TMP/USB Cable 1m.md" ] && ok "new writes file" || bad "new file"
if run new --note "USB Cable 1m" --shelf 1 --box 1 --qty 1 2>/dev/null; then
  bad "dup not rejected"
else
  ok "dup rejected"
fi

echo "== fuzzy write refused =="
if run take --note "esp32" --n 1 2>/dev/null; then
  bad "non-exact name accepted"
else
  ok "non-exact name rejected"
fi

echo "== set-category =="
out=$(run set-category --note "M3 Screws 10mm" --category Tools)
[ "$(echo "$out" | field category)" = "Tools" ] && ok "set-category changes category" || bad "set-category value"
[ "$(run find screws | col category)" = "Tools" ] && ok "set-category persists" || bad "set-category persist"
grep -q '^# M3 Screws 10mm$' "$TMP/M3 Screws 10mm.md" && ok "set-category preserves body" || bad "set-category body lost"
grep -q '^qty: 50$' "$TMP/M3 Screws 10mm.md" && ok "set-category preserves other fields" || bad "set-category clobbered qty"
if run set-category --note "M3 Screws 10mm" --category Bogus 2>/dev/null; then
  bad "non-canonical category accepted"
else
  ok "non-canonical category rejected"
fi

echo "---"
echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
