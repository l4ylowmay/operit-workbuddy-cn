# 测试结果

日期：2026-10-24。交付版本：0.1.0 测试版。

**结论：已实现独立 ToolPkg 的源码和打包，模拟测试通过；尚未完成原版 Operit Android 端到端验收。不能将本结果解读为真机即装即用或所有模型已兼容。**

## 自动化验证

运行 `npm test`，**42 项通过，0 失败，0 跳过**。原始文本记录见 [test-run.txt](test-run.txt)。不需要联网、不使用真实凭据。

| 范围 | 验证内容 | 证据类型 |
| --- | --- | --- |
| 登录 | 创建会话、浏览器地址白名单、等待状态、令牌和账号提取、跨运行时继续轮询、取消后拒绝晚到结果、过期处理 | 模拟官方响应与本机存储 |
| 刷新 | 到期前刷新、refresh token 轮换先保存、并发只刷新一次、未轮换时保留、无 TTL 时使用新 JWT、刷新过期、401 不切换账号 | 模拟服务及串行存储锁契约；没有测试 Android 文件锁本身 |
| 多账号 | 切换清除默认模型、删除当前账号后明确无默认账号、清空本机状态 | 内存模拟存储 |
| 模型 | CLI 白名单、空配置明确失败、避免显示无权使用的模型 | 模拟配置 |
| 普通对话 | 模型及认证头、用户/企业上下文、完整多轮文本、实际返回的 usage | 模拟 HTTP 边界 |
| 流式 | native 行回调到中间结果、SSE 多行 data、空行/心跳、思考、工具参数分片、usage、终止标志与截断失败 | 模拟 HTTP / Java native 连接；不是 Android HTTPS |
| 工具调用 | 特殊工具名可逆别名、必填参数和类型、XML 转义、未知调用拒绝、完整后才输出 function call XML、返回结果进入下一轮 | 模拟 function call；工具名为测试 fixture，未执行系统工具 |
| 工具历史 | Operit 拆分回复合并、多调用/反序结果配对、中断历史补充明确的未完成结果、孤立结果失败 | 根据宿主源码构造的历史 fixture |
| 400 / 11128 | 客户端身份重写保留权限文本、不改用户内容、`max_tokens`、正确工具 schema、HTTP 和流中业务码安全诊断 | 模拟回归；不是对所有线上模型的保证 |
| 思考 | 开关、默认档位、服务声明的 effort 映射、不支持时拒绝、历史思考可选保留 | 模拟模型能力 |
| 积分 | 个人余额、企业额度/用量/无限制、缺字段拒绝、官方域名限制、企业 ID 查询 | 模拟账单响应 |
| 中文界面 | 账号状态、获取/选择模型、删除、积分按钮和状态不含令牌字段 | 模拟 Compose 工厂与服务 |
| Provider 注册 | 读取固定 Operit 源码，直接执行 `JsToolPkgRegistration.kt` 生成的真实注册 JS，检查四个导出 handler 和 Compose screen | 真实上游注册桥 + 模拟 NativeInterface；没有执行 Android 包管理器 |
| HTTPS 适配器 | 请求参数、禁止重定向、行读取、响应不累计整段 SSE、reader/connection 关闭、非法请求头预先拒绝 | 模拟 Java 对象；不证明真实 Java 反射/Android 网络已成功 |

如果重新执行时未提供 Operit 源码，SDK 注册桥检查会明确跳过。本次没有跳过该检查。

## 实网验证

执行 `python3 scripts/probe-official.py`，脱敏结果见 [live-probe.json](live-probe.json)。脚本没有读取账号凭据，没有打印 state 或完整授权 URL。

| 实际请求 | 观察结果 | 可以证明 / 不能证明 |
| --- | --- | --- |
| POST `/v2/plugin/auth/state?platform=CLI` | HTTP 200，code 0，包含 state，授权地址为 HTTPS `copilot.tencent.com/login` | 创建授权会话端点及当前客户端头可用；没有完成浏览器授权，未获得 Access/Refresh Token |
| GET `/v3/config`（匿名） | HTTP 200，code 0，models 为 null | 配置端点可达；**不能**证明登录后的模型发现成功 |

开发环境探测使用其标准网络通道；插件运行时是 Android 本机直连，两者不能等同。没有以开发环境网络成功替代 Android 真机网络验证。

## 未执行的真实项目

- 原版 Operit APK 内导入、启用和中文 Compose 界面显示。
- Android Keystore 生成密钥、加解密、AtomicFile 恢复、跨 JS 运行时文件锁、App 重启后恢复；这些只有源码与接口审查，尚无真实 Android 运行证据。
- 点击授权完成令牌登录、真实 Refresh Token 轮换、多真实账号切换。
- 认证后的动态模型列表、普通/流式/思考/多轮推理和实际积分扣费。
- Android 系统工具权限弹窗、工具执行、真实结果回传，以及工具使用后的下一轮请求。
- 真实个人/企业积分与官网对照、网络中断/后台回收/取消延迟。

没有连接的 Android/ADB 设备或可用模拟器，也没有已授权 WorkBuddy 账号。因此上述项目全部为待验收，不标为成功。后续请按照 [真机验收表](COMPATIBILITY.md) 逐项记录。

## 打包验证

`scripts/pack.py` 使用标准 ZIP，检查 CRC、manifest 入口及 API 版本，生成 `.toolpkg`、完整源码 ZIP 和 SHA-256 校验文件。运行代码只包含相对引用的本包 JS 模块，没有 Node 内置模块、外部服务进程或修改版 APK。

打包不等于 APK 导入测试。最终交付 `.toolpkg` 是符合已核对格式的候选安装包，原版应用实际导入仍待真机确认。
