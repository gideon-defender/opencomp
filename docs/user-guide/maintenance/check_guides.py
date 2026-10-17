"""Offline integrity checks for the repository user guide (standard library only)."""

import json
import re
import struct
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
LINK = re.compile(r'(!?)\[([^\]]*)\]\((<[^>]+>|(?:\\.|[^\\()\n]|\([^()\n]*\))+)\)')
errors = []
used_images = set()


def fail(path, message):
    errors.append(f'{path.relative_to(REPO)}: {message}')


def anchors(path):
    found = set()
    counts = {}
    for title in re.findall(r'^#{1,6}\s+(.+?)\s*#*$', path.read_text(), re.M):
        slug = re.sub(r'[^\w\- ]', '', title.lower()).replace(' ', '-')
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        found.add(f'{slug}-{count}' if count else slug)
    return found


files = sorted(ROOT.rglob('*.md'))
for path in files:
    text = path.read_text()
    if re.search(r'^> Screenshot:|\bTODO\b|\bTBD\b', text, re.M):
        fail(path, 'unfinished editorial marker')
    text = re.sub(r'^```.*?^```\s*$', '', text, flags=re.M | re.S)
    for image_marker, label, raw in LINK.findall(text):
        target = re.sub(r'\\([()])', r'\1', raw.strip('<>'))
        url = urlsplit(target)
        if url.scheme or url.netloc:
            continue
        dest = (path.parent / unquote(url.path)).resolve() if url.path else path
        if not dest.is_relative_to(REPO):
            fail(path, f'link escapes repository: {target}')
            continue
        if not dest.exists():
            fail(path, f'missing link target: {target}')
            continue
        if url.fragment and dest.suffix in {'.md', '.mdx'}:
            if unquote(url.fragment) not in anchors(dest):
                fail(path, f'missing heading: {target}')
        if image_marker:
            if not label.strip():
                fail(path, f'image has no alt text: {target}')
            used_images.add(dest)

manifest_path = ROOT / 'images/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest_images = set()
for item in manifest:
    path = ROOT / 'images' / item['image']
    if path in manifest_images:
        fail(path, 'duplicate manifest entry')
    manifest_images.add(path)
    if not path.exists():
        fail(path, 'manifest references missing image')
        continue
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n' or data[12:16] != b'IHDR':
        fail(path, 'invalid PNG header')
        continue
    dimensions = struct.unpack('>II', data[16:24])
    if list(dimensions) != item['size']:
        fail(path, 'dimensions differ from manifest')
    if min(dimensions) < 400:
        fail(path, 'image too small for readable product documentation')
    if path.stat().st_size > 2_000_000:
        fail(path, 'image exceeds 2 MB budget')
    if not item.get('captured') or not item.get('environment'):
        fail(path, 'missing provenance')

actual_images = set((ROOT / 'images').glob('*.png'))
for path in actual_images - manifest_images:
    fail(path, 'image missing manifest entry')
for path in actual_images - used_images:
    fail(path, 'unreferenced image')
for path in used_images - manifest_images:
    fail(path, 'referenced image has no provenance')

if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print(f'PASS: {len(files)} Markdown files; {len(actual_images)} images; '
      'local links, headings, alt text, provenance, and PNG dimensions verified.')
