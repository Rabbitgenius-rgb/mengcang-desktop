from pathlib import Path
import datetime
import hashlib
import json
import shutil

candidate = Path(__file__).resolve().parents[1]
plan = json.loads((candidate / 'verification/visual-sync-plan.json').read_text())
source = Path(plan['source'])
backup = candidate / 'verification/visual-source-backup'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

assert source == Path('/Users/rabbit/Documents/ChatGPT/名器/work/梦藏')
assert not backup.exists(), 'Visual backup already exists; refuse to overwrite it.'
for entry in plan['files']:
    assert digest(source / entry['path']) == entry['sourceBefore'], f"Source changed: {entry['path']}"
    assert digest(candidate / entry['path']) == entry['candidateAfter'], f"Candidate changed: {entry['path']}"

backup.mkdir()
for entry in plan['files']:
    if entry['sourceBefore'] is not None:
        target = backup / 'files' / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / entry['path'], target)
(backup / 'plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')

applied = []
try:
    for entry in plan['files']:
        target = source / entry['path']
        target.parent.mkdir(parents=True, exist_ok=True)
        stage = target.with_name(target.name + '.sublime-visual-stage')
        assert not stage.exists(), f"Stage already exists: {entry['path']}"
        shutil.copy2(candidate / entry['path'], stage)
        if target.exists():
            stage.chmod(target.stat().st_mode)
        stage.replace(target)
        applied.append(entry)
    for entry in plan['files']:
        assert digest(source / entry['path']) == entry['candidateAfter']
except Exception:
    for entry in reversed(applied):
        target = source / entry['path']
        if digest(target) != entry['candidateAfter']:
            raise RuntimeError(f"Rollback stopped: concurrent source change in {entry['path']}")
        if entry['sourceBefore'] is None:
            target.unlink()
        else:
            shutil.copy2(backup / 'files' / entry['path'], target)
    raise

result = dict(plan, sourceWritten=True, appliedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(candidate / 'verification/visual-source-applied.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'filesApplied': len(applied), 'backup': str(backup), 'installedAppChanged': False, 'realVaultWritten': False}, ensure_ascii=False))
