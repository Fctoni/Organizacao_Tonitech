"""Public export contract; fixtures never touch real inventory."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).with_name('inventory.sh')
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    raw = b'---\r\nshelf: 1\r\nplace: B03\r\nqty: 2\r\ncategory: Tools\r\naliases: ["broca"]\r\ncustom: preserved\r\n---\r\nBody ![[photo.png]]\r\n'
    (root / 'Drill.md').write_bytes(raw)
    (root / 'AGENTS.md').write_text('# Instructions')
    (root / 'Inventory Dashboard.md').write_text('# Dashboard')
    (root / 'original.csv').write_text('name,qty\nDrill,2\n')
    def export():
        return subprocess.check_output([str(script), 'export'], env={**os.environ, 'VAULT_DIR': directory})
    first = export()
    assert first == export(), 'Export must be deterministic'
    data = json.loads(first)
    assert len(data['items']) == 1
    item = data['items'][0]
    assert base64.b64decode(item['original_base64']) == raw
    assert item['sha256'] == hashlib.sha256(raw).hexdigest()
    assert item['projection']['aliases'] == ['broca']
    assert item['frontmatter']['custom'] == 'preserved'
    assert item['body'] == 'Body ![[photo.png]]\r\n'
    assert item['references'] == ['photo.png']
    assert {x['filename'] for x in data['sources']} == {'original.csv', 'Inventory Dashboard.md'}
    assert (root / 'Drill.md').read_bytes() == raw
print('export: deterministic, lossless, complete, read-only — PASS')
