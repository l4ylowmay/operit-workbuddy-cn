// SPDX-License-Identifier: MIT
"use strict";
const platform = require("./platform.js");
const {createClient} = require("./client.js");
const {createProvider} = require("./provider.js");
const {queryCredits} = require("./credits.js");
const client = createClient(platform);
const provider = createProvider(platform, client, value => sendIntermediateResult(value),
  () => "tool_" + Java.type("java.util.UUID").randomUUID().toString().replace(/-/g, ""));
const settings = {
  status: () => client.status(),
  backup: () => require("./diagnostics.js").backup(),
  generateMedia: args => require("./media-service.js").generate(platform,client,args),
  queryLastMedia: () => {const s=require("./media-service.js");return s.query(platform,client,s.readLast());},
  mediaProbe: () => require("./media-service.js").probe(platform,client),
  diagnostics: () => require("./diagnostics.js").run(client, provider),
  beginLogin: () => client.beginLogin(),
  waitLogin: () => client.waitLogin(),
  resumeBrowser: () => client.resumeBrowser(),
  cancel: () => client.mutate("cancel"),
  select: id => client.mutate("select", id),
  remove: id => client.mutate("delete", id),
  models: async () => (await client.models()).map(m => ({id: m.id, name: (m.name || m.id) + " · " + require("./capabilities.js").describe(m)})),
  chooseModel: id => client.chooseModel(id),
  credits: async () => queryCredits(platform, await client.session()),
  erase: () => client.erase()
};
module.exports = {client, provider, settings};
