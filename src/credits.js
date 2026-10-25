// SPDX-License-Identifier: MIT
// Portions Copyright (c) 2026 Axiaohungry.
// Adapted from DSH WorkBuddy 1.3.25 (MIT); see ../THIRD_PARTY_NOTICES.md.
"use strict";
const {parseResponse, safeError} = require("./client.js");
const HOSTS = ["codebuddy.cn", "www.codebuddy.cn", "workbuddy.cn", "www.workbuddy.cn"];
function billingHost(domain) {
  if (!domain) return "https://www.codebuddy.cn"; // DSH documented default.
  const host = domain.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!HOSTS.includes(host)) throw new Error("账号返回的积分域名不在官方白名单内");
  return "https://" + host;
}
function resourceBody(now = new Date()) {
  const end = new Date(now.getTime()); end.setFullYear(end.getFullYear() + 101);
  const format = date => {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };
  return {PageNumber: 1, PageSize: 100, ProductCode: "p_tcaca", Status: [0,3],
    PackageEndTimeRangeBegin: format(now), PackageEndTimeRangeEnd: format(end)};
}
function personal(payload) {
  const accounts = [payload?.data?.Response?.Data?.Accounts, payload?.data?.data?.Response?.Data?.Accounts,
    payload?.data?.accounts, payload?.data?.data?.accounts, payload?.Response?.Data?.Accounts].find(Array.isArray);
  if (!accounts) throw new Error("个人积分响应结构不受支持，不能确认余额");
  // DSH reads only first 100 resources. Refuse totals that could omit later pages.
  if (accounts.length >= 100) throw new Error("积分资源达到分页上限，暂不能确认完整余额");
  let total = 0;
  for (const account of accounts) {
    const fields = ["CycleCapacityRemainPrecise", "CycleCapacityRemain", "CapacityRemainPrecise", "CapacityRemain"];
    const field = fields.find(f => account[f] !== null && account[f] !== undefined && Number.isFinite(Number(account[f])));
    if (!field) throw new Error("部分积分资源缺少余额字段，暂不能确认余额");
    total += Number(account[field]);
  }
  return {kind: "personal", remaining: Number(total.toFixed(2)), resources: accounts.length, unlimited: false};
}
function enterprise(payload) {
  const data = [payload?.data, payload?.data?.data, payload?.data?.Response?.Data, payload]
    .find(v => v && ("limitNum" in v || "LimitNum" in v));
  if (!data) throw new Error("企业积分响应结构不受支持");
  const limit = Number(data.limitNum ?? data.LimitNum);
  if (!Number.isFinite(limit)) throw new Error("企业额度格式无效");
  if (limit === -1) return {kind: "enterprise", remaining: null, unlimited: true};
  const used = Number(data.credit ?? data.Credit);
  if (!Number.isFinite(used)) throw new Error("企业用量格式无效");
  return {kind: "enterprise", remaining: Number(Math.max(0, limit - used).toFixed(2)), total: limit, used, unlimited: false};
}
async function queryCredits(platform, session) {
  const host = billingHost(session.auth.domain);
  const headers = {accept: "application/json, text/plain, */*", "content-type": "application/json",
    "x-client-platform": "web", origin: host, referer: host + "/profile/plans-usage",
    authorization: `Bearer ${session.auth.accessToken}`,
    "user-agent": "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 Chrome/151.0.0.0 Mobile Safari/537.36",
    ...(session.auth.domain ? {"x-domain": session.auth.domain} : {}),
    ...(session.account.userId ? {"x-user-id": session.account.userId} : {})};
  async function fetch(path, body, enterpriseId) {
    const payload = parseResponse(await platform.request({url: host + path, method: body === undefined ? "GET" : "POST", body,
      headers: {...headers, ...(enterpriseId ? {"x-enterprise-id": enterpriseId, "x-tenant-id": enterpriseId} : {})}}), false);
    if (payload.code !== undefined && payload.code !== 0) throw safeError(200, payload);
    return payload;
  }
  if (session.account.enterpriseId || ["ultimate", "exclusive"].includes(session.account.type.toLowerCase())) {
    let id = session.account.enterpriseId;
    if (!id) {
      const payload = await fetch("/console/accounts");
      id = payload?.data?.accounts?.[0]?.enterpriseId;
      if (!id) throw new Error("企业账号没有返回 enterpriseId");
    }
    return enterprise(await fetch("/v2/billing/meter/get-enterprise-user-usage", {}, id));
  }
  return personal(await fetch("/v2/billing/meter/get-user-resource", resourceBody()));
}
module.exports = {queryCredits, personal, enterprise, billingHost, resourceBody};
