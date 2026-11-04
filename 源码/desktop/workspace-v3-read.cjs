'use strict';
// Runs inside the trusted renderer. Returns committed entities only.
async function readCommittedV3(key, includeAssets) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('mengcang-sublime-workspace-v3');
    request.onupgradeneeded=()=>request.transaction.abort();
    request.onerror=()=>reject(Error('软件资料库读取失败'));
    request.onsuccess=()=>{
      const db=request.result;
      const tx=db.transaction(['cards','collections','boards','annotations','meta'],'readonly');
      const result={drafts:{}}, range=IDBKeyRange.bound([key],[key,[]]);let meta;
      const read=tx.objectStore('meta').get(key);
      read.onsuccess=()=>{meta=read.result;};
      for(const name of ['cards','collections','boards','annotations']){
        const records=tx.objectStore(name).getAll(range);
        records.onsuccess=()=>{result[name]=records.result;};
      }
      tx.oncomplete=()=>{
        db.close();if(!meta){resolve(null);return;}
        for(const name of ['cards','collections','boards']){
          const map=new Map(result[name].map(row=>[row.id,row.value]));
          result[name]=(meta.order[name]||[]).map(id=>map.get(id)).filter(Boolean);
        }
        result.annotations=Object.fromEntries(result.annotations.map(row=>[row.id,row.value]));
        const saved=new Set(meta.savedIds),hidden=new Set(meta.hiddenIds);
        result.cards=result.cards.filter(card=>saved.has(card.id)&&!hidden.has(card.id)).map(card=>{
          const {image,attachment,...rest}=card;
          return {...rest,imageAvailable:!!image||attachment?.type?.startsWith('image/'),
            image:includeAssets?image:'',attachment:attachment?(includeAssets?attachment:{name:attachment.name,type:attachment.type,size:attachment.size}):null};
        });
        Object.assign(result,{schemaVersion:1,version:1,savedIds:meta.savedIds,favoriteIds:meta.favoriteIds,hiddenIds:meta.hiddenIds});
        resolve({revision:meta.revision,state:result});
      };
      tx.onerror=tx.onabort=()=>{db.close();reject(tx.error||Error('软件资料读取中断'));};
    };
  });
}
module.exports={readCommittedV3};
