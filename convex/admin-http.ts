import { httpAction } from "./_generated/server";
import { equalsSecret } from "./crypto";
import { loginCore, logoutCore, adminCore } from "./vault";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Type": "application/json; charset=utf-8",
};
function rejected(status = 401): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), { status, headers });
}
function invalid(): Response {
  return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers });
}
async function trusted(request: Request): Promise<boolean> {
  const expected = process.env.ENV_STORE_INTERNAL_API_KEY;
  const supplied = request.headers.get("x-pama-internal-key");
  return Boolean(expected && expected.length >= 32 && supplied && await equalsSecret(supplied, expected));
}
function session(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  return /^Bearer [A-Za-z0-9_-]{32,}$/.test(auth) ? auth.slice(7) : null;
}
async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) return null;
  let parsed: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return null;
    parsed = JSON.parse(raw);
  } catch { return null; }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ?
    parsed as Record<string, unknown> : null;
}

// Neither the admin password nor the session bearer appears in a public
// Convex function argument. Only a server with the shared internal key can
// access these HTTP handlers. The key must be set on Next.js and Convex.
export const login = httpAction(async (ctx, request): Promise<Response> => {
  if (!await trusted(request)) return rejected();
  const body = await jsonBody(request);
  if (!body || typeof body.password !== "string" || typeof body.identity !== "string" ||
      body.password.length > 4096 || body.identity.length > 256) return invalid();
  try {
    const result = await loginCore(ctx, { password: body.password, identity: body.identity });
    return new Response(JSON.stringify(result), { headers });
  } catch { return rejected(); }
});

export const logout = httpAction(async (ctx, request): Promise<Response> => {
  if (!await trusted(request)) return rejected();
  const token = session(request);
  if (!token) return rejected();
  try {
    await logoutCore(ctx, { token });
    return new Response(JSON.stringify({ ok: true }), { headers });
  } catch { return rejected(); }
});

export const admin = httpAction(async (ctx, request): Promise<Response> => {
  if (!await trusted(request)) return rejected();
  const token = session(request);
  if (!token) return rejected();
  const body = await jsonBody(request);
  if (!body || typeof body.op !== "string" || body.op.length > 100) return invalid();
  try {
    const result = await adminCore(ctx, { token, op: body.op, data: body.data });
    return new Response(JSON.stringify(result), { headers });
  } catch { return rejected(); }
});
