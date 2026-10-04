'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../verification');fs.mkdirSync(root,{recursive:true});
const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',null,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const sentences=['A quiet moment opens a space for a new idea.','A fragment becomes meaningful when its origin is preserved.'];
for(const [index,id] of [4,6].entries()){const stream=`BT /F1 16 Tf 50 700 Td (${sentences[index]}) Tj ET\n`;objects[id]=`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;}
let pdf='%PDF-1.4\n',offsets=[0];for(let id=1;id<objects.length;id++){offsets.push(Buffer.byteLength(pdf));pdf+=`${id} 0 obj\n${objects[id]}\nendobj\n`;}
const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(path.join(root,'excerpt-fixture.pdf'),pdf);
fs.writeFileSync(path.join(root,'readwise-fixture.csv'),'Book Title,Author,Highlight,Note,Location,Date,URL\r\n"静下来的一刻",Fixture Author,"A quiet moment opens a space for a new idea.","Keep the source, and the original words.","12-13",2026-10-02,https://sublime.app/\r\n"另一种联想",Fixture Author,"A fragment becomes meaningful when its origin is preserved.","Do not change this excerpt.","20",2026-10-02,https://sublime.app/\r\n');
console.log('Created public synthetic PDF and Readwise fixtures; no Vault reads.');
