// SPDX-License-Identifier: MIT
"use strict";
// Only capabilities exposed by the authenticated WorkBuddy transport count.
function capabilities(model) {
  return {
    input: {text: true, image: model.supportsImages === true,
      audio: false, video: false},
    output: {text: true, image: false, audio: false, video: false},
    tools: model.supportsToolCall === true || model.supportsTools === true || model.supportsToolCalls === true,
    reasoning: model.reasoning !== false && model.supportsReasoning !== false,
    source: "WorkBuddy /v3/config; image=supportsImages; other media transports unverified"
  };
}
function describe(model) {
  const c = capabilities(model);
  return `输入：文字${c.input.image ? "、图片（目录声明，需实测）" : "；图片未声明支持"}；输出：文字；音频/视频输入未验证。媒体生成使用独立工具`;
}
module.exports = {capabilities, describe};
