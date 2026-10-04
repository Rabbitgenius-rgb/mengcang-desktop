import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createCanvas} from '@napi-rs/canvas';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {pdfDocumentOptions,fitPdfViewport} from '../src/sublime/pdfPreview.js';
const base=fileURLToPath(new URL('../node_modules/pdfjs-dist/',import.meta.url));
function syntheticPdf(){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',null,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 for(const [index,text] of [[3,'First fixture page'],[5,'Second fixture page']]){const stream=`BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;objects[index]=`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;}
 let output='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(output));output+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(output);output+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Uint8Array(Buffer.from(output));
}
test('PDF options consume bytes with executable PDF/XFA disabled and local assets only',()=>{
 const bytes=new Uint8Array([1]),options=pdfDocumentOptions(bytes,'/pdf-assets/');assert.equal(options.data,bytes);assert.equal(options.isEvalSupported,false);assert.equal(options.enableXfa,false);assert.equal(options.url,undefined);for(const key of ['cMapUrl','standardFontDataUrl','wasmUrl'])assert.ok(options[key].startsWith('/pdf-assets/'));
});
test('real existing attachment fixture parses as a document without native object viewer',async()=>{
 const task=getDocument({...pdfDocumentOptions(new Uint8Array(await fs.readFile(new URL('../../../tests/fixtures/discovery-excerpt.pdf',import.meta.url))),base),useSystemFonts:false});const pdf=await task.promise;assert.ok(pdf.numPages>=1);const page=await pdf.getPage(1);assert.ok((await page.getTextContent()).items.some(item=>item.str?.trim()));await task.destroy();
});
test('two pages render distinct nonblank pixels with the actual PDF.js renderer',async()=>{
 const task=getDocument({...pdfDocumentOptions(syntheticPdf(),base),useSystemFonts:false,disableFontFace:true});const pdf=await task.promise;assert.equal(pdf.numPages,2);const digests=[];
 for(let number=1;number<=2;number++){const page=await pdf.getPage(number),fit=fitPdfViewport(page,300,1),canvas=createCanvas(fit.width,fit.height),context=canvas.getContext('2d');await page.render({canvasContext:context,viewport:fit.viewport,background:'rgb(255,255,255)'}).promise;const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;assert.ok(pixels.some((value,index)=>index%4!==3&&value<150));digests.push(canvas.toBuffer('image/png').toString('base64'));page.cleanup();}assert.notEqual(digests[0],digests[1]);await task.destroy();
});
