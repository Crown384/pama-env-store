import { NextRequest, NextResponse } from "next/server";
import { convexServer, noStore } from "@/lib/server";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Machine consumers authenticate with an explicitly scoped bearer token. No browser cookie access.
function bearer(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  return /^Bearer pes_[a-zA-Z0-9_-]+$/.test(authorization) ? authorization.slice(7) : null;
}

function asDotenv(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return key + '="' + escaped + '"';
  }).join("\n") + "\n";
}

export async function GET(request: NextRequest, context: { params: Promise<{ parts?: string[] }> }) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const { parts = [] } = await context.params;
  if (parts.length !== 0 && parts.length !== 1 && parts.length !== 3 && parts.length !== 4) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  }
  if (parts.length >= 3 && parts[1] !== "env") return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  if (parts.some(part => part.length > 128)) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
  try {
    const result = await convexServer().action(api.vault.machine, {
      token, slug: parts[0], environment: parts[2], key: parts[3],
    });
    if (parts.length === 3 && request.nextUrl.searchParams.get("format") === "dotenv" && result && "values" in result) {
      return new NextResponse(asDotenv(result.values as Record<string, string>), {
        headers: { ...noStore, "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "attachment; filename=environment.env" },
      });
    }
    return NextResponse.json(result, { headers: noStore });
  } catch {
    // Do not reveal whether a project/key exists to unauthorized callers.
    return NextResponse.json({ error: "Not found or not authorized" }, { status: 404, headers: noStore });
  }
}