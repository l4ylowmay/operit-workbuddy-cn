# 出处、致谢与第三方许可

本项目是独立的 Operit 社区插件，采用 [MIT License](LICENSE)。它不是 Operit、腾讯 WorkBuddy、CodeBuddy 或下列上游作者的官方插件，不表示获得其认可或背书。

## 1. DSH WorkBuddy：协议适配的上游来源

- 项目：[Axiaohungry/dsh-llm-workbuddy](https://github.com/Axiaohungry/dsh-llm-workbuddy)
- 原作者：Axiaohungry
- 参考版本：`@axiaohungry/dsh-llm-workbuddy@1.3.25`
- 固定版本来源：[npm 1.3.25](https://www.npmjs.com/package/@axiaohungry/dsh-llm-workbuddy/v/1.3.25)
- 许可证：MIT；原始版权与完整许可文本保留于 [licenses/DSH-MIT.txt](licenses/DSH-MIT.txt)。

本项目的认证与账号处理、模型发现、客户端请求标识、聊天协议兼容处理及积分接口适配，参考并改编了上述项目。相关部分主要位于 `src/client.js`、`src/protocol.js`、`src/credits.js`。

本项目在其基础上实现了 Operit ToolPkg Provider、Android 本机凭据存储、设置界面、宿主工具与媒体池适配，并修复了非流式传输、实际 APK 的无引号媒体标签及过期图片历史问题。上述 Android 适配和后续修改不应归责于原作者。

分发本项目或相关代码时，须继续保留适用的上游版权声明和 MIT 许可文本；选择 MIT 不会消除第三方已有权利。

## 2. Operit：宿主与扩展接口参考

- 项目：[AAswordman/Operit](https://github.com/AAswordman/Operit)
- 接口参考提交：[`dbf71916fae9750cfdc9f9a774f5a0fee56633fb`](https://github.com/AAswordman/Operit/tree/dbf71916fae9750cfdc9f9a774f5a0fee56633fb)
- 宿主主体许可证：[LGPL-3.0-only](https://github.com/AAswordman/Operit/blob/main/LICENSE)；各工具、示例或依赖以其自身许可为准。

插件通过宿主现有 ToolPkg / Java bridge 调用 AI Provider 注册、Compose DSL 和图片/媒体池接口。本发布包不包含 Operit APK、宿主 Kotlin 实现、DEX 或第三方 JAR；不将宿主许可证重新声明为 MIT。实际兼容性以本项目的验收记录为准。

## 3. 腾讯 WorkBuddy / CodeBuddy：服务与媒体协议参考

- 产品：[WorkBuddy](https://www.codebuddy.cn/workbuddy)
- 参考文档：[官方模型说明](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model)
- 生成接口参考：WorkBuddy 官方客户端附带的 `main/server.js`、`miora-mcp/dist/cli.cjs` 中的临时凭据和媒体任务协议。

此项说明的是服务和接口参考来源，不代表腾讯客户端代码被授予 MIT。本发布包不包含腾讯客户端、Miora MCP 实现、其静态资源或用户的服务凭据。

WorkBuddy、CodeBuddy 等名称及商标属于其相应权利人。本项目的 MIT 授权仅涉及有权授权的插件代码，不授予相关商标、账号、模型、额度、API 或云服务的使用权；调用服务仍须遵守相应服务条款。

## 4. 项目署名

本项目由 [l4ylowmay](https://github.com/l4ylowmay) 维护，项目代码署名为 `l4ylowmay and WorkBuddy Operit contributors`；上游部分保留 `Copyright (c) 2026 Axiaohungry`。维护者署名不取代上游版权。

项目源码与发布版本：[https://github.com/l4ylowmay/operit-workbuddy-cn](https://github.com/l4ylowmay/operit-workbuddy-cn)。请通过该地址核对本项目的维护来源；其他分发版本的责任由其维护者承担。
