// SPDX-License-Identifier: MIT
"use strict";
// Native Compose DSL only. The UI receives account labels, never auth tokens.
function createScreen(service) {
  return function Screen(ctx) {
    const [status, setStatus] = ctx.useState("status", {accounts: [], pending: false, model: ""});
    const [message, setMessage] = ctx.useState("message", "点击登录，在浏览器中完成 WorkBuddy 中国站授权。");
    const [models, setModels] = ctx.useState("models", []);
    const [prompt, setPrompt] = ctx.useState("mediaPrompt", "A solid red circle on a white background, flat simple icon");
    const [credits, setCredits] = ctx.useState("credits", "");
    const [busy, setBusy] = ctx.useState("busy", false);
    const [confirmErase, setConfirmErase] = ctx.useState("confirmErase", false);
    const waiting = ctx.useRef("waiting", false);
    const active = ctx.useRef("actionActive", false);
    const loaded = ctx.useRef("loaded", false);
    const UI = ctx.UI;
    const text = (value, style = "bodyMedium") => UI.Text({text: value, style});
    const refresh = async () => {const value = await service.status(); setStatus(value); return value;};
    const errorMessage = error => {
      // Service errors are deliberately sanitized. Do not report native errors
      // through ctx.reportError/console, which could persist sensitive content.
      setMessage(error instanceof Error ? error.message : "操作失败，请重试");
    };
    async function waitForLogin() {
      if (waiting.current) return;
      waiting.current = true;
      try {
        setMessage("正在等待浏览器授权；完成后请返回此界面。授权会话有效期为 10 分钟。");
        await service.waitLogin();
        await refresh();
        setModels(await service.models());
        setMessage("账号登录成功。请选择模型，再到 Operit 模型配置中选择「WorkBuddy 中国区」。");
      } catch (error) {errorMessage(error);}
      finally {waiting.current = false;}
    }
    async function run(action) {
      if (active.current) return;
      active.current = true; setBusy(true);
      try {await action();} catch (error) {errorMessage(error);}
      finally {active.current = false; setBusy(false);}
    }
    const button = (label, onClick, enabled = !busy) => UI.Button({onClick, enabled}, [text(label)]);
    const children = [
      text("WorkBuddy 中国区", "headlineSmall"),
      text("0.2.1 · 文字、图片理解与 WorkBuddy 图片生成", "bodySmall"),
      text(message),
      button("点击登录 / 添加账号", () => run(async () => {
        await service.beginLogin(); await refresh(); setModels([]); setCredits("");
        // Keep waiting separate from action mutex so Cancel remains available.
        void waitForLogin();
      }), !busy && !status.pending),
      button("刷新账号状态", () => run(async () => {await refresh(); setMessage("账号状态已刷新");}))
    ];
    if (status.pending) {
      children.push(button("重新打开授权页面", () => run(() => service.resumeBrowser())));
      children.push(button("继续等待授权结果", () => waitForLogin(), !busy));
      children.push(button("取消本次登录", () => run(async () => {await service.cancel(); await refresh(); setMessage("本次登录已取消");})));
    }
    children.push(text("账号管理", "titleMedium"));
    if (!status.accounts.length) children.push(text("尚未登录账号"));
    status.accounts.forEach(account => children.push(UI.Card({fillMaxWidth: true}, [
      UI.Column({padding: 12, spacing: 8}, [
        text(`${account.active ? "✓ 当前账号 · " : ""}${account.label}${account.enterprise ? "（企业）" : ""}`),
        button("使用此账号", () => run(async () => {
          await service.select(account.id); await refresh(); setModels([]); setCredits("");
          setMessage("账号已切换，已清除默认模型，请重新获取模型列表。所有使用本插件的配置共用当前账号。");
        }), !busy && !account.active),
        button("删除此账号的本机凭据", () => run(async () => {
          await service.remove(account.id); await refresh(); setModels([]); setCredits("");
          setMessage("本机账号已删除；不会撤销服务器上的授权。");
        }))
      ])
    ])));
    children.push(text("可用模型", "titleMedium"));
    children.push(text(status.model ? `默认模型：${status.model}` : "尚未选择默认模型"));
    children.push(button("获取最新模型列表", () => run(async () => {setModels(await service.models()); setMessage("已获取账号可用 CLI 模型");}), !busy && !!status.activeId));
    models.forEach(model => children.push(button(`${status.model === model.id ? "✓ " : ""}${model.name} · ${model.id}`,
      () => run(async () => {await service.chooseModel(model.id); await refresh(); setMessage("默认模型已保存；Operit 模型配置内的模型选择优先于此默认值。");}))));
    children.push(button("运行真实推理与图片诊断（消耗少量积分）", () => run(async () => {setMessage("正在运行真机诊断，请保持页面打开"); setMessage(await service.diagnostics());}), !busy && !!status.activeId));
    children.push(button("检测 WorkBuddy 媒体生成服务权限", () => run(async () => {setMessage(await service.mediaProbe());}), !busy && !!status.activeId));
    children.push(text("WorkBuddy 媒体生成（独立服务，消耗积分）", "titleMedium"));
    children.push(UI.TextField({value:prompt,onValueChange:setPrompt,label:"生成描述",fillMaxWidth:true}));
    children.push(button("生成图片", () => run(async () => {setMessage("正在生成图片，请保持页面打开；不要重复提交"); const r=await service.generateMedia({type:"image",prompt});setMessage(JSON.stringify(r));}), !busy && !!status.activeId));
    children.push(button("生成 5 秒视频", () => run(async () => {setMessage("正在生成视频，请保持页面打开；不要重复提交"); const r=await service.generateMedia({type:"video",prompt,duration:5,resolution:"720p"});setMessage(JSON.stringify(r));}), !busy && !!status.activeId));
    children.push(button("查询上次媒体任务（不重新生成）", () => run(async () => {setMessage(JSON.stringify(await service.queryLastMedia()));}), !busy && !!status.activeId));
    children.push(text("账号积分", "titleMedium"));
    if (credits) children.push(text(credits));
    children.push(button("查询当前账号积分", () => run(async () => {
      setCredits("");
      const value = await service.credits();
      setCredits(value.unlimited ? "企业额度：无限制" : `${value.kind === "enterprise" ? "企业可用配额" : "个人可用积分"}：${value.remaining}`);
      setMessage("积分查询完成，以 WorkBuddy 官网显示及实际扣费为准。");
    }), !busy && !!status.activeId));
    children.push(text("使用说明", "titleMedium"));
    children.push(text("登录 → 获取模型 → 在 Operit 模型配置选择 WorkBuddy 中国区及模型。API Key 和自定义请求头请留空，插件仅从本机加密存储读取登录令牌。"));
    children.push(text("需要 Android 工具时，在 Operit 中启用工具调用并授权相应工具；插件不会绕过 Operit 权限确认。支持目录声明的图片输入；音频/视频直接输入未验证；图片生成使用 workbuddy_media 工具，视频生成当前上游 502、未通过验收。思考强度可设置 reasoning_effort，模型自身可能始终思考。"));
    children.push(text("本地清理", "titleMedium"));
    children.push(UI.Checkbox({checked: confirmErase, onCheckedChange: setConfirmErase}));
    children.push(text("我确认删除全部本机账号及待授权会话（用于重置或密钥失效）", "bodySmall"));
    children.push(button("清空全部本机凭据", () => run(async () => {
      await service.erase(); await refresh(); setModels([]); setCredits(""); setConfirmErase(false); setMessage("本机加密凭据已清空");
    }), !busy && confirmErase));
    return UI.LazyColumn({fillMaxSize: true, padding: 16, spacing: 12, onLoad: async () => {
      if (loaded.current) return;
      loaded.current = true;
      try {const value = await refresh(); await service.backup(); if (value.pending && !value.loginExpired) void waitForLogin(); else if (value.activeId) setMessage("账号已恢复；默认模型：" + (value.model || "尚未选择"));}
      catch (error) {errorMessage(error);}
    }}, children);
  };
}
function Screen(ctx) {return createScreen(require("./runtime.js").settings)(ctx);}
module.exports = Screen;
module.exports.default = Screen;
module.exports.createScreen = createScreen;
