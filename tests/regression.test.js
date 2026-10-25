// SPDX-License-Identifier: MIT
"use strict";
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {parts,adapt}=require('../src/media.js'); const {createProvider}=require('../src/provider.js');
const {capabilities}=require('../src/capabilities.js');
const vision={id:'vision',supportsImages:true},text={id:'text'};
const load=id=>id==='missing'?null:{base64:'AQID',mimeType:'image/png'};
const img=id=>`<link type="image" id="${id}">image</link>`;
test('plain text unaffected by unsupported modalities',()=>assert.equal(parts('hello',text,load),'hello'));
test('unknown capabilities are not enabled',()=>assert.equal(capabilities({}).input.image,false));
test('ordered text and multiple images',()=>assert.deepEqual(parts('a'+img('1')+'b'+img('2')+'c',vision,load).map(x=>x.type),['text','image_url','text','image_url','text']));
test('escaped quotes and arbitrary attributes',()=>assert.equal(parts('<link id=\\"1\\" type=\\"image\\" />',vision,load)[0].type,'image_url'));
test('unsupported real attachment rejected',()=>assert.throws(()=>parts(img('1'),text,load),/未开放/));
test('audio video rejected explicitly',()=>{for(const t of ['audio','video'])assert.throws(()=>parts(`<link type="${t}" id="x"/>`,vision,load),/未开放/)});
test('missing media rejected',()=>assert.throws(()=>parts(img('missing'),vision,load),/缺失/));
test('invalid MIME and base64 rejected',()=>{assert.throws(()=>parts(img('1'),vision,()=>({base64:'AQID',mimeType:'text/html'})),/MIME/);assert.throws(()=>parts(img('1'),vision,()=>({base64:'bad!',mimeType:'image/png'})),/编码/)});
test('oversize rejected',()=>assert.throws(()=>parts(img('1'),vision,()=>({base64:'AAAA'.repeat(4*1024*1024),mimeType:'image/png'})),/过大/));
test('parallel tool results remain paired before image user turns',()=>{
 const result=adapt([{role:'assistant',tool_calls:[{id:'a'},{id:'b'}]}, {role:'tool',tool_call_id:'a',content:img('1')},{role:'tool',tool_call_id:'b',content:img('2')},{role:'user',content:'describe'}],vision,load);
 assert.deepEqual(result.map(x=>x.role),['assistant','tool','tool','user','user','user']);
 assert.deepEqual(result.slice(1,3).map(x=>x.tool_call_id),['a','b']);
});
test('history remains immutable',()=>{const a=[{role:'user',content:img('1')}];adapt(a,vision,load);assert.equal(typeof a[0].content,'string')});
test('provider uses SSE even for nonstream host with all direct flags',async()=>{
 let sent;const emitted=[];
 const client={session:async()=>({account:{userId:'fixture'},auth:{accessToken:'fixture'}}),modelsForSession:async()=>[vision],models:async()=>[vision],status:async()=>({model:'vision'})};
 const platform={loadImage:load,request:async req=>{sent=req;req.onLine('data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}]}));req.onLine('');req.onLine('data: [DONE]');req.onLine('');return {streaming:true}}};
 const p=createProvider(platform,client,x=>emitted.push(x),()=> 'tool_fixture');
 const r=await p.sendMessage({eventPayload:{config:{modelName:'vision',enableDirectImageProcessing:true,enableDirectAudioProcessing:true,enableDirectVideoProcessing:true},chatHistory:[{kind:'USER',content:'hello'}],stream:false}});
 assert.equal(r.text,'OK');assert.equal(sent.body.stream,true);assert.equal(sent.headers.accept,'text/event-stream');assert.equal(emitted.length,0);
});
const {createCompletion}=require('../src/protocol.js');
test('truncated SSE never emits executable tool markup',()=>{const chunks=[];const c=createCompletion([{name:'a',alias:'operit_0',parameters:[]}],x=>chunks.push(x),'tool_test');c.line('data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{name:'operit_0',arguments:'{}'}}]},finish_reason:'tool_calls'}]}));c.line('');assert.throws(()=>c.finish(true),/中断/);assert.equal(chunks.length,0)});
test('complete SSE emits text once and keeps usage',()=>{const chunks=[];const c=createCompletion([],x=>chunks.push(x.chunk),'tool_test');for(const l of ['data: '+JSON.stringify({choices:[{delta:{content:'OK'},finish_reason:'stop'}],usage:{prompt_tokens:5,completion_tokens:2}}),'','data: [DONE]',''])c.line(l);const r=c.finish(true);assert.equal(chunks.join(''),'OK');assert.equal(r.usage.input,5)});
test('release APK unquoted image attributes resolve the real media pool ID',()=>{
 let actual;
 const content='计算一下这顿饭的热量 <link type=image id=00000000-0000-4000-8000-000000000001>图片</link>';
 const r=parts(content,vision,id=>{actual=id;return load(id)});
 assert.equal(actual,'00000000-0000-4000-8000-000000000001');
 assert.equal(r[1].type,'image_url');assert.ok(r[1].image_url.url.startsWith('data:image/png;base64,'));
});
test('unquoted unsupported media must be rejected instead of sent as text',()=>{
 for(const type of ['audio','video'])assert.throws(()=>parts(`<link type=${type} id=123>附件</link>`,vision,load),/未开放/);
});
test('unquoted self closing and mixed quoted attributes',()=>{
 for(const tag of ['<link type=image id=123/>','<link id=123 type="image">图片</link>',"<link type='image' id=123>图片</link>"])
  assert.equal(parts(tag,vision,load)[0].type,'image_url');
});
test('expired history image cannot block a newly attached valid image',()=>{
 const r=adapt([{role:'user',content:'<link type=image id=missing>old</link>'},{role:'assistant',content:'old reply'},{role:'user',content:'<link type=image id=valid>new</link>'}],vision,load);
 assert.match(r[0].content,/历史图片已过期/);assert.equal(r[2].content[0].type,'image_url');
});
test('current missing attachment still fails explicitly',()=>assert.throws(()=>adapt([{role:'user',content:'<link type=image id=missing>image</link>'}],vision,load),/当前图片已失效/));
