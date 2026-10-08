import { NextRequest, NextResponse } from "next/server";
import { convexServer, noStore, requestIdentity, safeOrigin, SESSION_COOKIE, sessionToken } from "@/lib/server";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!safeOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers: noStore });
  let body: { action?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: noStore }); }
  if (body.action === "logout") {
    const token = await sessionToken();
    if (token) {
      try { await convexServer().action(api.vault.logout, { token }); } catch { /* expire cookie either way */ }
    }
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production" });
    return response;
  }
  if (body.action !== "login" || typeof body.password !== "string" || body.password.length > 4096) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: noStore });
  }
  try {
    const result = await convexServer().action(api.vault.login, { password: body.password, identity: await requestIdentity(request) });
    const response = NextResponse.json({ ok: true }, { headers: noStore });
    response.cookies.set(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: result.expiresIn, priority: "high" });
    return response;
  } catch {
    return NextResponse.json({ error: "Incorrect password or temporarily locked out" }, { status: 401, headers: noStore });
  }
}