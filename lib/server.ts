import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { cookies, headers } from "next/headers";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "pama_env_session";
export const noStore = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };

export function convexServer() {
  const url = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Convex URL is not configured");
  return new ConvexHttpClient(url);
}

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function safeOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

export async function adminSnapshot(token: string) {
  return convexServer().action(api.vault.admin, { token, op: "snapshot" });
}

export async function requestIdentity(request: NextRequest) {
  // On Vercel, the edge gateway adds these IP headers; fingerprinting limits password guessing.
  const headerValues = await headers();
  const ip = headerValues.get("x-real-ip") ?? headerValues.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  return request.nextUrl.host + ":" + ip.slice(0, 120);
}

export async function adminAction(token: string, op: string, data?: unknown) {
  return convexServer().action(api.vault.admin, { token, op, data });
}