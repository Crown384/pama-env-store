import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { sha256, equalsSecret, encrypt, decrypt, token } from "./crypto";
import type { Id, Doc } from "./_generated/dataModel";

type Scope = "shared" | "staging" | "production";
type Env = "staging" | "production";
function validKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key.length <= 128;
}
function requireEnv(value: unknown): Env {
  if (value !== "staging" && value !== "production") throw new Error("Invalid environment");
  return value;
}
function requireScope(value: unknown): Scope {
  if (value !== "shared" && value !== "staging" && value !== "production") throw new Error("Invalid scope");
  return value;
}
// Login never writes the plaintext password to Convex storage or logs.
export async function loginCore(ctx: ActionCtx, { password, identity }: { password: string; identity: string }) {
    if (password.length > 4096) throw new Error("Authentication failed");
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) throw new Error("Admin password is not configured");
    const identityHash = await sha256(identity.slice(0, 256));
    if (!await ctx.runQuery(internal.store.canAttempt, { identityHash })) throw new Error("Too many attempts. Try again later.");
    const accepted = await equalsSecret(password, adminPassword);
    const sessionToken = accepted ? token() : undefined;
    const success = await ctx.runMutation(internal.store.recordAttempt, {
      identityHash, success: accepted, tokenHash: sessionToken ? await sha256(sessionToken) : undefined,
    });
    if (!success || !sessionToken) throw new Error("Authentication failed");
    return { token: sessionToken, expiresIn: 6 * 60 * 60 };
}
export async function logoutCore(ctx: ActionCtx, args: { token: string }) { await ctx.runMutation(internal.store.logout, { tokenHash: await sha256(args.token) }); return { ok: true }; },
}
// This is the sole public admin gateway. Every operation authenticates before reading or writing.
export async function adminCore(ctx: ActionCtx, args: { token: string; op: string; data?: unknown }): Promise<unknown> {
    const tokenHash = await sha256(args.token);
    const snapshot: { projects: Doc<"projects">[]; variables: Doc<"variables">[]; clients: Doc<"machineClients">[]; audits: Doc<"auditEvents">[]; expiresAt: number } = await ctx.runQuery(internal.store.readAdmin, { tokenHash });
    const data = args.data ?? {};
    if (args.op === "snapshot") {
      return {
        projects: snapshot.projects,
        variables: snapshot.variables.map(({ _id, projectId, scope, key, createdAt, updatedAt }) => ({ _id, projectId, scope, key, createdAt, updatedAt })),
        clients: snapshot.clients.map(({ _id, name, enabled, allowedProjectIds, allowedEnvironments, createdAt, lastUsedAt }) => ({ _id, name, enabled, allowedProjectIds, allowedEnvironments, createdAt, lastUsedAt })),
        audits: snapshot.audits, expiresAt: snapshot.expiresAt,
      };
    }
    if (args.op === "variable.reveal" || args.op === "environment.export") {
      const project = snapshot.projects.find(p => p._id === data.projectId);
      if (!project) throw new Error("Unknown project");
      if (args.op === "variable.reveal") {
        const variable = snapshot.variables.find(item => item.projectId === data.projectId && item.key === data.key && item.scope === data.scope);
        if (!variable) throw new Error("Variable missing");
        const value = await decrypt(variable.encryptedValue);
        await ctx.runMutation(internal.store.logAccess, { adminTokenHash: tokenHash, action: "variable.revealed", projectId: project._id, scope: variable.scope, key: variable.key });
        return { value };
      }
      const environment = requireEnv(data.environment);
      const resolved = new Map<string, string>();
      for (const item of snapshot.variables.filter(item => item.projectId === project._id && item.scope === "shared")) resolved.set(item.key, await decrypt(item.encryptedValue));
      for (const item of snapshot.variables.filter(item => item.projectId === project._id && item.scope === environment)) resolved.set(item.key, await decrypt(item.encryptedValue));
      await ctx.runMutation(internal.store.logAccess, { adminTokenHash: tokenHash, action: "environment.exported", projectId: project._id, scope: environment });
      return { environment, values: Object.fromEntries([...resolved.entries()].sort(([a], [b]) => a.localeCompare(b))) };
    }
    if (args.op === "variable.set") {
      if (!validKey(data.key) || typeof data.value !== "string" || data.value.length > 16_384) throw new Error("Invalid variable");
      const value = await encrypt(data.value);
      return ctx.runMutation(internal.store.write, { tokenHash, op: args.op, data: { projectId: data.projectId, scope: requireScope(data.scope), key: data.key, encryptedValue: value } });
    }
    if (args.op === "variable.import") {
      if (!Array.isArray(data.entries) || data.entries.length < 1 || data.entries.length > 100 || data.entries.some((entry: { key: unknown; value: unknown }) => !validKey(entry.key) || typeof entry.value !== "string" || entry.value.length > 16_384)) throw new Error("Invalid import");
      if (new Set(data.entries.map((entry: { key: string }) => entry.key)).size !== data.entries.length) throw new Error("Duplicate import keys");
      const entries = await Promise.all(data.entries.map(async (entry: { key: string; value: string }) => ({ key: entry.key, encryptedValue: await encrypt(entry.value) })));
      return ctx.runMutation(internal.store.write, { tokenHash, op: args.op, data: { projectId: data.projectId, scope: requireScope(data.scope), entries } });
    }
    if (args.op === "client.create") {
      const allowedProjectIds = data.allowedProjectIds as Id<"projects">[];
      const allowedEnvironments = data.allowedEnvironments as Env[];
      if (!Array.isArray(allowedProjectIds) || !allowedProjectIds.length || !allowedProjectIds.every(id => snapshot.projects.some(p => p._id === id))) throw new Error("Invalid projects");
      if (!Array.isArray(allowedEnvironments) || !allowedEnvironments.length || !allowedEnvironments.every(e => e === "staging" || e === "production")) throw new Error("Invalid environments");
      const issuedToken = "pes_" + token();
      await ctx.runMutation(internal.store.write, { tokenHash, op: args.op, data: { name: data.name, allowedProjectIds, allowedEnvironments, newTokenHash: await sha256(issuedToken) } });
      return { token: issuedToken };
    }
    const allowed = ["project.create", "project.update", "project.delete", "variable.delete", "client.revoke"];
    if (!allowed.includes(args.op)) throw new Error("Unknown operation");
    if (args.op === "variable.delete") {
      if (!validKey(data.key)) throw new Error("Invalid key");
      data.scope = requireScope(data.scope);
    }
    return ctx.runMutation(internal.store.write, { tokenHash, op: args.op, data });
}