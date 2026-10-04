import Foundation
import NaturalLanguage
import Vision
import PDFKit
import ImageIO
import AppKit

enum HelperFailure: Error { case invalid(String) }
func fail(_ message:String) throws -> Never { throw HelperFailure.invalid(message) }
func decode(_ value:Any?, max:Int) throws -> Data {
    guard let raw=value as? String, raw.utf8.count<=max*4/3+16,
          let data=Data(base64Encoded:raw), !data.isEmpty, data.count<=max else { try fail("文件为空或超过允许大小") }
    return data
}
func recognize(_ image:CGImage) throws -> String {
    guard image.width*image.height<=25_000_000 else { try fail("图片像素超过2500万，请使用较小图片") }
    let request=VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans","en-US"]
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage:image,options:[:]).perform([request])
    return (request.results ?? []).compactMap{$0.topCandidates(1).first?.string}.joined(separator:"\n")
}
func imageOCR(_ data:Data) throws -> String {
    guard let source=CGImageSourceCreateWithData(data as CFData,nil), let image=CGImageSourceCreateImageAtIndex(source,0,nil) else { try fail("无法识别图片格式") }
    return try recognize(image)
}
func extract(_ request:[String:Any]) throws -> [String:Any] {
    let kind=request["kind"] as? String ?? "image"
    let data=try decode(request["base64"],max:kind=="pdf" ? 20*1024*1024 : 8*1024*1024)
    if kind=="image" { return ["text":try imageOCR(data),"engine":"Apple Vision","pages":[]] }
    guard kind=="pdf", data.starts(with:Data("%PDF-".utf8)),let document=PDFDocument(data:data),!document.isLocked else { try fail("PDF无效或需要密码") }
    guard document.pageCount<=100 else { try fail("本次最多处理100页，请拆分文件后导入") }
    var pages:[[String:Any]]=[]
    for index in 0..<document.pageCount {
        guard let page=document.page(at:index) else { continue }
        var text=page.string ?? ""
        var engine="PDFKit"
        if text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
            let thumb=page.thumbnail(of:NSSize(width:1600,height:2000),for:.mediaBox)
            if let cg=thumb.cgImage(forProposedRect:nil,context:nil,hints:nil) { text=try recognize(cg);engine="Apple Vision" }
        }
        guard text.utf8.count<=200_000 else { try fail("单页文字过长，请拆分后导入") }
        pages.append(["page":index+1,"text":text,"engine":engine])
    }
    return ["text":pages.compactMap{$0["text"] as? String}.joined(separator:"\n\n"),"pages":pages,"engine":"PDFKit + Apple Vision"]
}
func capabilities() -> [String:Any] {
    let languages:[NLLanguage]=[.simplifiedChinese,.english]
    return ["ocr":true,"pdf":true,"local":true,"semanticLanguages":languages.filter{NLEmbedding.sentenceEmbedding(for:$0) != nil}.map{$0.rawValue}]
}
func analyze(_ request:[String:Any]) throws -> [String:Any] {
    if request["texts"] != nil && !(request["texts"] is [[String:Any]]) { try fail("文字分析格式无效") }
    if request["images"] != nil && !(request["images"] is [[String:Any]]) { try fail("图片分析格式无效") }
    let texts=request["texts"] as? [[String:Any]] ?? []
    let images=request["images"] as? [[String:Any]] ?? []
    guard texts.count<=512,images.count<=32 else { try fail("一次最多分析512份文字或32张图片") }
    var embeddings:[[String:Any]]=[],ocr:[[String:Any]]=[]
    for entry in texts {
        guard let id=entry["id"] as? String,id.count<=2048,let text=entry["text"] as? String,text.count<=20_000 else { try fail("文本分析输入无效") }
        if text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { continue }
        let detector=NLLanguageRecognizer();detector.processString(text)
        let language=detector.dominantLanguage ?? .english
        if let embedding=NLEmbedding.sentenceEmbedding(for:language),let vector=embedding.vector(for:text) {
            embeddings.append(["id":id,"language":language.rawValue,"model":"apple-nl-sentence-\(language.rawValue)-r\(embedding.revision)","vector":vector])
        }
    }
    for entry in images {
        guard let id=entry["id"] as? String,id.count<=2048 else { try fail("图片标识无效") }
        let text=try imageOCR(decode(entry["base64"],max:8*1024*1024))
        ocr.append(["id":id,"text":text,"engine":"Apple Vision"])
    }
    return ["embeddings":embeddings,"ocr":ocr,"capabilities":capabilities()]
}
do {
    let data=FileHandle.standardInput.readDataToEndOfFile()
    guard data.count<=32*1024*1024,let request=try JSONSerialization.jsonObject(with:data) as? [String:Any] else { try fail("请求格式无效") }
    let command=request["command"] as? String ?? "analyze"
    let result:[String:Any]
    switch command { case "capabilities":result=capabilities();case "extract":result=try extract(request);case "analyze":result=try analyze(request);default:try fail("不支持此请求") }
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject:result,options:[.sortedKeys]))
} catch {
    let message:String
    if case HelperFailure.invalid(let detail)=error { message=detail } else { message="本地分析失败：\(error.localizedDescription)" }
    let data=(try? JSONSerialization.data(withJSONObject:["error":message])) ?? Data()
    FileHandle.standardOutput.write(data)
    exit(1)
}
