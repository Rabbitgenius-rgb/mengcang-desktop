"""Apply only reviewed discovery files; preserve every prior source byte in a local backup."""
from pathlib import Path
import hashlib, json, os, shutil, stat, sys, uuid
from datetime import datetime, timezone

candidate = Path(__file__).resolve().parents[1]
source = Path('/Users/rabbit/Documents/ChatGPT/名器/work/梦藏')
paths = [
 'desktop/preload.cjs', 'desktop/gateway.cjs', 'desktop/main.cjs',
 'desktop/DiscoveryHelper.swift', 'desktop/discovery.cjs', 'desktop/.gitignore',
 'src/desktop-connector/index.js', 'src/desktop-connector/capture.js',
 'scripts/build-desktop.mjs', 'scripts/build-discovery-helper.mjs',
 'prototypes/desktop-workbench/vite.config.mjs',
 'prototypes/desktop-workbench/package.json', 'prototypes/desktop-workbench/package-lock.json',
 'prototypes/desktop-workbench/discovery-vite.mjs',
 'prototypes/desktop-workbench/src/App.jsx', 'prototypes/desktop-workbench/src/DesktopApp.jsx',
 'prototypes/desktop-workbench/src/DiscoveryView.jsx', 'prototypes/desktop-workbench/src/discovery.css',
 'prototypes/desktop-workbench/src/discoveryModel.js', 'prototypes/desktop-workbench/src/discoveryPreview.js',
 'prototypes/desktop-workbench/tests/discovery-model.test.mjs',
 'tests/desktop-capture.test.js', 'tests/discovery-native.test.js', 'tests/discovery-ipc.test.js',
 'tests/fixtures/discovery-excerpt.pdf', 'tests/desktop-window-lifecycle.test.js',
 'tests/desktop-schedule.test.js', 'docs/sublime-discovery-20261002.md'
]
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None

def guard_path(path):
    if source.is_symlink(): raise RuntimeError('Source repository cannot be a symlink')
    current = source
    for part in Path(path).parts:
        current /= part
        if current.is_symlink(): raise RuntimeError(f'Symlink rejected: {path}')

manifest_path = candidate / 'integration-manifest.json'
if '--prepare' in sys.argv:
    baseline = json.loads((candidate/'source-baseline.json').read_text())['files']
    manifest = []
    for relative in paths:
        guard_path(relative)
        before = digest(source/relative)
        if relative in baseline and before != baseline[relative]:
            raise RuntimeError(f'Source changed since initial copy: {relative}')
        if before is not None and relative not in baseline and relative not in {'tests/desktop-window-lifecycle.test.js','tests/desktop-schedule.test.js'}:
            raise RuntimeError(f'New destination already occupied: {relative}')
        after = digest(candidate/relative)
        if after is None: raise RuntimeError(f'Candidate file missing: {relative}')
        manifest.append({'path':relative,'before':before,'after':after})
    manifest_path.write_text(json.dumps({'source':str(source),'candidate':str(candidate),'files':manifest},ensure_ascii=False,indent=2))
    print(f'Prepared {len(manifest)} bounded source files; no source writes.')
    sys.exit()

manifest = json.loads(manifest_path.read_text())
if manifest['source'] != str(source) or manifest['candidate'] != str(candidate): raise RuntimeError('Manifest identity mismatch')
for item in manifest['files']:
    guard_path(item['path'])
    if digest(source/item['path']) != item['before'] or digest(candidate/item['path']) != item['after']:
        raise RuntimeError(f'Guard failed before any source write: {item["path"]}')
backup = candidate/'integration-backup'
if backup.exists(): raise RuntimeError('Backup already exists; do not repeat integration silently')
backup.mkdir()
for item in manifest['files']:
    if item['before'] is not None:
        target=backup/item['path']; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source/item['path'],target)
(backup/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
completed=[]
try:
    for item in manifest['files']:
        relative=item['path']; target=source/relative
        guard_path(relative)
        if digest(target)!=item['before']: raise RuntimeError(f'Concurrent source edit: {relative}')
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.parent/f'.discovery-integration-{uuid.uuid4()}.tmp'
        try:
            temporary.write_bytes((candidate/relative).read_bytes())
            os.chmod(temporary,stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o644)
            os.replace(temporary,target)
        finally:
            temporary.unlink(missing_ok=True)
        completed.append(item)
    for item in completed:
        if digest(source/item['path'])!=item['after']: raise RuntimeError(f'Postcheck failed: {item["path"]}')
except Exception:
    for item in reversed(completed):
        target=source/item['path']
        if digest(target)!=item['after']: continue
        if item['before'] is None: target.unlink()
        else: shutil.copy2(backup/item['path'],target)
    raise
result={'appliedAt':datetime.now(timezone.utc).isoformat(),'source':str(source),'backup':str(backup),'fileCount':len(completed),'installedAppChanged':False,'realVaultWritten':False,'files':completed}
(candidate/'source-applied.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print(f'Applied and hash-verified {len(completed)} source files. Installed app and real Vault were untouched.')
