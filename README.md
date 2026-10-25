# Operit WorkBuddy 中国区 0.2.1

维护者：[l4ylowmay](https://github.com/l4ylowmay) · [项目源码](https://github.com/l4ylowmay/operit-workbuddy-cn) · [下载发布版本](https://github.com/l4ylowmay/operit-workbuddy-cn/releases) · [问题反馈](https://github.com/l4ylowmay/operit-workbuddy-cn/issues)

采用 **[MIT License](LICENSE)** 的第三方社区插件。认证与聊天协议适配源于 **[Axiaohungry/dsh-llm-workbuddy](https://github.com/Axiaohungry/dsh-llm-workbuddy)**；宿主接口参考 **[AAswordman/Operit](https://github.com/AAswordman/Operit)**。完整出处、修改范围与第三方许可见 **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**。本项目不是上述项目或腾讯 WorkBuddy 的官方插件。

适用于原版 Operit 1.12.2，Provider ID 保持 `workbuddy_cn`，不修改 APK，不需要 Root、解锁或刷写分区。

0.2.1 进一步修复 Android 发行 APK 生成的无引号媒体标签（如 `<link type=image id=…>`）未被识别的问题，兼容带引号、无引号和转义引号。

修复 0.1.1 在任一直接媒体处理开关开启时连纯文字也拒绝发送的问题。现在检查实际附件，再按认证模型目录的 `supportsImages` 转换为 OpenAI `image_url` 内容块。支持媒体池中的用户图片、图片历史和工具返回图片。文字、思考、原生工具调用、SSE 及非流式汇总保持可用。

## 推荐配置

- 在插件设置中登录自己的 WorkBuddy 中国站账号并获取模型列表；本项目不提供共享账号或凭据。
- 在 Operit 模型配置中选择 `WorkBuddy 中国区`，从账号实际可用目录选择模型，并绑定到对话 CHAT。已验证的参考模型为 `step-5-preview`。
- 图片直处理开启，音频及视频直处理关闭，原生 ToolCall 开启。
- API Key、端点、自定义请求头留空；总结和标题功能可以继续使用其他配置。
- 设置页会将既有配置备份到应用私有 `files/codex_wb_backup_020`；该备份不属于开源发布内容，不应上传到仓库。

## 图片与视频生成

图片生成是 WorkBuddy 官方客户端附带的独立媒体服务，不能把它当作每个聊天模型的原生输出模态。仅使用当前 WorkBuddy 账号临时创建的 900 秒凭据，Access Token 只发往 `copilot.tencent.com`；临时凭据仅发往 WorkBuddy 官方集成的 `public.miora.qq.com` 媒体接口。没有接入其他供应商账号。

工具包子包 `workbuddy_media` 提供：

- `generate_image(prompt)`：同步完成时直接返回 `files` 中的图片附件；异步返回 taskId，随后查询。
- `generate_video(prompt, duration?)`：5 或 10 秒；当前真机提交返回上游 `UPSTREAM_SUBMIT_FAILED / 502`，未通过生成验收。不要连续重试。
- `query_task(type, taskId)`：查询原异步任务，不重新提交。同一执行上下文复用临时凭据。

也可在“工具箱 → WorkBuddy 中国区设置”输入描述生成图片/视频。生成会消耗 WorkBuddy 积分。完成文件保存于手机 `Download/Operit/WorkBuddyGenerated`，并注册到 Operit 媒体池；同步任务的结果在提交响应中，不可通过上游异步查询接口取回。

音频/视频直接输入未找到当前聊天接口的能力声明及有效协议，保持关闭；不把本地转写/抽帧冒充原生支持。音频生成同样未启用。具体实测边界见 [验收记录](docs/VALIDATION.md)。

## 安装与回退

将 `.toolpkg` 导入 Operit 包管理并启用；需要生成工具时，展开插件详情并单独启用 `WorkBuddy 媒体生成` 子包。在模型配置中选择 WorkBuddy 中国区和账号目录中的模型，再绑定到 CHAT。升级时保留既有账号，除非其凭据已失效。

回退时停用新版、恢复旧 `.toolpkg.bak` 为 `.toolpkg` 并重启应用；0.1.1 需要关闭所有直接媒体处理开关才能发出文字请求。新旧版本不同时扫描，避免重复 Provider。

## 构建与测试

Node 20+、Python 3.10+，无第三方依赖：

```sh
npm test
npm run build
```

构建输出 `dist/*.toolpkg`、源码 ZIP 与 SHA256 校验值。真机诊断按钮会使用当前账号发送合成测试文本/图片并消耗少量积分，只在需要验证时点击。诊断不导出账号密钥。

## 许可与出处

本插件采用 [MIT](LICENSE)，允许按许可使用、修改及分发，包括商业用途；分发时须保留适用的版权声明和许可文本。

感谢 Axiaohungry 的 DSH WorkBuddy MIT 项目提供认证与聊天协议适配基础，以及 Operit 社区提供的扩展接口。DSH 原始许可完整保留于 [licenses/DSH-MIT.txt](licenses/DSH-MIT.txt)。腾讯产品及服务不属于本项目的 MIT 授权范围。

详见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 [接口依据](docs/INTERFACES.md)。发布源码只应包含插件代码、构建脚本、合成测试和项目文档，不应包含私人日志、真实照片、凭据或宿主/腾讯客户端文件。
