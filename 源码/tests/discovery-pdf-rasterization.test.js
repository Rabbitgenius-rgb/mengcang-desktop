'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

// Exercise the production renderer directly, without running Vision, semantic
// models, any generation executable, or a network/credential provider.
test('scanned PDF rasterization keeps scale, box origins and quarter-turn rotations within the pixel budget',{skip:process.platform!=='darwin'},t=>{
  const root=path.resolve(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'desktop/DiscoveryHelper.swift'),'utf8');
  const marker='\ndo {\n    let data=FileHandle.standardInput.readDataToEndOfFile()';
  assert.equal(source.split(marker).length,2);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mengcang-pdf-raster-test-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const run=(file,args)=>{
    const result=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,0,result.stderr||result.stdout);
    return result.stdout;
  };
  const harness=String.raw`
func pixels(_ image:CGImage) -> [String:Any] {
    let data=image.dataProvider!.data! as Data
    var minX=image.width,minY=image.height,maxX = -1,maxY = -1
    for y in 0..<image.height {
        for x in 0..<image.width {
            let offset=y*image.bytesPerRow+x*4
            if data[offset]<150 && data[offset+1]<150 && data[offset+2]<150 {
                minX=min(minX,x);minY=min(minY,y);maxX=max(maxX,x);maxY=max(maxY,y)
            }
        }
    }
    return ["width":image.width,"height":image.height,"ink":[minX,minY,maxX,maxY]]
}
let document=PDFDocument(url:URL(fileURLWithPath:CommandLine.arguments[1]))!
let page=document.page(at:0)!,original=page.bounds(for:.mediaBox)
var output:[String:Any]=[:]
for (name,rotation,box) in [("normal",0,original),("rotation90",90,original),("rotation270",270,original),
    ("offset",0,CGRect(x:-24,y:-36,width:original.width+48,height:original.height+72)),
    ("offset90",90,CGRect(x:-24,y:-36,width:original.width+48,height:original.height+72)),
    ("large",0,CGRect(x:0,y:0,width:10000,height:10000)),
    ("wide",0,CGRect(x:0,y:0,width:10000,height:100))] {
    page.setBounds(box,for:.mediaBox);page.rotation=rotation
    output[name]=pixels(try rasterizeForOCR(page))
}
print(String(data:try JSONSerialization.data(withJSONObject:output),encoding:.utf8)!)
`;
  const swift=path.join(temp,'RasterCheck.swift'),binary=path.join(temp,'raster-check');
  fs.writeFileSync(swift,source.split(marker)[0]+harness);
  const sdk=run('xcrun',['--sdk','macosx','--show-sdk-path']).trim();
  run('xcrun',['swiftc','-module-cache-path',path.join(temp,'modules'),'-sdk',sdk,'-target','arm64-apple-macos13.0','-O',swift,'-o',binary]);
  const data=JSON.parse(run(binary,[path.join(root,'tests/fixtures/discovery-chinese-scanned.pdf')]));
  const near=(actual,expected)=>{assert.equal(actual.length,expected.length);actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<=3,`${actual} differs from ${expected}`));};
  const n=data.normal;
  assert.ok(n.width>2400 && n.height>3400,'OCR must render A4 around 300 DPI, not at native 72 DPI or preview resolution');
  for(const r of [data.rotation90,data.rotation270]){assert.equal(r.width,n.height);assert.equal(r.height,n.width);}
  near(data.rotation90.ink,[n.height-1-n.ink[3],n.ink[0],n.height-1-n.ink[1],n.ink[2]]);
  near(data.rotation270.ink,[n.ink[1],n.width-1-n.ink[2],n.ink[3],n.width-1-n.ink[0]]);
  near(data.offset.ink,n.ink.map((value,index)=>value+(index%2===0?100:150)));
  const o=data.offset;
  near(data.offset90.ink,[o.height-1-o.ink[3],o.ink[0],o.height-1-o.ink[1],o.ink[2]]);
  for(const row of Object.values(data)){assert.ok(row.width*row.height<=25_000_000);assert.ok(Math.max(row.width,row.height)<=8192);}
  assert.equal(data.large.width,5000);assert.equal(data.large.height,5000);
  assert.equal(data.wide.width,8192);
});
