import "server-only";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "pama_env_session";
export const noStore = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export function convexSiteUrl(): URL {
  const cloud = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const override = process.env.CONVEX_SITE_URL;
  if (!cloud && !override) throw new Error("Convex URL is not configured");
  const url = new URL(override ?? cloud!.replace(/\.convex\.cloud\/?$/, ".convex.site"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) throw new Error("Invalid Convex HTTP origin");
  return url;
}
export async function internalRequest(path: "/auth/login" | "/auth/logout" | "/admin", data: unknown, session?: string): Promise<unknown> {
  const internalKey = process.env.ENV_STORE_INTERNAL_API_KEY;
  if (!internalKey || internalKey.length < 32) throw new Error("Env Store internal gateway is not configured");
  const url = convexSiteUrl();
  url.pathname = path;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "X-Pama-Internal-Key": internalKey,
      "Content-Type": "application/json",
      ...(session ? { Authorization: "Bearer " + session } : {}),
    },
    body: JSON.stringify(data),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Env Store request refused");
  // No error body or secret value is logged on failure.
  return response.json();
}
export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
export function safeOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}
export async function adminSnapshot(token: string) {
  return internalRequest("/admin", { op: "snapshot" }, token);
}
export async function requestIdentity(request: NextRequest) {
  const values = await headers();
  const ip = values.get("x-real-ip") ?? values.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  return request.nextUrl.host + ":" + ip.slice(0, 120);
}
export async function adminAction(token: string, op: string, data?: unknown) {
  return internalRequest("/admin", { op, data }, token);
}
