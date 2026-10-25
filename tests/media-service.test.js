// SPDX-License-Identifier: MIT
"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const diagnostics=require('../src/diagnostics.js');const writes=[];diagnostics.writeJson=(p,v)=>writes.push(JSON.stringify(v));
const service=require('../src/media-service.js');
const client={session:async()=>({auth:{accessToken:'ACCESS_SECRET'},account:{userId:'user'}})};
function fixture(mode='sync') {
 const calls=[];const p={delay:async()=>{},saveGenerated:async(url,type)=>({path:'/fixture/file.png',mimeType:'image/png',markup:'<link type="image" id="x">image</link>'}),request:async req=>{
  calls.push(req);
  if(req.url.endsWith('/v2/api-keys'))return{status:200,text:JSON.stringify({code:0,data:{key:'ck_t_SECRET',expires_at:999}})};
  if(req.url.endsWith('/generate/submit'))return{status:200,text:JSON.stringify({failed:false,code:0,data:{upstreamTaskId:'id-'+mode,mode,status:mode==='sync'?'completed':'queued',resultFiles:[{signedUrl:'https://test.myqcloud.com/test.png'}]}})};
  return{status:200,text:JSON.stringify({failed:false,code:0,data:{['id-'+mode]:{status:'completed',resultFiles:[{signedUrl:'https://test.myqcloud.com/test.png'}]}}})};
 }};return{p,calls};
}
test('sync generation localizes inline results without querying synthetic task ID',async()=>{const{p,calls}=fixture();const r=await service.generate(p,client,{type:'image',prompt:'red circle'});assert.equal(r.status,'completed');assert.equal(r.files.length,1);assert.equal(calls.length,2);assert.ok(!JSON.stringify(r).includes('SECRET'))});
test('async generation polls original task and uses temp key rather than access token',async()=>{const{p,calls}=fixture('async');const r=await service.generate(p,client,{type:'image',prompt:'red circle'});assert.equal(r.status,'completed');assert.equal(calls.filter(c=>c.url.endsWith('/generate/submit')).length,1);assert.deepEqual(calls[2].body,{upstreamTaskIds:['id-async']});assert.equal(calls[2].headers.authorization,'Bearer ck_t_SECRET');assert.ok(!writes.join('').includes('SECRET'))});
test('HTTP 200 with failed envelope stays an error',async()=>{await assert.rejects(()=>service.post({request:async()=>({status:200,text:JSON.stringify({failed:true,code:'AUTH_SCOPE_DENIED',httpStatus:403})})},'key','image','query-task',{}),/AUTH_SCOPE_DENIED/)});
test('reject unknown media type and empty prompt before network',async()=>{const{p,calls}=fixture();await assert.rejects(()=>service.submit(p,client,{type:'audio',prompt:'x'}),/仅支持/);await assert.rejects(()=>service.submit(p,client,{type:'image',prompt:''}),/描述/);assert.equal(calls.length,0)});
test('failed sync task is returned, never retried or polled',async()=>{const{p,calls}=fixture();const req=p.request;p.request=async r=>r.url.endsWith('/generate/submit')?{status:200,text:JSON.stringify({failed:false,data:{upstreamTaskId:'failed-sync',mode:'sync',status:'failed',errorMessage:'model not available'}})}:req(r);const r=await service.generate(p,client,{type:'image',prompt:'test'});assert.equal(r.status,'failed');assert.equal(calls.length,1)});
test('invalid video duration never mints a credential or submits',async()=>{const{p,calls}=fixture();await assert.rejects(()=>service.submit(p,client,{type:'video',prompt:'test',duration:99}),/5 或 10/);assert.equal(calls.length,0)});
