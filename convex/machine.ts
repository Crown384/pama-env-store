import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256, decrypt } from "./crypto";
import { parseMachineLookup } from "./machine-request";
import type { Doc, Id } from "./_generated/dataModel";

const headers = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Type": "application/json; charset=utf-8",
};
function denied(): Response {
  return new Response(JSON.stringify({ error: "Not found or not authorized" }), { status: 404, headers });
}
function invalid(): Response {
  return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers });
}

/**
 * Authenticated machine gateway. This endpoint deliberately accepts the bearer
 * token in an HTTP Authorization header, not in a public Convex action argument.
 * The token and plaintext secret are never written to the database or audit log.
 */
export const machine = httpAction(async (ctx, request): Promise<Response> => {
  const auth = request.headers.get("authorization") ?? "";
  if (!/^Bearer pes_[A-Za-z0-9_-]{32,}$/.test(auth)) return denied();
  let lookup: ReturnType<typeof parseMachineLookup>;
  try { lookup = parseMachineLookup(new URL(request.url).searchParams); }
  catch { return invalid(); }
  try {
    const tokenHash = await sha256(auth.slice(7));
    const result: {
      clientId: Id<"machineClients">;
      projectId?: Id<"projects">;
      projects: Array<{ name: string; slug: string; environments: Array<"staging" | "production"> }>;
      project: { name: string; slug: string; environments: Array<"staging" | "production"> } | null;
      variables: Doc<"variables">[];
    } = await ctx.runQuery(internal.store.readMachine, {
      tokenHash, slug: lookup.slug, environment: lookup.environment,
    });
    if (!lookup.slug) return new Response(JSON.stringify({ projects: result.projects }), { headers });
    if (!lookup.environment) return new Response(JSON.stringify({ project: result.project }), { headers });
    if (!result.projectId || !result.project) return denied();
    // Authorization is checked before reading/decrypting values.
    const resolved = new Map<string, string>();
    for (const item of result.variables) {
      if (item.scope === "shared") resolved.set(item.key, await decrypt(item.encryptedValue));
    }
    for (const item of result.variables) {
      if (item.scope === lookup.environment) resolved.set(item.key, await decrypt(item.encryptedValue));
    }
    if (lookup.key && !resolved.has(lookup.key)) return denied();
    // Recheck authorization and record the exact project/scope before releasing plaintext.
    // A revoked client cannot pass this transactional audit gate.
    await ctx.runMutation(internal.store.logAccess, {
      tokenHash,
      action: lookup.key ? "machine_client.variable_accessed" : "machine_client.environment_accessed",
      projectId: result.projectId,
      scope: lookup.environment,
      key: lookup.key,
    });
    if (lookup.key) return new Response(JSON.stringify({ key: lookup.key, value: resolved.get(lookup.key) }), { headers });
    return new Response(JSON.stringify({
      project: result.project,
      environment: lookup.environment,
      values: Object.fromEntries([...resolved.entries()].sort(([a], [b]) => a.localeCompare(b))),
    }), { headers });
  } catch {
    // Never echo internal errors or credentials.
    return denied();
  }
});
