# 接口与实现依据

- Operit 源码固定提交 `dbf71916fae9750cfdc9f9a774f5a0fee56633fb`，`ToolPkgJsAiProviderService.kt` 序列化历史的 `content`、配置直处理开关及可用工具；MediaLinkParser 使用 `<link type="image|audio|video" id="...">` 指向媒体池。
- `ImagePoolManager.INSTANCE.getImage` / `addImage` 获取或注册图片；`MediaPoolManager.INSTANCE.addMedia` 注册生成视频。通过应用现有 Java 桥调用，不需要新增系统权限。
- WorkBuddy `/v3/config` 的 CLI 模型白名单决定账号可用模型；图片依据 `supportsImages`，工具依据 `supportsToolCall`，不根据型号名称猜测。
- `https://copilot.tencent.com/v2/chat/completions` 固定 SSE，身份头兼容 DSH WorkBuddy 1.3.25。宿主非流式调用在本机汇总，未发送 `stream:false`。
- 本机 `/Applications/WorkBuddy.app/Contents/Resources/app.asar` 的 `main/server.js` 和官方附带 `miora-mcp/dist/cli.cjs` 明确使用 `/v2/api-keys` 创建 `temporary:true,expire_in_seconds:900` 的短期 Client Key；媒体服务为 `https://public.miora.qq.com/api/ai/workbuddy-proxy`。
- 图片提交：`/image/generate/submit`；视频提交：`/video/submit`；查询：`/{image|video}/query-task`，请求 `{upstreamTaskIds:[id]}`。先处理业务 `failed`，再区分同步与异步；不能将 HTTP 200 或接口可达标为成功。
- 生成文件下载仅接受腾讯 `*.myqcloud.com` / `*.miora.qq.com` HTTPS 地址，不附带认证头，不跟随重定向。图片限制 32 MiB，视频 128 MiB。
- 模型图片请求限制单图 Base64 14 MiB、单消息累计 28 MiB，支持 PNG/JPEG/WebP/GIF；原始图片由宿主媒体池解析与规范化。未声明的音频/视频输入明确报错。

公开参考：
- https://github.com/AAswordman/Operit/tree/dbf71916fae9750cfdc9f9a774f5a0fee56633fb
- https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Model
- https://github.com/Axiaohungry/dsh-llm-workbuddy

模型能力状态与服务生成能力分开记录：聊天模型输出仍为文字；图片生成已实测；视频服务已接通但上游拒绝提交；音频服务未知、未启用。
