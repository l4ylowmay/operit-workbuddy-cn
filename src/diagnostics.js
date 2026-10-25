// SPDX-License-Identifier: MIT
"use strict";
const {capabilities} = require("./capabilities.js");
const J = n=>Java.type(n);
function writeJson(path,value) {
  const file=new (J("java.io.File"))(path);file.getParentFile().mkdirs();
  const writer=new (J("java.io.OutputStreamWriter"))(new (J("java.io.FileOutputStream"))(file),"UTF-8");
  try {writer.write(JSON.stringify(value,null,2));} finally {writer.close();}
}
async function run(client,provider) {
  const models=await client.models(),status=await client.status();
  const report={version:"0.2.1",timestamp:new Date().toISOString(),models:models.map(m=>({id:m.id,name:m.name,
    fieldNames:Object.keys(m),supportsImages:m.supportsImages,supportsToolCall:m.supportsToolCall,supportsTools:m.supportsTools,supportsReasoning:m.supportsReasoning,
    inputModalities:m.inputModalities,outputModalities:m.outputModalities,capabilities:capabilities(m)})),tests:[]};
  const path="/sdcard/Download/Operit/codex_wb/diagnostics.json";
  writeJson(path,report);
  const current=models.find(m=>m.id===status.model)||models[0];
  const imageModel=(current?.supportsImages ? current : models.find(m=>m.supportsImages===true));
  async function test(name,model,history,tools=[],thinking=false) {
    const start=Date.now();
    try {
      const r=await provider.sendMessage({eventPayload:{config:{modelName:model.id,enableToolCall:tools.length>0,
        enableDirectImageProcessing:true,enableDirectAudioProcessing:true,enableDirectVideoProcessing:true},
        chatHistory:history,availableTools:tools,modelParameters:[],stream:false,enableThinking:thinking}});
      report.tests.push({name,model:model.id,ok:!!r.text,text:r.text,usage:r.usage,durationMs:Date.now()-start});
    } catch(e) {report.tests.push({name,model:model.id,ok:false,error:String(e.message),durationMs:Date.now()-start});}
    writeJson(path,report);
  }
  await test("text_with_all_direct_flags",current,[{kind:"USER",content:"Reply exactly WB020_OK"}]);
  await test("multi_turn",current,[{kind:"USER",content:"Remember the code WB4827"},{kind:"ASSISTANT",content:"OK"},{kind:"USER",content:"What code did I ask you to remember?"}]);
  await test("thinking_enabled",current,[{kind:"USER",content:"What is 17+28?"}],[],true);
  await test("native_tool_call",current,[{kind:"USER",content:"You must call diagnostic:clock once to get the current time. Do not answer without calling the tool."}],[{name:"diagnostic:clock",description:"Get current time",parametersStructured:[]}]);
  if(imageModel) {
    try {
      const id=J("com.ai.assistance.operit.util.ImagePoolManager").INSTANCE.addImage("/sdcard/Download/Operit/codex_wb/red.png",null);
      if(!id||id==="error")throw new Error("测试图片无法加入媒体池");
      await test("image_input",imageModel,[{kind:"USER",content:`What is the dominant color? <link type="image" id="${id}">image</link>`}]);
      await test("image_followup",imageModel,[{kind:"USER",content:`Remember the color in this image. <link type="image" id="${id}">image</link>`},{kind:"ASSISTANT",content:"The color is red."},{kind:"USER",content:"What color was in the image?"}]);
      const screenId=J("com.ai.assistance.operit.util.ImagePoolManager").INSTANCE.addImage("/sdcard/Download/Operit/codex_wb/screen.png",null);
      if(screenId && screenId!=="error") await test("screenshot_understanding",imageModel,[{kind:"USER",content:`Read the application/plugin name and version shown in this screenshot. <link type="image" id="${screenId}">screen</link>`}]);
      const tool={name:"diagnostic:color",description:"Get a color swatch image",parametersStructured:[]};
      await test("tool_image_history",imageModel,[{kind:"USER",content:"Get the swatch"},{kind:"ASSISTANT",content:'<tool_test name="diagnostic:color"></tool_test>'},
        {kind:"TOOL_RESULT",toolName:"diagnostic:color",content:`<tool_result_test name="diagnostic:color"><content><link type="image" id="${id}">image</link></content></tool_result_test>`},
        {kind:"USER",content:"What is the dominant color in the tool image?"}],[tool]);
    }catch(e){report.tests.push({name:"media_pool",ok:false,error:String(e.message)});writeJson(path,report);}
  }
  return `诊断已保存：${path}；${report.tests.filter(t=>t.ok).length}/${report.tests.length} 项获得响应。请核对实际正文。`;
}
module.exports={run,writeJson};
function backup() {
  // Commands run as the app UID, without su or any privilege changes.
  const dest="/data/user/0/com.ai.assistance.operit/files/codex_wb_backup_020";
  if(new (J("java.io.File"))(dest+"/complete").exists())return;
  for(const cmd of ["/system/bin/mkdir -p "+dest,
    "/system/bin/cp -R /data/user/0/com.ai.assistance.operit/shared_prefs "+dest+"/",
    "/system/bin/cp -R /data/user/0/com.ai.assistance.operit/files/datastore "+dest+"/"]) {
    if(J("java.lang.Runtime").getRuntime().exec(cmd).waitFor()!==0)throw new Error("配置备份失败；尚未修改模型配置");
  }
  writeJson(dest+"/complete",{version:"0.2.1"});
}
module.exports.backup=backup;
