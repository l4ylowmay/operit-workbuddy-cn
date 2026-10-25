# SPDX-License-Identifier: MIT
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text())['version']
out = root / 'dist'
out.mkdir(exist_ok=True)

# Explicit release inputs: never recursively bundle an entire device/workspace.
root_files = ('LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md',
              'manifest.json', 'package.json', '.gitignore')
directories = ('src', 'licenses', 'docs', 'tests', 'scripts')
files = [root / name for name in root_files]
for directory in directories:
    files.extend(p for p in (root / directory).rglob('*')
                 if p.is_file() and '__pycache__' not in p.parts
                 and p.suffix in ('.js', '.py', '.md', '.txt', '.json'))

assets = []
for filename, source in [(f'workbuddy-cn-{version}.toolpkg', False),
                         (f'workbuddy-cn-{version}-source.zip', True)]:
    target = out / filename
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            relative = path.relative_to(root)
            if not source and relative.parts[0] in ('tests', 'scripts'):
                continue
            info = zipfile.ZipInfo(str(relative), (2026, 10, 25, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert {'LICENSE', 'THIRD_PARTY_NOTICES.md', 'licenses/DSH-MIT.txt'} <= set(archive.namelist())
    assets.append(target)

(out / 'SHA256SUMS.txt').write_text(''.join(
    hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
    for path in sorted(assets)))
