# All inventory access goes through inventory.sh

Every read and write of an Item note goes through `inventory.sh`. The agent never
greps the vault directly nor hand-edits frontmatter, even though the notes are plain
markdown a reader would assume is safe to edit by hand.

This is deliberate. Routing writes through the script makes frontmatter mutation
deterministic — no accidental field typos or reformatting — and lets the script
enforce invariants in one place: `qty` floors at 0 on Take, and `status` is always
*derived* from `qty` (never set by hand) so it cannot desync. Routing reads through
the script means the LLM parses a stable contract (TSV/JSON, see ADR-0001) instead
of scraping ad-hoc grep output. The trade-off is an indirection layer to maintain
(guarded by `test-inventory.sh`); the payoff is that the documented schema and the
actual on-disk state cannot drift apart.
