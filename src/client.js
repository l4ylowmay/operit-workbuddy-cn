// SPDX-License-Identifier: MIT
// Portions Copyright (c) 2026 Axiaohungry.
// Adapted from DSH WorkBuddy 1.3.25 (MIT); see ../THIRD_PARTY_NOTICES.md.
"use strict";
// Protocol adaptation derived from DSH 1.3.25, MIT, see licenses/DSH-MIT.txt.
const BASE = "https://copilot.tencent.com";
const CLIENT_HEADERS = {
  accept: "application/json", "content-type": "application/json",
  "user-agent": "CLI/2.171.0 CodeBuddy/2.171.0", "x-product": "SaaS",
  "x-ide-type": "CLI", "x-ide-name": "CodeBuddy", "x-ide-version": "2.171.0"
};
const NO_IDS = {"X-No-User-Id": "true", "X-No-Enterprise-Id": "true", "X-No-Department-Info": "true"};
const NO_ACCOUNT = {...NO_IDS, "X-No-Authorization": "true"};

function safeError(status, payload) {
  const raw = String(payload?.code ?? payload?.error?.code ?? "");
  const code = /^\d{1,9}(?:-\d{1,9})?$/.test(raw) ? raw : "未知";
  return new Error(`WorkBuddy 请求失败（HTTP ${status}，业务码 ${code}）` +
    (["11128", "11-128"].includes(code) ? "：渠道校验未通过，请检查客户端兼容性" : ""));
}
function parseResponse(response, wrapped = true) {
  let body;
  try { body = JSON.parse(response.text); }
  catch (_) { throw new Error(`WorkBuddy 返回无法解析的数据（HTTP ${response.status}）`); }
  if (response.status < 200 || response.status >= 300 || (wrapped && body.code !== 0) || body.error) {
    throw safeError(response.status, body);
  }
  return wrapped ? body.data : body;
}
function expires(auth, now) {
  const value = {...auth};
  if (!value.expiresAt && Number.isFinite(value.expiresIn)) value.expiresAt = now + value.expiresIn * 1000;
  if (!value.refreshExpiresAt && Number.isFinite(value.refreshExpiresIn)) value.refreshExpiresAt = now + value.refreshExpiresIn * 1000;
  return value;
}
function enterpriseHeaders(session) {
  const id = session.account?.enterpriseId;
  return {
    ...(id ? {"X-Enterprise-Id": id, "X-Tenant-Id": id} : {}),
    ...(session.auth?.domain ? {"X-Domain": session.auth.domain} : {})
  };
}
function normalizeAccount(raw, auth, claims) {
  const sources = [raw, raw?.account, raw?.user, raw?.userInfo, raw?.profile, raw?.data, claims(auth.accessToken)];
  const read = keys => {
    for (const item of sources) for (const key of keys) {
      const value = item?.[key];
      if ((typeof value === "string" && value.trim()) || (typeof value === "number" && Number.isFinite(value))) return String(value).trim();
    }
    return "";
  };
  return {
    userId: read(["userId", "uid", "user_id", "id", "sub"]),
    enterpriseId: read(["enterpriseId", "tenantId", "enterprise_id", "tenant_id"]),
    displayName: read(["displayName", "name", "nickname", "username", "accountName", "email", "uin", "phoneNumber"]),
    type: read(["type", "accountType", "account_type"])
  };
}
function modelsFromConfig(data) {
  const agents = Array.isArray(data?.agents) ? data.agents : data?.agent?.agents;
  const allowed = agents?.find(a => a.name === "cli")?.models;
  if (!Array.isArray(allowed) || !Array.isArray(data?.models)) throw new Error("模型配置结构不受支持");
  const models = allowed.map(id => data.models.find(m => m.id === id)).filter(Boolean);
  if (!models.length) throw new Error("WorkBuddy 没有返回 CLI 可用模型");
  return models;
}

function createClient(platform, now = Date.now) {
  const {withStore, request, claims, delay} = platform;
  const api = async (path, options = {}) => parseResponse(await request({url: BASE + path, ...options,
    headers: {...CLIENT_HEADERS, ...options.headers}}));
  const selected = db => {
    const entry = db.entries.find(e => e.id === db.activeId);
    if (!entry) throw new Error("请先在 WorkBuddy 中国区插件设置中登录并选择账号");
    return entry;
  };
  const publicStatus = db => ({
    accounts: db.entries.map(e => ({id: e.id, label: e.account.displayName || e.account.userId,
      enterprise: !!e.account.enterpriseId, active: e.id === db.activeId})),
    activeId: db.activeId, model: db.model, pending: !!db.pending,
    loginExpired: !!db.pending && now() >= db.pending.deadline
  });
  async function status() { return withStore(store => publicStatus(store.read())); }
  async function session() {
    return withStore(async store => {
      const db = store.read();
      const entry = selected(db);
      const end = Number.isFinite(entry.auth.expiresAt) ? entry.auth.expiresAt : claims(entry.auth.accessToken).exp * 1000;
      if (!Number.isFinite(end) || end <= now() + 120000) {
        if (!entry.auth.refreshToken || (entry.auth.refreshExpiresAt && entry.auth.refreshExpiresAt <= now())) {
          throw new Error("WorkBuddy 登录已过期，请重新登录");
        }
        const fresh = expires(await api("/v2/plugin/auth/token/refresh", {
          method: "POST", body: {}, headers: {...enterpriseHeaders(entry),
            "X-Refresh-Token": entry.auth.refreshToken, "X-Auth-Refresh-Source": "plugin"}
        }), now());
        if (!fresh?.accessToken) throw new Error("刷新接口没有返回访问令牌，请重新登录");
        entry.auth = {...entry.auth, ...fresh, refreshToken: fresh.refreshToken || entry.auth.refreshToken};
        if (!fresh.expiresAt) delete entry.auth.expiresAt;
        store.write(db); // Persist rotating refresh token before releasing lock.
      }
      return JSON.parse(JSON.stringify(entry));
    });
  }
  async function beginLogin() {
    const state = await api("/v2/plugin/auth/state?platform=CLI", {method: "POST", body: {}, headers: NO_ACCOUNT});
    if (!state?.state || !state?.authUrl) throw new Error("登录接口未返回授权地址");
    platform.assertUrl(state.authUrl);
    await withStore(store => {
      const db = store.read();
      db.pending = {state: state.state, authUrl: state.authUrl, deadline: now() + 600000, auth: null};
      store.write(db);
    });
    platform.openBrowser(state.authUrl);
    return {pending: true}; // Neither state nor tokens leave the account service.
  }
  async function resumeBrowser() {
    return withStore(store => {
      const pending = store.read().pending;
      if (!pending || pending.deadline <= now()) throw new Error("登录会话已过期，请重新点击登录");
      platform.openBrowser(pending.authUrl);
      return {pending: true};
    });
  }
  async function pollLogin() {
    const pending = await withStore(store => store.read().pending);
    if (!pending) throw new Error("登录已取消或尚未开始");
    if (now() >= pending.deadline) throw new Error("登录会话已过期，请重新点击登录");
    const isCurrent = db => db.pending?.state === pending.state;
    if (!pending.auth) {
      const response = await request({url: `${BASE}/v2/plugin/auth/token?state=${encodeURIComponent(pending.state)}`,
        headers: {...CLIENT_HEADERS, ...NO_ACCOUNT}});
      // DSH polling contract: nonzero code/no data means authorization is pending;
      // authentication denial terminates polling. No raw server error is surfaced.
      if ([401, 403].includes(response.status)) throw safeError(response.status, {});
      let payload;
      try { payload = JSON.parse(response.text); } catch (_) { throw new Error("登录轮询返回无效数据"); }
      if (response.status !== 200 || payload.code !== 0 || !payload.data) return {pending: true};
      pending.auth = expires(payload.data, now());
      if (!pending.auth.accessToken || !pending.auth.refreshToken) throw new Error("登录接口未返回完整令牌");
      pending.accountDeadline = now() + 60000;
      await withStore(store => {
        const db = store.read();
        if (!isCurrent(db)) throw new Error("登录会话已取消或替换");
        db.pending = pending; store.write(db);
      });
    }
    if (now() > pending.accountDeadline) throw new Error("获取账号超时，请重新登录");
    const response = await request({url: `${BASE}/v2/plugin/login/account?state=${encodeURIComponent(pending.state)}`,
      headers: {...CLIENT_HEADERS, ...NO_IDS, ...enterpriseHeaders(pending), authorization: `Bearer ${pending.auth.accessToken}`}});
    if ([401, 403].includes(response.status)) throw safeError(response.status, {});
    let payload;
    try { payload = JSON.parse(response.text); } catch (_) { throw new Error("账号接口返回无效数据"); }
    if (response.status !== 200 || payload.code !== 0 || !payload.data) return {pending: true};
    const account = normalizeAccount(payload.data, pending.auth, claims);
    if (!account.userId) throw new Error("未获得稳定账号 ID，已拒绝保存账号");
    const entry = {id: JSON.stringify([account.userId, account.enterpriseId]), account, auth: pending.auth};
    return withStore(store => {
      const db = store.read();
      if (!isCurrent(db)) throw new Error("登录会话已取消或替换");
      db.entries = db.entries.filter(e => e.id !== entry.id).concat(entry);
      db.activeId = entry.id; db.pending = null; db.model = ""; store.write(db);
      return {pending: false, status: publicStatus(db)};
    });
  }
  async function waitLogin() {
    for (;;) {
      await delay(1500);
      const result = await pollLogin();
      if (!result.pending) return result;
    }
  }
  async function mutate(action, id) {
    return withStore(store => {
      const db = store.read();
      if (action === "cancel") db.pending = null;
      else if (action === "select" || action === "delete") {
        if (!db.entries.some(e => e.id === id)) throw new Error("账号不存在，请刷新设置界面");
        if (action === "select") db.activeId = id;
        else { db.entries = db.entries.filter(e => e.id !== id); if (db.activeId === id) db.activeId = null; }
        db.model = "";
      } else throw new Error("不支持的账号操作");
      store.write(db); return publicStatus(db);
    });
  }
  async function models() {
    const entry = await session();
    return modelsForSession(entry);
  }
  async function modelsForSession(entry) {
    const data = await api("/v3/config", {headers: {...enterpriseHeaders(entry), "X-User-Id": entry.account.userId,
      authorization: `Bearer ${entry.auth.accessToken}`}});
    return modelsFromConfig(data);
  }
  async function chooseModel(id) {
    const entry = await session();
    if (!(await modelsForSession(entry)).some(m => m.id === id)) throw new Error("该模型已不可用，请刷新列表");
    return withStore(store => {
      const db = store.read();
      if (db.activeId !== entry.id) throw new Error("账号在模型选择期间已切换，请重新选择模型");
      db.model = id; store.write(db); return publicStatus(db);
    });
  }
  return {status, session, beginLogin, resumeBrowser, pollLogin, waitLogin, mutate, models, modelsForSession, chooseModel,
    erase: () => withStore(store => {store.erase(); return {success: true};})};
}
module.exports = {createClient, parseResponse, safeError, modelsFromConfig, normalizeAccount, enterpriseHeaders, CLIENT_HEADERS};
