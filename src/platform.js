// SPDX-License-Identifier: MIT
/* Only verified Operit Java bridge + Android public APIs. Never use toolCall/HTTP
 * tools for credential-bearing traffic: those tools have user-visible history. */
"use strict";

const J = name => Java.type(name);
const bytes = text => new (J("java.lang.String"))(text).getBytes("UTF-8");
const utf8 = data => new (J("java.lang.String"))(data, "UTF-8").toString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ALIAS = "operit.workbuddy.cn.v1";

function localFile(name) {
  return new (J("java.io.File"))(Java.getApplicationContext().getNoBackupFilesDir(), name);
}

function key(create) {
  const store = J("java.security.KeyStore").getInstance("AndroidKeyStore");
  store.load(null);
  if (store.containsAlias(ALIAS)) return store.getKey(ALIAS, null);
  if (!create) throw new Error("设备密钥不可用，请删除本插件本机凭据后重新登录");
  const generator = J("javax.crypto.KeyGenerator").getInstance("AES", "AndroidKeyStore");
  const spec = new (J("android.security.keystore.KeyGenParameterSpec$Builder"))(ALIAS, 3)
    .setBlockModes(["GCM"]).setEncryptionPaddings(["NoPadding"]).setKeySize(256).build();
  generator.init(spec);
  return generator.generateKey();
}

// Lock covers each read/modify/write and token rotation across all JS runtimes.
async function withStore(action) {
  const raf = new (J("java.io.RandomAccessFile"))(localFile("workbuddy-cn.lock"), "rw");
  const channel = raf.getChannel();
  let lock;
  const deadline = Date.now() + 45000;
  try {
    while (!lock) {
      try { lock = channel.tryLock(); } catch (error) {
        // OverlappingFileLockException means another runtime in the same process.
        // Never propagate native exception text (which may include upstream data).
        if (!String(error.message).includes("OverlappingFileLockException")) {
          throw new Error("本机凭据锁不可用");
        }
      }
      if (!lock) {
        if (Date.now() >= deadline) throw new Error("账号正在更新，请稍后重试");
        await delay(100);
      }
    }
    const file = new (J("android.util.AtomicFile"))(localFile("workbuddy-cn.vault"));
    const base64 = J("android.util.Base64");
    const read = () => {
      const backup = new (J("java.io.File"))(file.getBaseFile().getPath() + ".bak");
      if (!file.getBaseFile().exists() && !backup.exists()) return {version: 1, entries: [], activeId: null, model: "", pending: null};
      try {
        const envelope = JSON.parse(utf8(file.readFully()));
        if (envelope.version !== 1) throw new Error("version");
        const cipher = J("javax.crypto.Cipher").getInstance("AES/GCM/NoPadding");
        cipher.init(2, key(false), new (J("javax.crypto.spec.GCMParameterSpec"))(128, base64.decode(envelope.iv, 2)));
        cipher.updateAAD(bytes(ALIAS));
        const value = JSON.parse(utf8(cipher.doFinal(base64.decode(envelope.data, 2))));
        if (value.version !== 1 || !Array.isArray(value.entries)) throw new Error("schema");
        return value;
      } catch (_) { throw new Error("无法解密本机凭据，请在原设备重试；请勿迁移凭据文件"); }
    };
    const write = value => {
      const cipher = J("javax.crypto.Cipher").getInstance("AES/GCM/NoPadding");
      cipher.init(1, key(true));
      cipher.updateAAD(bytes(ALIAS));
      const data = cipher.doFinal(bytes(JSON.stringify(value)));
      const envelope = {version: 1, iv: base64.encodeToString(cipher.getIV(), 2), data: base64.encodeToString(data, 2)};
      const output = file.startWrite();
      try { output.write(bytes(JSON.stringify(envelope))); file.finishWrite(output); }
      catch (_) { file.failWrite(output); throw new Error("保存加密凭据失败"); }
    };
    return await action({read, write, erase: () => file.delete()});
  } finally { if (lock) lock.release(); channel.close(); raf.close(); }
}

// Fixed HTTPS destinations; redirects disabled so authorization never follows a
// server redirect to a different origin. TLS uses the Android default trust store.
function assertUrl(url) {
  if (/^https:\/\/public\.miora\.qq\.com\/api\/ai\/workbuddy-proxy\/(image|video)\/(query-task|generate\/submit|submit)$/.test(url)) return;
  if (!/^https:\/\/(copilot\.tencent\.com|(?:www\.)?(?:workbuddy|codebuddy)\.cn)\//.test(url)) {
    throw new Error("已阻止非 WorkBuddy 官方 HTTPS 地址");
  }
}

async function request({url, method = "GET", headers = {}, body, onLine, timeout = 20000}) {
  assertUrl(url);
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(name) || typeof value !== "string" || !/^[\x20-\x7e]*$/.test(value) || value.length > 32768) {
      throw new Error("WorkBuddy 请求头格式无效，已阻止发送");
    }
  }
  let connection, reader;
  try {
    connection = new (J("java.net.URL"))(url).openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(timeout);
    connection.setInstanceFollowRedirects(false);
    connection.setRequestMethod(method);
    Object.entries(headers).forEach(([name, value]) => connection.setRequestProperty(name, value));
    if (body !== undefined) {
      connection.setDoOutput(true);
      const output = connection.getOutputStream();
      try { output.write(bytes(JSON.stringify(body))); } finally { output.close(); }
    }
    const status = connection.getResponseCode();
    const contentType = connection.getContentType() || "";
    const input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
    if (!input) return {status, text: "", contentType};
    reader = new (J("java.io.BufferedReader"))(new (J("java.io.InputStreamReader"))(input, "UTF-8"));
    const streaming = status >= 200 && status < 300 && !!onLine && /text\/event-stream/i.test(contentType);
    let text = "", line, size = 0;
    const deadline = Date.now() + 10 * 60 * 1000;
    while ((line = reader.readLine()) !== null) {
      if (Date.now() >= deadline || line.length > 2 * 1024 * 1024) throw new Error("response limit");
      // SSE is processed line-by-line and is never accumulated as a whole.
      if (streaming) onLine(line);
      else {
        size += line.length;
        if (size > 2 * 1024 * 1024) throw new Error("size");
        text += line + "\n";
      }
    }
    return {status, text, contentType, streaming};
  } catch (_) { throw new Error("WorkBuddy 网络请求失败、超时或响应过大；请检查网络后重试"); }
  finally { if (reader) reader.close(); if (connection) connection.disconnect(); }
}

function openBrowser(url) {
  assertUrl(url);
  const uri = J("android.net.Uri").parse(url);
  const intent = new (J("android.content.Intent"))("android.intent.action.VIEW", uri);
  intent.addFlags(268435456);
  Java.getApplicationContext().startActivity(intent);
}

function claims(token) {
  try {
    const raw = token.split(".")[1];
    return JSON.parse(utf8(J("android.util.Base64").decode(raw, 10)));
  } catch (_) { return {}; }
}

module.exports = {withStore, request, openBrowser, claims, delay, assertUrl};

// Access existing app media pool under the normal application UID.
function loadImage(id) {
  const data = J("com.ai.assistance.operit.util.ImagePoolManager").INSTANCE.getImage(id);
  return data ? {base64:String(data.getBase64()),mimeType:String(data.getMimeType())} : null;
}
module.exports.loadImage = loadImage;
async function saveGenerated(url,type) {
  // Only signed Tencent artifact locations; never attach auth to asset downloads.
  if(!/^https:\/\/(?:[A-Za-z0-9-]+\.)*(?:myqcloud\.com|miora\.qq\.com)\//.test(url))throw new Error("生成文件地址不是已核验的腾讯媒体域名，未下载");
  let conn,input,output,file;
  const max=type==="image"?32*1024*1024:128*1024*1024;
  try {
    conn=new (J("java.net.URL"))(url).openConnection();conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(60000);
    if(conn.getResponseCode()!==200)throw new Error("download status");
    const mime=String(conn.getContentType()||"").split(";")[0];
    if(!(type==="image"?/^image\/(png|jpeg|webp|gif)$/:/^video\/(mp4|webm)$/).test(mime))throw new Error("mime");
    if(conn.getContentLengthLong()>max)throw new Error("size");
    const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm"}[mime];
    const path="/sdcard/Download/Operit/WorkBuddyGenerated/"+J("java.util.UUID").randomUUID().toString()+"."+ext;
    file=new (J("java.io.File"))(path);file.getParentFile().mkdirs();
    input=conn.getInputStream();output=new (J("java.io.FileOutputStream"))(file);
    const channel=J("java.nio.channels.Channels").newChannel(input);
    const count=output.getChannel().transferFrom(channel,0,max+1);output.close();output=null;
    if(count<1||count>max)throw new Error("size");
    const pool=J(type==="image"?"com.ai.assistance.operit.util.ImagePoolManager":"com.ai.assistance.operit.util.MediaPoolManager").INSTANCE;
    const id=type==="image"?pool.addImage(path,null):pool.addMedia(path,mime);
    if(!id||id==="error")throw new Error("pool");
    return {path,mimeType:mime,markup:`<link type="${type}" id="${id}">WorkBuddy ${type}</link>`};
  } catch(_) {if(file)file.delete();throw new Error("生成媒体下载或导入失败，可按已有任务 ID 重试查询，无需重新生成");}
  finally {if(output)output.close();if(input)input.close();if(conn)conn.disconnect();}
}
module.exports.saveGenerated=saveGenerated;
