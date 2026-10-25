// SPDX-License-Identifier: MIT
// Portions Copyright (c) 2026 Axiaohungry.
// Adapted from DSH WorkBuddy 1.3.25 (MIT); see ../THIRD_PARTY_NOTICES.md.
"use strict";
const {safeError} = require("./client.js");
const IDENTITY = /\bYou are an?(?:\s+AI)?(?:\s+coding)?\s+(?:agent\s+powered by|assistant\s+built on)[^\r\n]*?(?:\.(?=\s|$)|(?=\r?\n|$))/gi;
const CALL = /<(tool(?:_(?!result(?:_|\b))[A-Za-z0-9_]+)?)\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi;
const RESULT = /<(tool_result(?:_[A-Za-z0-9_]+)?)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const PARAM = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/g;
const xml = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const unxml = value => value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const rewrite = text => text.replace(IDENTITY, "You are CodeBuddy, an AI coding assistant.").replace(/\bDeepSeek Harness\b/gi, "CodeBuddy");
function sanitize(body) {
  // WorkBuddy checks channel identity only in system/developer messages.
  return {...body, messages: body.messages.map(m => ["system", "developer"].includes(m.role)
    ? {...m, role: "system", content: rewrite(m.content)} : m)};
}
function schema(params) {
  const properties = {}, required = [];
  for (const p of params) {
    if (typeof p.name !== "string" || !p.name) throw new Error("Operit 工具参数缺少名称");
    const type = p.type || "string";
    if (!["string", "number", "integer", "boolean", "object", "array"].includes(type)) throw new Error("工具参数类型不受支持");
    const field = {type, description: p.description};
    if (p.default !== undefined && p.default !== null) field.default = p.default;
    if (type === "array") field.items = {}; // Operit serializes no item schema.
    properties[p.name] = field;
    if (p.required) required.push(p.name);
  }
  return {type: "object", properties, required};
}
function toolMap(available) {
  const names = new Set();
  return available.map((tool, index) => {
    if (!tool.name || names.has(tool.name)) throw new Error("Operit 工具名称为空或重复");
    names.add(tool.name);
    // OpenAI function names forbid ':'. Keep a request-local reversible map.
    return {name: tool.name, alias: `operit_${index}`, parameters: tool.parametersStructured || [], description: tool.description};
  });
}
function coerce(value, type) {
  if (type === "integer" || type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number) || (type === "integer" && !Number.isInteger(number))) throw new Error("历史工具数值参数无效");
    return number;
  }
  if (type === "boolean") {
    if (value !== "true" && value !== "false") throw new Error("历史工具布尔参数无效");
    return value === "true";
  }
  if (type === "object" || type === "array") {
    let parsed;
    try { parsed = JSON.parse(value); } catch (_) { throw new Error("历史工具 JSON 参数无效"); }
    return parsed;
  }
  return value;
}
function historyMessages(history, tools, preserveThinking) {
  const messages = [];
  // ConversationService deliberately splits text/thoughts/each tool invocation
  // into adjacent ASSISTANT and TOOL_CALL turns. They form ONE assistant message.
  const compiled = [];
  for (const turn of history) {
    const assistant = ["ASSISTANT", "TOOL_CALL"].includes(turn.kind);
    const previous = compiled[compiled.length - 1];
    if (assistant && previous?.kind === "ASSISTANT") previous.content += "\n" + turn.content;
    else compiled.push({...turn, kind: assistant ? "ASSISTANT" : turn.kind});
  }
  let queue = [], nextId = 0;
  const resolve = (name, content) => {
    const index = name ? queue.findIndex(c => c.name === name) : (queue.length === 1 ? 0 : -1);
    // 上下文裁剪、工具停用或中断都会留下无法配对的工具结果。宿主对这类
    // “未匹配的 tool_result”只记录告警并继续，插件同样丢弃它而不是中断整轮对话。
    if (index < 0) return;
    const [call] = queue.splice(index, 1);
    messages.push({role: "tool", tool_call_id: call.id, content});
  };
  const interrupted = () => {
    for (const call of queue) messages.push({role: "tool", tool_call_id: call.id,
      content: "工具执行已中断或结果未保留，请根据当前请求判断是否需要重新调用。"});
    queue = [];
  };
  for (const turn of compiled) {
    if (typeof turn.content !== "string") throw new Error("Operit 历史内容不是文本");
    const results = turn.kind === "TOOL_RESULT" ? Array.from(turn.content.matchAll(RESULT)) : [];
    if (results.length) {
      for (const match of results) {
        const name = /\bname="([^"]+)"/.exec(match[2])?.[1] || turn.toolName;
        const content = /<content>([\s\S]*?)<\/content>/.exec(match[3])?.[1] ?? match[3];
        resolve(name, unxml(content.trim()));
      }
      const remaining = turn.content.replace(RESULT, "").trim();
      if (remaining) { interrupted(); messages.push({role: "user", content: remaining}); }
      continue;
    }
    if (turn.kind === "TOOL_RESULT") { resolve(turn.toolName, turn.content); continue; }
    // Operit may keep ordinary ASSISTANT and TOOL_CALL as adjacent turns.
    if (queue.length) interrupted();
    let content = turn.content;
    const thoughts = turn.kind === "ASSISTANT" ? Array.from(content.matchAll(/<think>([\s\S]*?)<\/think>/g)).map(m => m[1]).join("\n") : "";
    if (turn.kind === "ASSISTANT") content = content.replace(/<think>[\s\S]*?<\/think>/g, "");
    const calls = Array.from(content.matchAll(CALL));
    if (calls.length && ["ASSISTANT", "TOOL_CALL"].includes(turn.kind)) {
      const usable = [], keep = [];
      let cursor = 0;
      for (const match of calls) {
        keep.push(content.slice(cursor, match.index));
        const tool = tools.find(t => t.name === unxml(match[2]));
        if (tool) usable.push({match, tool});
        else {
          // 工具已停用/不在本次可用列表：保留原始调用文本，后续未配对结果会被安全丢弃。
          keep.push(match[0]);
        }
        cursor = match.index + match[0].length;
      }
      keep.push(content.slice(cursor));
      const leftover = keep.join("").trim();
      const tool_calls = usable.map(({match, tool}) => {
        const args = {};
        for (const param of match[3].matchAll(PARAM)) {
          const name = unxml(param[1]);
          const declared = tool.parameters.find(p => p.name === name);
          if (!declared) throw new Error("历史包含未声明的工具参数");
          args[name] = coerce(unxml(param[2].trim()), declared.type);
        }
        const id = `call_operit_${nextId++}`;
        queue.push({id, name: tool.name});
        return {id, type: "function", function: {name: tool.alias, arguments: JSON.stringify(args)}};
      });
      messages.push({role: "assistant", content: leftover || null,
        ...(tool_calls.length ? {tool_calls} : {}),
        ...(preserveThinking && thoughts ? {reasoning_content: thoughts} : {})});
    } else {
      const roles = {SYSTEM: "system", USER: "user", ASSISTANT: "assistant", TOOL_CALL: "assistant", SUMMARY: "user"};
      const role = roles[turn.kind];
      if (!role) throw new Error("不支持的 Operit 历史消息类型");
      messages.push({role, content, ...(role === "assistant" && preserveThinking && thoughts ? {reasoning_content: thoughts} : {})});
    }
  }
  interrupted();
  return messages;
}
function buildRequest(payload, model, defaultModel) {
  const tools = toolMap(payload.config.enableToolCall ? (payload.availableTools || []) : []);
  const modelName = payload.config.modelName || defaultModel;
  if (!modelName) throw new Error("请先选择模型");
  if (model.id !== modelName) throw new Error("所选模型不可用，请刷新模型列表");
  // WorkBuddy 只接受 stream:true：非流式请求会被服务端以 HTTP 400 / 业务码 11101 拒绝。
  // 宿主侧的“非流式”由 provider.js 抑制中间 chunk 实现，所以传输层固定使用 SSE。
  const body = {model: modelName, messages: historyMessages(payload.chatHistory || [], tools, !!payload.preserveThinkInHistory), stream: true};
  if (tools.length) {
    body.tools = tools.map(t => ({type: "function", function: {name: t.alias, description: t.description, parameters: schema(t.parameters)}}));
    body.tool_choice = "auto";
  }
  // Explicit allowlist prevents config from changing destinations/authentication,
  // adding unsupported developer/store fields, or overwriting tool schemas.
  for (const p of payload.modelParameters || []) {
    if (!p.enabled) continue;
    if (["temperature", "top_p", "presence_penalty", "frequency_penalty"].includes(p.name)) {
      if (!Number.isFinite(p.value)) throw new Error("模型采样参数必须为数字");
      body[p.name] = p.value;
    }
    if (["max_tokens", "max_completion_tokens"].includes(p.name)) {
      if (!Number.isInteger(p.value) || p.value < 1) throw new Error("max_tokens 必须为正整数");
      body.max_tokens = p.value;
    }
  }
  if (body.max_tokens && model.maxOutputTokens) body.max_tokens = Math.min(body.max_tokens, model.maxOutputTokens);
  const effortParameter = (payload.modelParameters || []).find(p => p.enabled && p.name === "reasoning_effort");
  if (payload.enableThinking) {
    const effort = effortParameter ? effortParameter.value : (model.reasoning?.effort || model.defaultReasoningEffort || "medium");
    if (!["minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("不支持的思考强度");
    if (model.reasoning === false || model.supportsReasoning === false) throw new Error("该模型不支持思考参数，请关闭思考开关");
    const mapped = model.thinkingLevelMap ? model.thinkingLevelMap[effort] : effort;
    if (!["minimal", "low", "medium", "high", "xhigh", "max"].includes(mapped)) throw new Error("该模型不支持所选思考强度");
    body.reasoning_effort = mapped;
  }
  // WorkBuddy/DSH represents off by omitting reasoning_effort; model may be onlyReasoning.
  return {body: sanitize(body), tools};
}
function usage(raw) {
  return {input: raw.prompt_tokens ?? 0, cachedInput: raw.prompt_tokens_details?.cached_tokens ?? raw.cached_tokens ?? 0,
    output: raw.completion_tokens ?? 0};
}
function toolXml(calls, tools, tag) {
  return calls.map(call => {
    const tool = tools.find(t => t.alias === call.function?.name);
    if (!tool) throw new Error("模型返回了未授权的工具名称，已拒绝执行");
    let args;
    try { args = JSON.parse(call.function.arguments || "{}"); } catch (_) { throw new Error("模型返回了不完整的工具参数，已拒绝执行"); }
    if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("工具参数不是 JSON 对象");
    for (const key of Object.keys(args)) {
      const p = tool.parameters.find(p => p.name === key);
      if (!p) throw new Error("模型返回了未声明的工具参数");
      const value = args[key], type = p.type || "string";
      const valid = type === "array" ? Array.isArray(value)
        : type === "object" ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isInteger(value)
        : type === "number" ? typeof value === "number" && Number.isFinite(value)
        : typeof value === type;
      if (!valid) throw new Error("模型返回的工具参数类型不符合声明");
    }
    for (const p of tool.parameters) if (p.required && !(p.name in args)) throw new Error("模型遗漏了必填工具参数");
    return `\n<${tag} name="${xml(tool.name)}">` + Object.entries(args).map(([key, value]) =>
      `\n<param name="${xml(key)}">${xml(typeof value === "string" ? value : JSON.stringify(value))}</param>`).join("") + `\n</${tag}>\n`;
  }).join("");
}
function createCompletion(tools, emit, tag) {
  let text = "", thinking = false, done = false, finished = false, error = null, currentUsage;
  const calls = new Map();
  const push = chunk => { if (chunk) {text += chunk; emit({chunk});} };
  const closeThinking = () => {if (thinking) {push("</think>"); thinking = false;}};
  function consume(payload, streaming = true) {
    if (payload.error || (payload.code !== undefined && payload.code !== 0)) {error = safeError(200, payload); return;}
    if (payload.usage) currentUsage = usage(payload.usage);
    const choice = payload.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) {
      if (!["stop", "tool_calls"].includes(choice.finish_reason)) error = new Error("模型输出被截断或过滤，工具调用未执行");
      finished = true;
    }
    const delta = streaming ? choice.delta : choice.message;
    if (!delta) return;
    if (delta.reasoning_content) {
      if (!thinking) {push("<think>"); thinking = true;}
      push(delta.reasoning_content);
    }
    if (delta.content) {closeThinking(); push(delta.content);}
    (delta.tool_calls || []).forEach((part, position) => {
      const index = streaming ? part.index : position;
      if (!Number.isInteger(index) || index < 0 || index >= 128) {error = new Error("工具调用序号无效"); return;}
      const call = calls.get(index) || {id: "", function: {name: "", arguments: ""}};
      if (part.id) call.id += part.id;
      if (part.function?.name) call.function.name += part.function.name;
      if (part.function?.arguments) call.function.arguments += part.function.arguments;
      if (call.function.arguments.length > 1024 * 1024) {error = new Error("工具参数过大"); return;}
      calls.set(index, call);
    });
  }
  let dataLines = [], eventSize = 0;
  function dispatch() {
    if (!dataLines.length) return;
    const data = dataLines.join("\n"); dataLines = []; eventSize = 0;
    if (data.trim() === "[DONE]") {done = true; return;}
    if (done) {error = new Error("流结束后出现额外数据"); return;}
    try { consume(JSON.parse(data)); } catch (_) { error = new Error("WorkBuddy 流数据格式无效"); }
  }
  return {
    consume,
    line(line) {
      if (error) return;
      if (line === "") {dispatch(); return;}
      if (line.startsWith("data:")) {
        const value = line.slice(5).replace(/^ /, ""); eventSize += value.length;
        if (eventSize > 1024 * 1024) {error = new Error("WorkBuddy 流事件过大"); return;}
        dataLines.push(value);
      }
    },
    finish(streaming) {
      dispatch();
      if (error) throw error;
      if (!finished || (streaming && !done)) throw new Error("WorkBuddy 响应提前中断，工具调用未执行");
      closeThinking();
      // Emit no executable tool markup until ALL arguments have parsed, the HTTP
      // stream completed and finish_reason/[DONE] confirmed a complete response.
      const markup = toolXml(Array.from(calls.entries()).sort((a,b) => a[0]-b[0]).map(e => e[1]), tools, tag);
      push(markup);
      return {text, ...(currentUsage ? {usage: currentUsage} : {})};
    }
  };
}
module.exports = {buildRequest, createCompletion, historyMessages, toolMap, toolXml, sanitize, xml, unxml, schema};
