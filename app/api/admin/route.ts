import { NextRequest, NextResponse } from "next/server";
import { adminAction, noStore, safeOrigin, sessionToken } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await sessionToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  try {
    const result = await adminAction(token, "snapshot");
    return NextResponse.json(result, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Unauthorized or store not configured" }, { status: 401, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  if (!safeOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers: noStore });
  const token = await sessionToken();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: noStore });
  let body: { op?: unknown; data?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: noStore }); }
  if (typeof body.op !== "string" || body.op.length > 100) return NextResponse.json({ error: "Invalid operation" }, { status: 400, headers: noStore });
  try {
    const result = await adminAction(token, body.op, body.data);
    return NextResponse.json(result, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Operation rejected. Check the values and permissions." }, { status: 400, headers: noStore });
  }
}