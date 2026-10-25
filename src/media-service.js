// SPDX-License-Identifier: MIT
"use strict";
const {CLIENT_HEADERS,enterpriseHeaders,parseResponse}=require("./client.js");
const temporaryKeys = new Map();
const BASE="https://public.miora.qq.com/api/ai/workbuddy-proxy";
async function key(platform,client) {
  const e=await client.session();
  const data=parseResponse(await platform.request({url:"https://copilot.tencent.com/v2/api-keys",method:"POST",
    headers:{...CLIENT_HEADERS,...enterpriseHeaders(e),"X-User-Id":e.account.userId,authorization:`Bearer ${e.auth.accessToken}`},
    body:{name:"operit-workbuddy-media",expire_in_seconds:900,temporary:true}}));
  if(!data?.key?.startsWith("ck_t_"))throw new Error("WorkBuddy 未返回媒体服务所需短期凭据，未启用媒体生成");
  return data.key;
}
async function probe(platform,client) {
  const token=await key(platform,client),results=[];
  for(const type of ["image","video"]) {
    const r=await platform.request({url:`${BASE}/${type}/query-task`,method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:{upstreamTaskIds:[]}});
    let body={};try{body=JSON.parse(r.text)}catch(_){}
    results.push({type,http:r.status,code:body.code,failed:body.failed,httpStatus:body.httpStatus,message:String(body.message||"").split(token).join("[REDACTED]").slice(0,500),dataKeys:Object.keys(body.data||body)});
  }
  require("./diagnostics.js").writeJson("/sdcard/Download/Operit/codex_wb/media-probe.json",{time:new Date().toISOString(),results});
  return "媒体服务探测已保存；仅 HTTP 200 不代表业务成功，请查看业务码和权限结果。";
}
module.exports={key,probe};
async function post(platform,token,type,path,body) {
  const r=await platform.request({url:`${BASE}/${type}/${path}`,method:"POST",timeout:90000,
    headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body});
  let b;try{b=JSON.parse(r.text)}catch(_){throw new Error(`媒体服务响应无效（HTTP ${r.status}）`)}
  if(r.status<200||r.status>=300||b.failed===true) {
    const code=String(b.code||r.status).replace(/[^A-Za-z0-9_-]/g,"").slice(0,60);
    const e=new Error(`WorkBuddy 媒体服务拒绝请求（${code}，HTTP ${b.httpStatus||r.status}）；请检查账号权限或稍后查询已有任务，勿重复提交`);e.code=code;throw e;
  }
  return ("data"in b && "failed"in b)?b.data:b;
}
async function submit(platform,client,args) {
  const type=args.type;
  if(!["image","video"].includes(type))throw new Error("仅支持图片或视频生成");
  if(typeof args.prompt!=="string"||!args.prompt.trim()||args.prompt.length>12000)throw new Error("请提供 1–12000 字符的生成描述");
  const body={prompt:args.prompt};
  if(type==="image") {if(args.size)body.size=args.size;if(args.quality)body.quality=args.quality;}
  else {if(args.duration!==undefined){if(![5,10].includes(Number(args.duration)))throw new Error("测试版视频时长仅允许 5 或 10 秒");body.duration=Number(args.duration);} if(args.resolution)body.resolution=args.resolution;if(args.aspect_ratio)body.aspect_ratio=args.aspect_ratio;}
  const token=await key(platform,client);
  const data=await post(platform,token,type,type==="image"?"generate/submit":"submit",body);
  if(!data?.upstreamTaskId)throw new Error("服务未返回任务 ID，提交状态未知；请勿自动重试，以免重复扣费");
  temporaryKeys.set(data.upstreamTaskId,token);
  const record={type,taskId:data.upstreamTaskId,model:data.model,provider:data.provider,mode:data.mode,status:data.status||"submitted",
    errorMessage:String(data.errorMessage||"").split(token).join("[REDACTED]").slice(0,700)};
  if(data.mode==="sync" && data.status==="completed") record.files=await localize(platform,type,data.resultFiles);
  require("./diagnostics.js").writeJson("/sdcard/Download/Operit/codex_wb/submitted-media-task.json",record);
  require("./diagnostics.js").writeJson("/sdcard/Download/Operit/codex_wb/last-media-task.json",record);
  return record;
}
async function query(platform,client,args) {
  if(!["image","video"].includes(args.type)||typeof args.taskId!=="string"||!args.taskId||args.taskId.length>300)throw new Error("媒体类型或任务 ID 无效");
  if(args.taskId.startsWith("wb-sync-")) {
    let cached;try{cached=readLast()}catch(_){}
    if(cached?.taskId===args.taskId && cached.type===args.type && cached.mode==="sync")return cached;
    throw new Error("该任务为同步模式，结果在提交响应中；不能使用异步查询接口，请查看生成工具返回的附件");
  }
  const token=temporaryKeys.get(args.taskId)||await key(platform,client);
  temporaryKeys.set(args.taskId,token);
  const result=await post(platform,token,args.type,"query-task",{upstreamTaskIds:[args.taskId]});
  const entry=result?.[args.taskId];
  if(!entry)throw new Error("服务未返回该任务状态，请保留任务 ID 稍后查询");
  const out={type:args.type,taskId:args.taskId,status:entry.status,errorMessage:String(entry.errorMessage||"").split(token).join("[REDACTED]").slice(0,700),files:[]};
  if(entry.status==="completed") {
    out.files=await localize(platform,args.type,entry.resultFiles);
  }
  require("./diagnostics.js").writeJson("/sdcard/Download/Operit/codex_wb/last-media-task.json",out);
  return out;
}
async function generate(platform,client,args) {
  const job=await submit(platform,client,args);
  if(job.mode==="sync")return job;
  const deadline=Date.now()+(args.type==="video"?480000:90000);
  while(Date.now()<deadline) {
    await platform.delay(3000);
    const r=await query(platform,client,job);
    if(r.status==="completed")return r;
    if(["failed","cancelled"].includes(r.status))throw new Error(`媒体任务${r.status}，任务 ID：${job.taskId}`);
  }
  return {...job,status:"pending",message:"任务仍在运行，请按 taskId 查询；不要再次提交"};
}
async function localize(platform,type,files) {
  if(!Array.isArray(files)||!files.length)throw new Error("任务完成但未返回媒体文件");
  const out=[];
  for(const f of files.slice(0,4)) {
    if(typeof f.signedUrl!=="string")throw new Error("生成文件缺少下载地址");
    out.push(await platform.saveGenerated(f.signedUrl,type));
  }
  return out;
}
function readLast() {
  const J=n=>Java.type(n);
  return JSON.parse(new (J("java.lang.String"))(new (J("android.util.AtomicFile"))(new (J("java.io.File"))("/sdcard/Download/Operit/codex_wb/last-media-task.json")).readFully(),"UTF-8").toString());
}
module.exports.readLast=readLast;
module.exports.submit=submit;module.exports.query=query;module.exports.generate=generate;module.exports.post=post;
