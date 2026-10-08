import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

function asJsModule(text) {
  const js = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}
const httpAction = asJsModule('export const httpAction = fn => fn;');
const vaultCore = asJsModule([
  'export async function loginCore(_ctx, body) { if(body.password !== "correct") throw Error("invalid"); return {token:"session_private", expiresIn:21600}; }',
  'export async function logoutCore(_ctx, body) { if(body.token !== "session_private") throw Error("invalid"); return {ok:true}; }',
  'export async function adminCore(_ctx, body) { if(body.token !== "session_private") throw Error("invalid"); return {ok:true, op:body.op}; }',
].join("\n"));
const crypto = asJsModule('export async function equalsSecret(a,b) {return a === b};');
const adminSource = readFileSync(resolve("convex/admin-http.ts"), "utf8");
const compiled = ts.transpileModule(adminSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
  .replace(/from ["']\.\/_generated\/server["']/g, "from " + JSON.stringify(httpAction))
  .replace(/from ["']\.\/vault["']/g, "from " + JSON.stringify(vaultCore))
  .replace(/from ["']\.\/crypto["']/g, "from " + JSON.stringify(crypto));
const { login, logout, admin } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

const internalKey = "private-gateway-key-" + "x".repeat(32);
async function request(handler, body, key, authorization) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-Pama-Internal-Key"] = key;
  if (authorization) headers.Authorization = authorization;
  return handler({}, new Request("https://example.convex.site/admin", {
    method: "POST", headers, body: JSON.stringify(body),
  }));
}
test("admin endpoints reject all requests when internal secret is not configured", async () => {
  const prior = process.env.ENV_STORE_INTERNAL_API_KEY;
  try {
    delete process.env.ENV_STORE_INTERNAL_API_KEY;
    for (const handler of [login, logout, admin]) {
      const r = await request(handler, { password: "correct", identity: "test", op: "snapshot" }, internalKey, "Bearer session_private");
      assert.equal(r.status, 401);
      assert.match(r.headers.get("Cache-Control") || "", /no-store/);
    }
  } finally {
    if (prior === undefined) delete process.env.ENV_STORE_INTERNAL_API_KEY;
    else process.env.ENV_STORE_INTERNAL_API_KEY = prior;
  }
});
test("wrong internal key fails closed without disclosing secrets", async () => {
  const prior = process.env.ENV_STORE_INTERNAL_API_KEY;
  try {
    process.env.ENV_STORE_INTERNAL_API_KEY = internalKey;
    const r = await request(login, { password: "correct", identity: "test" }, "wrong");
    assert.equal(r.status, 401);
    assert.doesNotMatch(await r.text(), /correct|session_private|private-gateway-key/);
  } finally {
    if (prior === undefined) delete process.env.ENV_STORE_INTERNAL_API_KEY;
    else process.env.ENV_STORE_INTERNAL_API_KEY = prior;
  }
});
test("valid gateway key permits login while password errors remain generic", async () => {
  const prior = process.env.ENV_STORE_INTERNAL_API_KEY;
  try {
    process.env.ENV_STORE_INTERNAL_API_KEY = internalKey;
    const ok = await request(login, { password: "correct", identity: "test" }, internalKey);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).token, "session_private");
    const bad = await request(login, { password: "wrong", identity: "test" }, internalKey);
    assert.equal(bad.status, 401);
    assert.doesNotMatch(await bad.text(), /wrong/);
  } finally {
    if (prior === undefined) delete process.env.ENV_STORE_INTERNAL_API_KEY;
    else process.env.ENV_STORE_INTERNAL_API_KEY = prior;
  }
});
test("admin and logout require valid session bearer with internal key", async () => {
  const prior = process.env.ENV_STORE_INTERNAL_API_KEY;
  try {
    process.env.ENV_STORE_INTERNAL_API_KEY = internalKey;
    for (const handler of [admin, logout]) {
      const denied = await request(handler, { op: "snapshot" }, internalKey);
      assert.equal(denied.status, 401);
    }
    const auth = "Bearer session_private";
    // Session bearer format intentionally requires 32 or more characters.
    const deniedShort = await request(admin, { op: "snapshot" }, internalKey, auth);
    assert.equal(deniedShort.status, 401);
  } finally {
    if (prior === undefined) delete process.env.ENV_STORE_INTERNAL_API_KEY;
    else process.env.ENV_STORE_INTERNAL_API_KEY = prior;
  }
});
