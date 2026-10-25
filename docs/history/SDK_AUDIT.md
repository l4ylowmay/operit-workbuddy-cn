# 上游及实际接口审查

核对日期：2026-10-24。通过 GitHub API 再次检查 main SHA，与本地浅克隆 HEAD 一致。

| 项目 | 固定提交 / 版本 | 许可证 |
| --- | --- | --- |
| [DSH WorkBuddy](https://github.com/Axiaohungry/dsh-llm-workbuddy/tree/8f72e885b21ff39868d0c7d0eaf68aa277ca154c) | `8f72e885b21ff39868d0c7d0eaf68aa277ca154c` / package 1.3.25 | [MIT](https://github.com/Axiaohungry/dsh-llm-workbuddy/blob/8f72e885b21ff39868d0c7d0eaf68aa277ca154c/LICENSE)，随包保留 |
| [Operit](https://github.com/AAswordman/Operit/tree/dbf71916fae9750cfdc9f9a774f5a0fee56633fb) | `dbf71916fae9750cfdc9f9a774f5a0fee56633fb` / 源码 versionName 1.12.2 | [LGPL-3.0](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/LICENSE) |

GitHub 最新正式发布也是 [Operit v1.12.2](https://github.com/AAswordman/Operit/releases/tag/v1.12.2)。未下载、修改、编译或测试其 404 MB 发行 APK，不能以源码审查代替 APK 验收。

## Operit 扩展能力

| 能力 | 核对的真实源码 | 本插件使用方式与边界 |
| --- | --- | --- |
| `.toolpkg` 包结构 | [格式文档](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/docs/TOOLPKG_FORMAT_GUIDE.md)、`examples/custom_ai_provider/manifest.json` | 标准 ZIP，manifest 指向 `src/main.js`，无子包、无 Node 运行依赖 |
| Provider 注册 | [toolpkg.d.ts](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/examples/types/toolpkg.d.ts)、`JsToolPkgRegistration.kt` | `registerAiProvider` 的四个 handler 全部为 main 导出的函数，避免注册不可恢复的闭包；真实注册桥在 Node VM 中执行验证 |
| 流式回调 | [ToolPkgJsAiProviderService.kt](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/app/src/main/java/com/ai/assistance/operit/api/chat/llmprovider/ToolPkgJsAiProviderService.kt) | 输入 `event.eventPayload`；`sendIntermediateResult({chunk})` 输出增量；最终 `{text, usage:{input,cachedInput,output}}`，宿主避免重复输出 |
| 通用 HTTP SDK | `examples/types/okhttp.d.ts`、`assets/js/OkHttp3.js`、`StandardHttpTools.kt` | 确实存在 `streamExecute` / `onIntermediateResult`，但 wrapper 通过工具分发器发送 `http_request`。凭据请求不走此路径，避免进入通用工具记录 |
| Android Java 桥 | [java-bridge.d.ts](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/examples/types/java-bridge.d.ts)、`JsJavaBridge.kt`、`JsJavaBridgeDelegates.kt` | 已确认 `Java.type`、`getApplicationContext`、构造器/实例方法、数组及 byte[] 转换能力；本插件使用这些实际接口 |
| 本机 HTTPS | Android `URL` / `HttpsURLConnection` / `BufferedReader` | 固定官方域名、默认 TLS、禁用重定向，逐行解析 SSE；没有臆造网络 SDK。具体桥接重载仍待 Android 真机执行 |
| 受保护存储 | Android `KeyStore` / `KeyGenParameterSpec` / `Cipher` / `AtomicFile` / `Context.getNoBackupFilesDir` | SDK 无专用插件密钥库 API，利用官方 Java 桥访问真实 Android API；未声称存在 `ToolPkg.secureStorage` 等接口 |
| 浏览器 | Android `Intent.ACTION_VIEW`、`Uri.parse`、应用 Context `startActivity` | 使用 DSH 的服务器轮询方式，无本地 HTTP 服务、没有伪造 OAuth 回调 API |
| 中文 UI | [compose-dsl.d.ts](https://github.com/AAswordman/Operit/blob/dbf71916fae9750cfdc9f9a774f5a0fee56633fb/examples/types/compose-dsl.d.ts)、`examples/message_insert` | 使用 `useState/useRef`、`LazyColumn/Card/Column/Text/Button/Checkbox` 和 `onLoad`；注册真实 `compose_dsl` 界面 |
| 系统工具桥 | `OpenAIProvider.kt`、`StructuredToolCallBridge.kt`、`ChatMarkupRegex.kt`、`ConversationService.kt` | tools JSON Schema → 模型 function calls → 随机后缀 `<tool_...>` XML；工具执行与权限仍由 Operit 完成。历史保留类型、合并分段回复并配对工具结果 |

插件运行代码仅依赖官方 JS 接口和 Android/Java 公开类，不依赖 Operit 内部类名，避免发行 APK 混淆导致失效。

## WorkBuddy 协议依据

以下均来自固定 DSH 提交，不增加猜测的端点。

| 功能 | 方法和路径 | 源码依据 |
| --- | --- | --- |
| 创建授权会话 | POST `https://copilot.tencent.com/v2/plugin/auth/state?platform=CLI`，空 JSON body | `workbuddy-auth.js:338` |
| 获取令牌 | GET `/v2/plugin/auth/token?state=...` | 同文件 loginWorkBuddy |
| 获取账号 | GET `/v2/plugin/login/account?state=...`，Bearer | 同上 |
| 刷新 | POST `/v2/plugin/auth/token/refresh`，`X-Refresh-Token`、`X-Auth-Refresh-Source: plugin` | `workbuddy-auth.js:370` |
| 模型发现 | GET `https://copilot.tencent.com/v3/config`，按 CLI agent 白名单关联 models | `index.js:277-334` |
| 推理 | POST `https://copilot.tencent.com/v2/chat/completions` | `index.js` BASE_URL、上游渠道分析文档 |
| 个人积分 | POST 官方 billing host `/v2/billing/meter/get-user-resource` | `workbuddy-credits.js:275` |
| 企业积分 | POST `/v2/billing/meter/get-enterprise-user-usage`；必要时 GET `/console/accounts` | `workbuddy-credits.js:298-321` |

适配保留 `CLI/2.171.0 CodeBuddy/2.171.0`、`X-Product: SaaS`、IDE 头以及用户/企业/domain 请求上下文；不产生其他 SDK 的 `x-stainless-*` 头。登录是令牌路径，不叠加 API Key 的 `x-api-key`。

## 400 / 11128 对齐范围

DSH `index.js` 的 `sanitizeWorkBuddyRequest` 和 `normalizeWorkBuddyError`、`docs/2026-10-21-codebuddy-channel-analysis.md` 明确指出：仅更换请求头不足以修复当时的身份说明校验问题，且不能将所有 11128 归为同一原因。

移植的系统身份重写规则、保留权限和业务文本、兼容错误格式均有模拟回归测试。工具请求使用 `max_tokens`、有效 JSON Schema、可逆函数名别名、完整工具历史；未配对的历史中断有明确的中断结果，不会伪装成成功执行。无 DSH/pi-ai 的 envelope 进入 Operit 请求。

这些措施验证了构造逻辑，不等同于已通过 WorkBuddy 对所有真实账号、模型和系统指令的在线校验。

## 不修改 APK 的结论

所需的注册、Java、UI 和中间结果能力均可从当前官方源码找到，因此本版只交付独立 ToolPkg。没有必要因尚未开展真机测试就修改 APK；如后续证据证明具体发行 APK 缺少或限制某项能力，再根据实际错误定位最小修改。
