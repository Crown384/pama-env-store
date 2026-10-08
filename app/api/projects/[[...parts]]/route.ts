import { NextRequest, NextResponse } from "next/server";
import { dotenvExport, validKey, validSlug } from "@/convex/machine-request";
import { noStore } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_UPSTREAM_BYTES = 160_000;

function denied(status = 404) {
  return NextResponse.json({ error: "Not found or not authorized" }, { status, headers: noStore });
}

// Derive Convex's HTTP-action origin from the configured deployment. A
// CONVEX_SITE_URL override supports self-hosted/custom Convex endpoints.
function convexSiteUrl(): URL {
  const cloud = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
  const override = process.env.CONVEX_SITE_URL;
  if (!cloud && !override) throw new Error("Convex URL is not configured");
  const url = new URL(override ?? cloud!.replace(/\.convex\.cloud\/?$/, ".convex.site"));
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) throw new Error("Invalid Convex HTTP origin");
  return url;
}

/**
 * Public HTTPS facade. The machine bearer passes only in an Authorization
 * header to Convex HTTP action, never as a public Convex function argument.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ parts?: string[] }> }) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer pes_[A-Za-z0-9_-]{32,}$/.test(authorization)) return denied(401);
  const { parts = [] } = await context.params;
  if (![0, 1, 3, 4].includes(parts.length) ||
      (parts.length >= 3 && parts[1] !== "env") ||
      (parts[0] !== undefined && !validSlug(parts[0])) ||
      (parts[2] !== undefined && parts[2] !== "staging" && parts[2] !== "production") ||
      (parts[3] !== undefined && !validKey(parts[3]))) return denied();
  const format = request.nextUrl.searchParams.get("format");
  if (format !== null && (format !== "dotenv" || parts.length !== 3 ||
      request.nextUrl.searchParams.size !== 1)) return denied();
  if (format === null && request.nextUrl.searchParams.size !== 0) return denied();
  try {
    const upstream = convexSiteUrl();
    upstream.pathname = "/machine";
    if (parts[0]) upstream.searchParams.set("slug", parts[0]);
    if (parts[2]) upstream.searchParams.set("environment", parts[2]);
    if (parts[3]) upstream.searchParams.set("key", parts[3]);
    const response = await fetch(upstream, {
      method: "GET",
      headers: { Authorization: authorization, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return denied(response.status === 400 ? 400 : 404);
    const payload = await response.text();
    if (Buffer.byteLength(payload, "utf8") > MAX_UPSTREAM_BYTES) return denied(502);
    const parsed: unknown = JSON.parse(payload);
    if (format === "dotenv") {
      if (!parsed || typeof parsed !== "object" || !("values" in parsed) ||
          !parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values) ||
          Object.entries(parsed.values).some(([key, value]) => !validKey(key) || typeof value !== "string")) return denied(502);
      return new NextResponse(dotenvExport(parsed.values as Record<string, string>), {
        headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="environment.env"' },
      });
    }
    return new NextResponse(payload, { headers: { ...noStore, "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    // Public machine errors never echo authorization headers or upstream errors.
    return denied(502);
  }
}
