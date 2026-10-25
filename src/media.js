// SPDX-License-Identifier: MIT
"use strict";
const {capabilities} = require("./capabilities.js");
// Match Operit's link markup, including arbitrary attribute order and escaped quotes.
const LINK = /<link\b[^>]*(?:\/>|>[\s\S]*?<\/link\s*>)/gi;
function attr(tag, key) {
  // Android string resources consume XML attribute quotes in the release APK.
  // Accept real device tags (type=image), quoted source fixtures and escaped quotes.
  const re = new RegExp(String.raw`\b${key}\s*=\s*(?:\\*["']([^"'\\\s<>]+)\\*["']|([^"'\\\s<>/]+))`, "i");
  const match = re.exec(tag);
  return match?.[1] || match?.[2] || "";
}
function parts(content, model, loadImage, allowExpiredHistory = false) {
  if (typeof content !== "string") return content;
  const found = Array.from(content.matchAll(LINK)).filter(m => ["image","audio","video"].includes(attr(m[0],"type").toLowerCase()));
  if (!found.length) return content;
  const out = []; let cursor = 0, total = 0;
  for (const m of found) {
    if (m.index > cursor) out.push({type:"text",text:content.slice(cursor,m.index)});
    const type = attr(m[0],"type").toLowerCase(), id = attr(m[0],"id");
    if (!capabilities(model).input[type]) throw new Error(`当前 WorkBuddy 模型/接口未开放 ${type} 输入，请选择支持该附件的模型或移除附件`);
    if (!id || id === "error") throw new Error("附件引用无效，请重新添加附件");
    const media = loadImage(id);
    if (!media || !media.base64) {
      if (!allowExpiredHistory) throw new Error("当前图片已失效或媒体池内容缺失，请重新添加图片");
      out.push({type:"text",text:"[历史图片已过期，本次未附带其图像内容；不能据此推断图片内容。]"});
      cursor = m.index + m[0].length;
      continue;
    }
    if (!["image/png","image/jpeg","image/webp","image/gif"].includes(media.mimeType)) throw new Error("图片 MIME 类型不受支持，请使用 PNG/JPEG/WebP/GIF");
    const b64 = String(media.base64).replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) throw new Error("图片编码无效，请重新添加图片");
    total += b64.length;
    if (b64.length > 14*1024*1024 || total > 28*1024*1024) throw new Error("图片过大，请压缩图片或减少附件数量后重试");
    out.push({type:"image_url",image_url:{url:`data:${media.mimeType};base64,${b64}`}});
    cursor = m.index + m[0].length;
  }
  if (cursor < content.length) out.push({type:"text",text:content.slice(cursor)});
  return out.every(p=>p.type==="text") ? out.map(p=>p.text).join("") : out;
}
function adapt(messages, model, loadImage) {
  const out=[];
  let lastUser=-1;
  messages.forEach((m,i)=>{if(m.role==="user")lastUser=i});
  for (const [index,m] of messages.entries()) {
    const content=parts(m.content,model,loadImage,index<lastUser);

    if (!Array.isArray(content)) {out.push({...m,content});continue;}
    // OpenAI tool results accept text only. Finish the result before adding its images.
    if (m.role === "tool") {
      out.push({...m,content:content.filter(p=>p.type==="text").map(p=>p.text).join("") || "工具返回图片，见紧随其后的附件。"});
      out.push({role:"user",content:[{type:"text",text:"前一工具返回的图片："},...content.filter(p=>p.type==="image_url")]});
    } else if (m.role === "user" || m.role === "assistant") out.push({...m,content});
    else throw new Error("系统消息不能包含媒体附件");
  }
  // Keep all parallel tool results contiguous before any user attachment message.
  for(let i=0;i<out.length;i++) {
    if(out[i].role!=="assistant" || !out[i].tool_calls?.length) continue;
    const n=out[i].tool_calls.length;const block=out.slice(i+1,i+1+n*2);
    const results=block.filter(m=>m.role==="tool").slice(0,n);
    if(results.length!==n) continue;
    let end=i+1,count=0;const images=[];
    while(end<out.length && count<n) {const m=out[end++];if(m.role==="tool") count++;else if(m.role==="user"&&Array.isArray(m.content)) images.push(m);else break;}
    if(count===n) out.splice(i+1,end-i-1,...results,...images);
  }
  return out;
}
module.exports={parts,adapt,attr};
