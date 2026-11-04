#!/usr/bin/env python3
"""Apply only the verified authenticated-UI files; preserve unrelated working files."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, shutil
candidate=Path(__file__).resolve().parents[1]
evidence=candidate/'verification/auth-replica'
plan=json.loads((evidence/'source-sync-plan.json').read_text())
source=Path(plan['source'])
backup=evidence/'source-backup'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
if plan['mismatches']: raise SystemExit('Baseline conflicts; no source files written')
if backup.exists(): raise SystemExit('A recoverable backup already exists; refusing to overwrite it')
for entry in plan['files']:
    if digest(source/entry['path'])!=entry['sourceBefore']: raise SystemExit('Source changed: '+entry['path'])
    if digest(candidate/entry['path'])!=entry['candidateAfter']: raise SystemExit('Candidate changed after verification: '+entry['path'])
backup.mkdir(parents=True)
for entry in plan['files']:
    target=source/entry['path']
    if target.exists():
        saved=backup/entry['path'];saved.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,saved)
(backup/'manifest.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2))
written=[]
try:
    for entry in plan['files']:
        target=source/entry['path'];target.parent.mkdir(parents=True,exist_ok=True)
        if digest(target)!=entry['sourceBefore']: raise RuntimeError('Concurrent source change: '+entry['path'])
        temp=target.with_name(target.name+'.sublime-auth-tmp');shutil.copy2(candidate/entry['path'],temp);os.replace(temp,target)
        written.append(entry)
except Exception:
    for entry in reversed(written):
        target=source/entry['path']
        if digest(target)!=entry['candidateAfter']: continue
        if entry['sourceBefore'] is None: target.unlink()
        else: shutil.copy2(backup/entry['path'],target)
    raise
report={**plan,'appliedAt':datetime.now(timezone.utc).isoformat(),'filesVerified':all(digest(source/e['path'])==e['candidateAfter'] for e in plan['files']),'installedAppChanged':False,'realVaultWritten':False,'backup':str(backup)}
(evidence/'source-applied.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({'appliedFiles':len(written),'verified':report['filesVerified'],'backup':str(backup)},ensure_ascii=False))
