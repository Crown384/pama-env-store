import { v } from "convex/values";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const now = () => Date.now();
const denied = () => { throw new Error("Not authorized"); };
type Scope = "shared" | "staging" | "production";
function validSlug(slug: string) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64; }
function validKey(key: string) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && key.length <= 128; }

export const canAttempt = internalQuery({
  args: { identityHash: v.string() },
  handler: async (ctx, { identityHash }) => {
    const row = await ctx.db.query("loginAttempts").withIndex("by_identity", q => q.eq("identityHash", identityHash)).unique();
    return !row || row.blockedUntil < now();
  },
});

export const recordAttempt = internalMutation({
  args: { identityHash: v.string(), success: v.boolean(), tokenHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const time = now();
    const old = await ctx.db.query("loginAttempts").withIndex("by_identity", q => q.eq("identityHash", args.identityHash)).unique();
    // The lockout is rechecked inside this transaction to stop simultaneous logins bypassing it.
    if (old && old.blockedUntil >= time) return false;
    if (!args.success) {
      const inWindow = !!old && time - old.startedAt < 15 * 60_000;
      const count = inWindow ? old.count + 1 : 1;
      const next = { count, startedAt: inWindow ? old.startedAt : time, blockedUntil: count >= 5 ? time + 15 * 60_000 : 0 };
      if (old) await ctx.db.patch(old._id, next);
      else await ctx.db.insert("loginAttempts", { identityHash: args.identityHash, ...next });
      return false;
    }
    if (!args.tokenHash) return false;
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("sessions", { tokenHash: args.tokenHash, createdAt: time, expiresAt: time + 6 * 60 * 60_000 });
    await ctx.db.insert("auditEvents", { actor: "admin", action: "admin.login", at: time });
    return true;
  },
});

export const readAdmin = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("sessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.expiresAt <= now()) return denied();
    const [projects, variables, clients, audits] = await Promise.all([
      ctx.db.query("projects").collect(),
      ctx.db.query("variables").collect(),
      ctx.db.query("machineClients").collect(),
      ctx.db.query("auditEvents").withIndex("by_at").order("desc").take(100),
    ]);
    return { projects, variables, clients, audits, expiresAt: session.expiresAt };
  },
});

export const logout = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db.query("sessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
    if (session) { await ctx.db.delete(session._id); await ctx.db.insert("auditEvents", { actor: "admin", action: "admin.logout", at: now() }); }
  },
});

export const write = internalMutation({
  args: { tokenHash: v.string(), op: v.string(), data: v.any() },
  handler: async (ctx, { tokenHash, op, data }) => {
    const session = await ctx.db.query("sessions").withIndex("by_hash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!session || session.expiresAt <= now()) return denied();
    const at = now();
    const projectId = data.projectId as Id<"projects"> | undefined;
    const scope = data.scope as Scope | undefined;
    const key = data.key as string | undefined;
    const audit = async (action: string, pid?: Id<"projects">) => {
      await ctx.db.insert("auditEvents", { actor: "admin", action, projectId: pid, scope, key, at });
    };
    if (op === "project.create") {
      if (typeof data.name !== "string" || data.name.trim().length < 2 || data.name.length > 100 || !validSlug(data.slug)) throw new Error("Invalid project");
      const exists = await ctx.db.query("projects").withIndex("by_slug", q => q.eq("slug", data.slug)).unique();
      if (exists) throw new Error("Project slug already exists");
      const id = await ctx.db.insert("projects", { name: data.name.trim(), slug: data.slug, description: data.description?.slice(0, 500), enabled: true, createdAt: at, updatedAt: at });
      await audit(op, id); return { ok: true };
    }
    if (op === "project.update" || op === "project.delete") {
      if (!projectId) throw new Error("Project required");
      const project = await ctx.db.get(projectId);
      if (!project) throw new Error("Project missing");
      if (op === "project.delete") {
        for (const item of await ctx.db.query("variables").withIndex("by_project", q => q.eq("projectId", projectId)).collect()) await ctx.db.delete(item._id);
        // Remove access to a deleted project from all machine clients.
        for (const client of await ctx.db.query("machineClients").collect()) {
          if (client.allowedProjectIds.includes(projectId)) await ctx.db.patch(client._id, { allowedProjectIds: client.allowedProjectIds.filter(id => id !== projectId) });
        }
        await ctx.db.delete(projectId);
      } else {
        if (data.name !== undefined && (typeof data.name !== "string" || data.name.trim().length < 2 || data.name.length > 100)) throw new Error("Invalid name");
        if (data.description !== undefined && (typeof data.description !== "string" || data.description.length > 500)) throw new Error("Invalid description");
        if (data.enabled !== undefined && typeof data.enabled !== "boolean") throw new Error("Invalid status");
        await ctx.db.patch(projectId, {
          name: data.name === undefined ? project.name : data.name.trim(),
          description: data.description === undefined ? project.description : data.description,
          enabled: data.enabled === undefined ? project.enabled : data.enabled, updatedAt: at,
        });
      }
      await audit(op, projectId); return { ok: true };
    }
    if (op === "variable.set" || op === "variable.delete" || op === "variable.import") {
      if (!projectId || !await ctx.db.get(projectId)) throw new Error("Project missing");
      if (!["shared", "staging", "production"].includes(scope ?? "")) throw new Error("Invalid scope");
      if (op === "variable.import") {
        const entries = data.entries as Array<{ key: string; encryptedValue: string }>;
        if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100 || new Set(entries.map(e => e.key)).size !== entries.length) throw new Error("Invalid import");
        for (const entry of entries) {
          if (!validKey(entry.key) || typeof entry.encryptedValue !== "string" || entry.encryptedValue.length > 50_000) throw new Error("Invalid import entry");
        }
        for (const entry of entries) {
          const old = await ctx.db.query("variables").withIndex("by_project_scope_key", q => q.eq("projectId", projectId).eq("scope", scope!).eq("key", entry.key)).unique();
          if (old) await ctx.db.patch(old._id, { encryptedValue: entry.encryptedValue, updatedAt: at });
          else await ctx.db.insert("variables", { projectId, scope: scope!, key: entry.key, encryptedValue: entry.encryptedValue, createdAt: at, updatedAt: at });
        }
        await audit(op, projectId); return { ok: true, imported: entries.length };
      }
      if (!validKey(key ?? "")) throw new Error("Invalid variable key");
      const old = await ctx.db.query("variables").withIndex("by_project_scope_key", q => q.eq("projectId", projectId).eq("scope", scope!).eq("key", key!)).unique();
      if (op === "variable.delete") {
        if (old) await ctx.db.delete(old._id);
      } else {
        if (typeof data.encryptedValue !== "string" || data.encryptedValue.length > 50_000) throw new Error("Invalid value");
        if (old) await ctx.db.patch(old._id, { encryptedValue: data.encryptedValue, updatedAt: at });
        else await ctx.db.insert("variables", { projectId, scope: scope!, key: key!, encryptedValue: data.encryptedValue, createdAt: at, updatedAt: at });
      }
      await audit(op, projectId); return { ok: true };
    }
    if (op === "client.create") {
      if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 100) throw new Error("Invalid client name");
      if (!Array.isArray(data.allowedProjectIds) || !data.allowedProjectIds.length || !Array.isArray(data.allowedEnvironments) || !data.allowedEnvironments.length) throw new Error("Client scope required");
      if (!data.allowedEnvironments.every((item: string) => item === "staging" || item === "production")) throw new Error("Invalid environment");
      const ids = [...new Set(data.allowedProjectIds)] as Id<"projects">[];
      for (const id of ids) if (!await ctx.db.get(id)) throw new Error("Invalid project permission");
      await ctx.db.insert("machineClients", { name: data.name.trim(), tokenHash: data.newTokenHash, enabled: true, allowedProjectIds: ids, allowedEnvironments: [...new Set(data.allowedEnvironments)] as Array<"staging" | "production">, createdAt: at });
      await audit(op); return { ok: true };
    }
    if (op === "client.revoke") {
      const client = await ctx.db.get(data.clientId as Id<"machineClients">);
      if (!client) throw new Error("Client not found");
      await ctx.db.patch(client._id, { enabled: false });
      await audit(op); return { ok: true };
    }
    throw new Error("Unsupported operation");
  },
});

export const readMachine = internalQuery({
  args: { tokenHash: v.string(), slug: v.optional(v.string()), environment: v.optional(v.union(v.literal("staging"), v.literal("production"))) },
  handler: async (ctx, args) => {
    const client = await ctx.db.query("machineClients").withIndex("by_hash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!client || !client.enabled) return denied();
    if (!args.slug) {
      const authorized = [];
      for (const id of client.allowedProjectIds) {
        const project = await ctx.db.get(id);
        if (project?.enabled) authorized.push({ name: project.name, slug: project.slug, environments: client.allowedEnvironments });
      }
      return { clientId: client._id, projects: authorized, project: null, variables: [] };
    }
    const project = await ctx.db.query("projects").withIndex("by_slug", q => q.eq("slug", args.slug!)).unique();
    if (!project?.enabled || !client.allowedProjectIds.includes(project._id)) return denied();
    if (args.environment && !client.allowedEnvironments.includes(args.environment)) return denied();
    const variables = args.environment ? await ctx.db.query("variables").withIndex("by_project", q => q.eq("projectId", project._id)).collect() : [];
    return { clientId: client._id, projectId: project._id, projects: [], project: { name: project.name, slug: project.slug, environments: client.allowedEnvironments }, variables };
  },
});

export const logAccess = internalMutation({
  args: { tokenHash: v.optional(v.string()), adminTokenHash: v.optional(v.string()), action: v.string(), projectId: v.optional(v.id("projects")), scope: v.optional(v.string()), key: v.optional(v.string()) },
  handler: async (ctx, args) => {
    let actor = "admin";
    if (args.tokenHash) {
      const client = await ctx.db.query("machineClients").withIndex("by_hash", q => q.eq("tokenHash", args.tokenHash!)).unique();
      if (!client?.enabled) return denied();
      if (args.projectId && !client.allowedProjectIds.includes(args.projectId)) return denied();
      if (args.scope && (args.scope !== "staging" && args.scope !== "production" || !client.allowedEnvironments.includes(args.scope))) return denied();
      actor = "machine:" + client.name;
      await ctx.db.patch(client._id, { lastUsedAt: now() });
    } else if (args.adminTokenHash) {
      const session = await ctx.db.query("sessions").withIndex("by_hash", q => q.eq("tokenHash", args.adminTokenHash!)).unique();
      if (!session || session.expiresAt <= now()) return denied();
    } else return denied();
    await ctx.db.insert("auditEvents", { actor, action: args.action, projectId: args.projectId, scope: args.scope, key: args.key, at: now() });
  },
});