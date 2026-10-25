// SPDX-License-Identifier: MIT
"use strict";
const {provider} = require("./runtime.js");
const screen = require("./settings.ui.js");

// Export actual named handlers: Operit's durable function registry requires
// exported references; factory-local closures cannot be registered directly.
function listModels(event) { return provider.listModels(event); }
function sendMessage(event) { return provider.sendMessage(event); }
function testConnection(event) { return provider.testConnection(event); }
function calculateInputTokens(event) { return provider.calculateInputTokens(event); }
function registerToolPkg() {
  ToolPkg.registerAiProvider({
    id: "workbuddy_cn", displayName: "WorkBuddy 中国区",
    description: "WorkBuddy 中国站浏览器令牌登录（Android 本机，测试版）",
    listModels: {function: listModels}, sendMessage: {function: sendMessage},
    testConnection: {function: testConnection}, calculateInputTokens: {function: calculateInputTokens}
  });
  ToolPkg.registerToolboxUiModule({id: "workbuddy_settings", runtime: "compose_dsl", screen,
    title: {zh: "WorkBuddy 中国区设置"}});
  return true;
}
module.exports = {registerToolPkg, listModels, sendMessage, testConnection, calculateInputTokens};
