from pathlib import Path
import hashlib,json,os,shutil,uuid
root=Path(__file__).resolve().parents[1]
source=Path('/Users/rabbit/Documents/ChatGPT/名器/work/梦藏')
record=json.loads((root/'source-applied.json').read_text())
files=[
'inspiration-text-BCUMTc7F.avif','inspiration-article-DNTtDhJZ.avif',
'inspiration-image-DJx0yAgh.avif','inspiration-website-DQCABkUC.avif',
'inspiration-highlight-CJ83Yr0g.avif','inspiration-audio-BQ4iBmk-.avif']
items=[]
for name in files:
    relative='prototypes/desktop-workbench/public/assets/'+name
    target=source/relative
    current=source
    for part in Path(relative).parts:
        current/=part
        if current.is_symlink(): raise RuntimeError('Symlink rejected')
    if target.exists(): raise RuntimeError('Do not replace an occupied reference asset')
    items.append({'path':relative,'before':None,'after':hashlib.sha256((root/relative).read_bytes()).hexdigest()})
created=[]
try:
    for item in items:
        target=source/item['path'];target.parent.mkdir(parents=True,exist_ok=True)
        # An exclusive create preserves any file concurrently added by the user.
        with target.open('xb') as output: output.write((root/item['path']).read_bytes())
        created.append(item)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=item['after']: raise RuntimeError('Asset postcheck failed')
except Exception:
    for item in created:
        target=source/item['path']
        if hashlib.sha256(target.read_bytes()).hexdigest()==item['after']:target.unlink()
    raise
record['files'].extend(items);record['fileCount']=len(record['files'])
record['referenceAssetsAdded']=len(items)
(root/'source-applied.json').write_text(json.dumps(record,ensure_ascii=False,indent=2))
(root/'integration-backup/assets-manifest.json').write_text(json.dumps({'files':items},ensure_ascii=False,indent=2))
print('Added and hash-verified six browser-demo reference assets. Real DTOs never use fallback images.')
