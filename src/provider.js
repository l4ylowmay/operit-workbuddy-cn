// SPDX-License-Identifier: MIT
"use strict";
const {CLIENT_HEADERS, enterpriseHeaders, parseResponse} = require("./client.js");
const {adapt} = require("./media.js");
const {describe, capabilities} = require("./capabilities.js");
const {buildRequest, createCompletion} = require("./protocol.js");
function createProvider(platform, client, emit, makeTag) {
  async function listModels() {
    return {models: (await client.models()).map(m => ({id: m.id, name: (m.name || m.id) + (capabilities(m).input.image ? " · 图片" : " · 文字")}))};
  }
  async function sendMessage(event) {
    const payload = event.eventPayload;
    const entry = await client.session();
    const models = await client.modelsForSession(entry);
    const state = await client.status();
    const id = payload.config.modelName || state.model;
    const model = models.find(m => m.id === id);
    if (!model) throw new Error("请从 WorkBuddy 动态模型列表选择可用模型");
    const {body, tools} = buildRequest(payload, model, state.model);
    // 服务端强制 SSE：即使宿主关闭流式输出，也走同一条流，只是不把中间 chunk 交给宿主，
    // 由末尾返回的完整 text 一次性交给宿主（宿主没有中间 chunk 时会自动使用最终结果）。
    body.messages = adapt(body.messages, model, platform.loadImage);
    const streamToHost = !!payload.stream;
    const completion = createCompletion(tools, streamToHost ? emit : () => {}, makeTag());
    const response = await platform.request({url: "https://copilot.tencent.com/v2/chat/completions", method: "POST", body,
      headers: {...CLIENT_HEADERS, ...enterpriseHeaders(entry), "X-User-Id": entry.account.userId, authorization: `Bearer ${entry.auth.accessToken}`,
        accept: "text/event-stream"},
      timeout: 60000, onLine: line => completion.line(line)});
    if (!response.streaming) {
      // 非 SSE 响应只可能是错误体（例如 HTTP 400 / 业务码 11101）：先解析出业务码再抛出。
      parseResponse(response, false);
      throw new Error("WorkBuddy 未返回流式响应，请稍后重试");
    }
    return completion.finish(true);
  }
  async function testConnection(event) {
    const result = await listModels();
    return {success: true, message: `令牌与模型发现成功，共 ${result.models.length} 个模型；尚未发送付费对话请求`};
  }
  function calculateInputTokens(event) {
    // Conservative estimate only; final accounting always uses server usage.
    const p = event.eventPayload;
    const size = JSON.stringify([p.chatHistory || [], p.availableTools || []]).length;
    return {tokens: Math.max(1, Math.ceil(size))};
  }
  return {listModels, sendMessage, testConnection, calculateInputTokens};
}
module.exports = {createProvider};
