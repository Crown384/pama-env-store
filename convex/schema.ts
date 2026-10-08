import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(), slug: v.string(), description: v.optional(v.string()),
    enabled: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
  variables: defineTable({
    projectId: v.id("projects"), scope: v.union(v.literal("shared"), v.literal("staging"), v.literal("production")),
    key: v.string(), encryptedValue: v.string(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_project_scope_key", ["projectId", "scope", "key"]),
  sessions: defineTable({ tokenHash: v.string(), createdAt: v.number(), expiresAt: v.number() }).index("by_hash", ["tokenHash"]),
  machineClients: defineTable({
    name: v.string(), tokenHash: v.string(), enabled: v.boolean(),
    allowedProjectIds: v.array(v.id("projects")),
    allowedEnvironments: v.array(v.union(v.literal("staging"), v.literal("production"))),
    createdAt: v.number(), lastUsedAt: v.optional(v.number()),
  }).index("by_hash", ["tokenHash"]),
  auditEvents: defineTable({
    actor: v.string(), action: v.string(), projectId: v.optional(v.id("projects")),
    scope: v.optional(v.string()), key: v.optional(v.string()), at: v.number(),
  }).index("by_at", ["at"]),
  loginAttempts: defineTable({
    identityHash: v.string(), count: v.number(), startedAt: v.number(), blockedUntil: v.number(),
  }).index("by_identity", ["identityHash"]),
});