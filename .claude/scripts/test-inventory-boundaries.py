#!/usr/bin/env python3
"""Public CLI regression checks. All raw note access is to disposable fixtures."""
import csv
import ast
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".claude/scripts/inventory.sh"
checks = 0


with tempfile.TemporaryDirectory(prefix="inventory-boundaries-") as tmp:
    base = Path(tmp)
    vault = base / "vault with spaces [test]"
    vault.mkdir()
    env = {**os.environ, "VAULT_DIR": str(vault)}

    def run(*args, error=False, **kwargs):
        global checks
        result = subprocess.run(["bash", str(SCRIPT), *args], env=env,
                                text=True, capture_output=True, **kwargs)
        if error:
            assert result.returncode != 0, (args, result.stdout)
            assert json.loads(result.stderr)["error"], result.stderr
            assert not result.stdout, result.stdout
        else:
            assert result.returncode == 0, (args, result.stderr)
        checks += 1
        return result

    def rows(*args):
        return list(csv.DictReader(io.StringIO(run(*args).stdout), delimiter="\t"))

    def snapshot():
        return {p.name: p.read_bytes() for p in vault.glob("*.md")}

    def rejected(*args):
        before = snapshot()
        run(*args, error=True)
        assert snapshot() == before, args

    def fixture(name, qty="2", place="B03", extra="", body="body without final newline"):
        path = vault / (name + ".md")
        path.write_bytes((f"---\r\nshelf: 1\r\nplace: {place}\r\nqty: {qty}\r\n"
                          f"minimum_safe_stock: 3\r\ncategory: Tools\r\n"
                          f"aliases: []\r\nstatus: out\r\n{extra}---\r\n{body}").encode())
        return path

    for option in ([], ["--help"], ["-h"], ["help"]):
        assert "READS" in run(*option).stdout
    assert rows("list") == []
    new = ("new", "--note", "Ação", "--shelf", "1", "--wall", "100", "--qty", "0")
    created = json.loads(run(*new, "--aliases", 'café, Bob\'s tool, a: b, [abc], "quoted"').stdout)
    assert created["place"] == "W100" and created["category"] == "Uncategorized"
    assert created["minimum_safe_stock"] == 0 and created["status"] == "out"
    for query in ("ACAO", "CAFE", "Bob's", "a: b", "[abc]", '"quoted"'):
        assert rows("find", query)[0]["note"] == "Ação"
    assert rows("low-stock") == []
    fixture("At threshold", qty="3")
    assert not any(r["note"] == "At threshold" for r in rows("low-stock"))
    fixture("Ação extra")
    assert len(rows("find", "acao")) == 2
    assert rows("find", "absent") == []
    rejected(*new)
    for name in ("../escaped", str(base / "absolute"), "", ".hidden", "name.md",
                 "Inventory Dashboard", "bad\nname", "bad\tname", "sub/name", "sub\\name"):
        rejected("new", "--note", name, "--shelf", "1", "--box", "1", "--qty", "1")
        rejected("add", "--note", name, "--n", "1")
    assert not (base / "escaped.md").exists()
    for args in (("--help", "extra"), ("list", "extra"), ("low-stock", "extra"), ("migrate", "extra"),
                 ("find",), ("unknown",), ("take", "--note", "Ação", "--n", "-1"),
                 ("add", "--note", "Ação", "--n", "1.5"),
                 ("add", "--note", "Ação", "--n", "1", "--typo", "2"),
                 ("add", "--note", "Ação", "--n", "1", "--n", "2"),
                 ("add", "--note"), ("set-category", "--note", "Ação"),
                 ("new", "--note", "Missing")):
        rejected(*args)
    for flag, value in (("--shelf", "x"), ("--wall", "-1"), ("--qty", "-1")):
        args = list(new)
        args[2] = "Invalid"
        args[args.index(flag) + 1] = value
        rejected(*args)
    rejected(*new[:2], "Invalid", *new[3:], "--min", "-1")
    rejected(*new[:2], "Invalid", *new[3:], "--aliases", "a\nb")
    source = SCRIPT.read_text()
    categories = ast.literal_eval(re.search(r"CANONICAL_CATEGORIES = (\(.*?\))", source, re.S)[1])
    glossary = (ROOT / ".claude/CONTEXT.md").read_text()
    assert set(categories) == set(re.findall(r"^- \*\*(\w+)\*\* —", glossary, re.M))
    for category in categories:
        run("new", "--note", "Category " + category, "--shelf", "1", "--box", "1",
            "--qty", "1", "--category", category)
        assert json.loads(run("set-category", "--note", "Ação", "--category", category).stdout)["category"] == category

    path = fixture("Preserved", extra="custom: keep\r\n")
    assert rows("find", "Preserved")[0]["status"] == "in_stock"
    for args in (("set-category", "--category", "Hardware"),
                 ("relocate", "--shelf", "2", "--box", "3"), ("add", "--n", "0")):
        run(args[0], "--note", "Preserved", *args[1:])
        content = path.read_bytes()
        assert content.endswith(b"---\r\nbody without final newline")
        assert b"custom: keep\r\n" in content and b"status: in_stock\r\n" in content
    assert json.loads(run("take", "--note", "Preserved", "--n", "2").stdout)["status"] == "out"
    for qty in ("oops", "-1", "1.5"):
        fixture("Invalid qty", qty=qty)
        for args in (("add", "--n", "1"), ("take", "--n", "1"),
                     ("set-category", "--category", "Tools"),
                     ("relocate", "--shelf", "1", "--box", "1")):
            rejected(args[0], "--note", "Invalid qty", *args[1:])
    missing_qty = fixture("Missing qty")
    missing_qty.write_bytes(missing_qty.read_bytes().replace(b"qty: 2\r\n", b""))
    rejected("add", "--note", "Missing qty", "--n", "1")
    for place in ("B00", "W00", "X01", "B3", ""):
        fixture("Invalid place", place=place)
        for command in (("list",), ("find", "Invalid place"), ("low-stock",)):
            assert "malformed place" in run(*command).stderr
        assert "place_warning" in json.loads(run("add", "--note", "Invalid place", "--n", "0").stdout)
    run("relocate", "--note", "Invalid place", "--shelf", "1", "--wall", "2")
    assert not run("find", "Invalid place").stderr

    # Migration branches, including CRLF/body preservation and byte-level idempotence.
    legacy = fixture("Legacy")
    legacy.write_bytes(legacy.read_bytes().replace(b"place: B03", b"box: 12"))
    fixture("Orphan", extra="box: 9\r\nbox: 8\r\n")
    (vault / "No frontmatter.md").write_text("body")
    for box in ("oops", "0"):
        p = fixture("Legacy " + box)
        p.write_bytes(p.read_bytes().replace(b"place: B03", f"box: {box}".encode()))
    p = fixture("No box")
    p.write_bytes(p.read_bytes().replace(b"place: B03\r\n", b""))
    p = fixture("Legacy bad qty", qty="oops")
    p.write_bytes(p.read_bytes().replace(b"place: B03", b"box: 1"))
    migration = json.loads(run("migrate").stdout)
    assert migration["migrated"] == [{"note": "Legacy", "place": "B12"}]
    assert migration["cleaned"][0]["note"] == "Orphan"
    assert {x["reason"] for x in migration["skipped"]} >= {
        "no frontmatter", "no box field", "box < 1: 0", "box not an integer: 'oops'",
        "already has place", "qty must be an integer >= 0"}
    assert legacy.read_bytes().endswith(b"---\r\nbody without final newline")
    before = snapshot()
    migration = json.loads(run("migrate").stdout)
    assert not migration["migrated"] and not migration["cleaned"] and snapshot() == before

    outside = base / "outside.md"
    outside.write_text("sentinel")
    (vault / "Link.md").symlink_to(outside)
    for args in (("list",), ("add", "--note", "Link", "--n", "1"), ("migrate",)):
        run(*args, error=True)
    assert outside.read_text() == "sentinel"
    (vault / "Link.md").unlink()
    invalid_text = vault / "Invalid encoding.md"
    invalid_text.write_bytes(b"\xff")
    run("list", error=True)
    invalid_text.unlink()
    env["VAULT_DIR"] = str(base / "missing")
    run("list", error=True)

    # Execute the documented bootstrap verbatim from a subdirectory of a relocated repo.
    copied = vault / ".claude/scripts/inventory.sh"
    copied.parent.mkdir(parents=True)
    shutil.copy2(SCRIPT, copied)
    subprocess.run(["git", "init", "--quiet", str(vault)], check=True)
    skill = (ROOT / ".claude/skills/garage-inventory/SKILL.md").read_text()
    bootstrap = re.search(r"```bash\n(.*?)\n```", skill, re.S)[1]
    result = subprocess.run(["bash", "-c", bootstrap], cwd=copied.parent,
                            env=env, text=True, capture_output=True)
    assert result.returncode == 0 and "READS" in result.stdout, result.stderr
    checks += 1
    # Default vault derives from the executable location even outside the repository.
    clean_env = {k: v for k, v in env.items() if k != "VAULT_DIR"}
    result = subprocess.run(["bash", str(copied), "find", "acao"], cwd=base,
                            env=clean_env, text=True, capture_output=True)
    assert result.returncode == 0 and "Ação" in result.stdout, result.stderr
    checks += 1

print(f"{checks} CLI checks passed; isolated fixtures removed")
