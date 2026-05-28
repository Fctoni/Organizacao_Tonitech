#!/usr/bin/env bash
# inventory.sh — canonical interface to the garage inventory.
# Encapsulates every read/write so the agent never composes grep/edits by hand.
#
# Reads (find/list/low-stock) print TSV: a header row, then one row per item.
# Writes (take/add/new/...) print the resulting item as a JSON object to stdout.
# Errors print {"error": "..."} to stderr and exit non-zero.
#
# This is a thin shim: it resolves VAULT_DIR (default = two levels up) and execs the
# Python engine in inventory.py, which holds the actual logic and the CLI contract.
#
# Dependencies: bash, python3 (stdlib only).
# Usage: inventory.sh <subcommand> [args]   —   see `inventory.sh --help`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export VAULT_DIR="${VAULT_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"

exec python3 "$SCRIPT_DIR/inventory.py" "$@"
