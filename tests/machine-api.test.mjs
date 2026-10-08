import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const src = readFileSync(resolve("convex/machine-request.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
} }).outputText;
const { parseMachineLookup, dotenvExport, validSlug, validKey } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
function parse(query) { return parseMachineLookup(new URLSearchParams(query)); }

test("accepts only scoped machine paths with correct environment", () => {
  assert.deepEqual(parse(""), {});
  assert.deepEqual(parse("slug=track"), { slug: "track" });
  assert.deepEqual(parse("slug=track&environment=staging"), { slug: "track", environment: "staging" });
  assert.deepEqual(parse("slug=track&environment=production&key=CONVEX_DEPLOY_KEY"),
    { slug: "track", environment: "production", key: "CONVEX_DEPLOY_KEY" });
  assert.equal(validSlug("pama-env-store"), true);
  assert.equal(validKey("NEXT_PUBLIC_CONVEX_URL"), true);
});
test("rejects malformed scopes, duplicate parameters and unknown fields", () => {
  for (const query of [
    "slug=../track", "slug=track&environment=preview", "environment=staging",
    "slug=track&key=TOKEN", "slug=track&environment=staging&key=INVALID-KEY",
    "slug=track&slug=track", "slug=track&extra=1", "slug=track&environment=staging&environment=staging",
    "slug=track&environment=production&key=%00",
  ]) assert.throws(() => parse(query), /Invalid request/);
});
test("dotenv export escapes newlines, CR, quotes, and backslashes", () => {
  assert.equal(dotenvExport({ ABC: 'a\\b"\n\r' }), 'ABC="a\\\\b\\"\\n\\r"\n');
  assert.throws(() => dotenvExport({ "BAD-NAME": "x" }), /Invalid environment key/);
});
test("public machine endpoints use bearer header and never pass token as a public action arg", () => {
  const machine = readFileSync(resolve("convex/machine.ts"), "utf8");
  const http = readFileSync(resolve("convex/http.ts"), "utf8");
  const next = readFileSync(resolve("app/api/projects/[[...parts]]/route.ts"), "utf8");
  const vault = readFileSync(resolve("convex/vault.ts"), "utf8");
  assert.match(machine, /request\.headers\.get\("authorization"\)/);
  assert.match(machine, /internal\.store\.readMachine/);
  assert.match(machine, /projectId: result\.projectId/);
  assert.match(http, /path: "\/machine"/);
  assert.match(next, /headers: \{ Authorization: authorization/);
  assert.doesNotMatch(vault, /export const machine = action/);
  assert.doesNotMatch(next, /api\.vault\.machine/);
});
test("both layers disable caching and never echo errors", () => {
  const machine = readFileSync(resolve("convex/machine.ts"), "utf8");
  const next = readFileSync(resolve("app/api/projects/[[...parts]]/route.ts"), "utf8");
  assert.match(machine, /no-store/);
  assert.match(next, /noStore/);
  assert.match(next, /redirect: "error"/);
  assert.doesNotMatch(next, /console\.log/);
});
