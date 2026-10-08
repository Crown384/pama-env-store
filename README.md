# Pama Env Store

Pama Env Store is an internal Pama infrastructure tool for centrally managing environment variables and deployment configuration for Pama's Convex-based projects.

Its purpose is to become the trusted source of truth for project configuration so Pama's development agents, sandboxes, MCP servers, and other automation do not need credentials copied into every workflow manually.

The first two machine consumers are expected to be:

- the Daytona development agent/sandbox workflow;
- the separate Convex MCP server used to work across Pama projects.

This is not a public secrets manager or a customer-facing product. It is a small, private operational tool for Pama.

---

## Core concept

Every project has three variable scopes:

1. **Shared** — values that apply to both staging and production.
2. **Staging** — values used only for the staging environment.
3. **Production** — values used only for the production environment.

When a trusted client requests an environment, Pama Env Store resolves the final configuration by combining Shared with the requested environment.

~~~text
Pamastore

Shared
  CLOUDINARY_CLOUD_NAME=...
  MAILJET_FROM_EMAIL=...

Staging
  CONVEX_URL=...
  CONVEX_DEPLOY_KEY=...
  NEXT_PUBLIC_APP_URL=...

Production
  CONVEX_URL=...
  CONVEX_DEPLOY_KEY=...
  NEXT_PUBLIC_APP_URL=...
~~~

A staging request resolves to:

~~~text
Shared + Staging
~~~

A production request resolves to:

~~~text
Shared + Production
~~~

If a key exists in Shared and also in the requested environment, the environment-specific value wins.

There is no inheritance between Staging and Production.

---

## Why this exists

Pama has multiple Convex projects and internal developer tools. Development agents often need the correct environment configuration before they can build, run, debug, validate, or deploy a project.

Without a central system, environment values must be copied manually, duplicated across machines, or separately configured in each automation service. That creates friction and makes it easier to use the wrong environment or leak sensitive credentials.

The intended workflow is:

~~~text
Agent receives a repository
        ↓
Agent identifies the project
        ↓
Agent requests staging or production configuration
        ↓
Pama Env Store authenticates the client
        ↓
Shared + requested environment values are resolved
        ↓
Only authorized configuration is returned
        ↓
Agent performs its work
~~~

Pama Env Store is therefore both:

- an **admin dashboard** for managing projects and environment variables; and
- a **secure machine-facing service** for trusted Pama automation.

---

## Main use cases

### Manage projects

The admin can create and manage projects such as Pamastore, Track, Meherah, Vasta, Eden CRM, PamaOS, and future Pama projects.

Each project should have a stable name and slug.

Example:

~~~text
Name: Pamastore
Slug: pamastore
~~~

The slug should be safe to use in APIs, MCP tools, and automation.

### Manage Shared variables

Variables used by both staging and production should be stored once under Shared rather than duplicated.

### Manage Staging variables

Each project should have a separate staging scope for staging credentials, URLs, deploy keys, and configuration.

### Manage Production variables

Each project should also have a separate production scope. Production must be clearly distinguished from staging in the UI and in machine APIs.

### Resolve an environment

Trusted clients should be able to request a resolved environment.

Conceptually:

~~~text
resolve("pamastore", "staging")
→ shared variables + staging variables

resolve("pamastore", "production")
→ shared variables + production variables
~~~

The result should be easy for automation to consume as a key/value object and, where useful, dotenv-compatible text.

### Support trusted automation

The architecture must support Daytona and the separate Convex MCP server first, while making it easy to add other trusted clients later.

---

## Authentication

The website does **not** need Clerk, Auth0, social login, public registration, or a full account system.

This is an internal single-admin tool.

The admin password must be stored as a **Convex environment variable**, for example:

~~~text
ADMIN_PASSWORD
~~~

The password must never be committed to source control, stored in the application database, or sent to the browser for client-side comparison.

Expected flow:

~~~text
Admin opens website
      ↓
Enters password
      ↓
Server/Convex verifies it against ADMIN_PASSWORD
      ↓
A secure authenticated session is created
      ↓
Admin can access the dashboard
~~~

Use a secure HTTP-only session/cookie mechanism with automatic expiry and explicit logout.

Do not build signup, password reset, email confirmation, organizations, teams, or user profiles unless the product requirements change later.

If additional cryptographic or session secrets are required, keep them server-side and preferably in Convex environment configuration as well. Never expose them through NEXT_PUBLIC variables.

---

## Security requirements

This application will hold sensitive credentials and must be treated as security-sensitive infrastructure.

### Keep secrets server-side

Environment values must not be embedded into client bundles or exposed through public Convex queries.

The browser should only receive secret material when the authenticated admin explicitly performs an action that requires it, such as revealing or copying a value.

### Encrypt stored values

Secret values persisted in Convex should be encrypted before storage.

The encryption key must be stored separately in server-side environment configuration, not in the same database records as the ciphertext.

The database should contain ciphertext rather than raw project credentials.

### Mask values by default

The dashboard should display values masked by default.

~~~text
CONVEX_DEPLOY_KEY    ••••••••••••••••
~~~

The admin can deliberately reveal or copy a value.

### Never log plaintext secrets

Application logs, audit records, error messages, analytics, and server logs must never contain raw secret values.

### Authenticate machine access

Daytona, the Convex MCP server, and future clients must authenticate before retrieving environment data.

There must never be an unauthenticated endpoint that returns project secrets.

Machine credentials should be revocable and should be stored hashed where possible.

### Minimize permissions

The design should allow machine clients to be limited by project and environment.

For example, a client could eventually be authorized for:

~~~text
pamastore:staging
track:staging
~~~

without receiving production secrets or unrelated projects.

### Make production intentional

Actions involving production configuration should be visually and logically distinct from staging.

Never silently fall back from staging to production or production to staging.

---

## Suggested data model

The exact Convex schema may evolve, but these concepts should exist clearly.

### Projects

Suggested fields:

~~~text
name
slug
description?
enabled
createdAt
updatedAt
~~~

### Environment variables

A variable belongs to one project and one scope:

~~~text
shared
staging
production
~~~

Suggested fields:

~~~text
projectId
key
encryptedValue
scope
createdAt
updatedAt
~~~

A project should not have duplicate keys in the same scope.

### Machine clients

Represents trusted automation such as Daytona or the Convex MCP server.

Suggested fields:

~~~text
name
tokenHash
enabled
allowedProjects
allowedEnvironments
createdAt
lastUsedAt?
~~~

Do not store reusable machine access tokens in plaintext after issuance if the implementation can avoid it.

### Audit events

Security-sensitive actions should be auditable without storing actual secret values.

Examples:

~~~text
project.created
variable.created
variable.updated
variable.deleted
variable.revealed
environment.exported
machine_client.created
machine_client.revoked
machine_client.environment_accessed
~~~

Audit records may store the project, environment, variable key, actor/client, action, and timestamp, but never the secret value.

---

## Admin dashboard

The dashboard should be simple and operational rather than a marketing site.

A useful first structure is:

~~~text
Login

Dashboard
  ├── Projects
  │     └── Project
  │           ├── Shared
  │           ├── Staging
  │           └── Production
  │
  ├── Machine Clients / API Access
  │
  └── Audit Log
~~~

### Project screen

Opening a project should make the three scopes immediately understandable.

A tab or segmented-control interface is appropriate:

~~~text
[ Shared ] [ Staging ] [ Production ]
~~~

For each scope, the admin should be able to add, edit, delete, reveal, and copy values; search/filter keys; import dotenv text; and export the selected resolved environment when appropriate.

Production should have a stronger visual warning than Shared or Staging.

### Creating a variable

At minimum:

~~~text
Key
Value
Scope
~~~

Keys should be validated as environment-variable names.

### Bulk dotenv import

The admin should be able to paste:

~~~dotenv
CONVEX_URL=...
CONVEX_DEPLOY_KEY=...
CLOUDINARY_URL=...
~~~

and import the values into Shared, Staging, or Production.

The UI should preview what will be created or overwritten before applying the import.

---

## Environment resolution rules

Resolution must be deterministic.

For staging:

~~~text
resolved staging = shared + staging
~~~

For production:

~~~text
resolved production = shared + production
~~~

Environment-specific values override Shared values when keys collide.

Example:

~~~text
Shared:
API_TIMEOUT=30
CLOUDINARY_CLOUD_NAME=pama

Staging:
API_TIMEOUT=60
CONVEX_URL=https://staging.example

Resolved staging:
API_TIMEOUT=60
CLOUDINARY_CLOUD_NAME=pama
CONVEX_URL=https://staging.example
~~~

There must be no implicit inheritance between staging and production.

---

## Machine-facing API

The application should expose a secure server-side API that trusted automation can call.

The exact route structure may change, but the service needs operations equivalent to:

- list projects available to the authenticated machine client;
- get project metadata;
- get a resolved staging environment;
- get a resolved production environment;
- get a specific authorized environment key.

A possible HTTP shape is:

~~~text
GET /api/projects
GET /api/projects/:slug/env/staging
GET /api/projects/:slug/env/production
GET /api/projects/:slug/env/staging/:key
~~~

These exact route names are not mandatory. Prefer a clean Next.js App Router implementation.

Responses containing secrets must not be stored by public/shared caches. Use no-store and appropriate cache-control behavior.

---

## MCP support

Pama Env Store should be designed so it can either expose an MCP endpoint later or act as the secure configuration source used by the separate Convex MCP server.

The underlying backend operations should therefore be reusable.

Useful MCP-style operations could include:

~~~text
list_projects
get_project
list_environment_keys
get_environment_value
get_resolved_environment
~~~

Potential write operations could include:

~~~text
set_environment_value
delete_environment_value
import_environment
~~~

Write operations are more sensitive and should only be available to explicitly authorized machine clients.

Do not duplicate authorization, decryption, or environment-resolution logic between the website, HTTP API, and MCP layer. Keep that logic centralized on the backend.

---

## Daytona integration

The intended Daytona flow is:

~~~text
Daytona starts a sandbox for a Pama repository
        ↓
The agent knows or determines the Env Store project slug
        ↓
The agent authenticates to Pama Env Store
        ↓
It requests the required environment, normally staging
        ↓
Pama Env Store resolves Shared + Staging
        ↓
The environment is injected into the sandbox/process
        ↓
The agent can build, run, debug, validate, or deploy
~~~

Production access must not be assumed merely because Daytona can access staging.

The integration should make staging-only Daytona access possible.

---

## Convex MCP integration

Pama intends to run a separate MCP server for working across Convex projects.

That MCP service should obtain project credentials/configuration from Pama Env Store instead of hardcoding every project's credentials into the MCP server itself.

Conceptually:

~~~text
Convex MCP receives a request for Track
        ↓
Convex MCP requests Track staging configuration
        ↓
Pama Env Store authenticates the MCP client
        ↓
Authorized Shared + Staging values are returned
        ↓
Convex MCP uses them for the requested operation
~~~

This keeps configuration centralized and allows credentials to be rotated in one place.

---

## Technology

This repository intentionally starts from the minimal official Convex + Next.js template.

Primary stack:

- **Next.js App Router**
- **React**
- **TypeScript**
- **Tailwind CSS v4**
- **Convex**

Do not introduce a full authentication provider for the initial version.

Keep the application small and understandable. Add dependencies only when they materially improve security or maintainability.

---

## MVP definition

The first usable version should be able to:

1. authenticate the admin using the password stored in Convex environment configuration;
2. create, edit, disable, and delete project records;
3. manage Shared, Staging, and Production environment variables per project;
4. encrypt stored secret values;
5. mask values in the UI by default;
6. resolve Shared + Staging and Shared + Production deterministically;
7. import dotenv-formatted variables;
8. copy/export a resolved environment;
9. create and revoke machine access credentials;
10. securely expose resolved project environments to authenticated machine clients;
11. support the Daytona and separate Convex MCP use cases without hardcoding project credentials into those clients;
12. record useful audit events without recording plaintext secrets.

The MVP must be genuinely usable, not merely a UI mockup.

---

## Non-goals for the initial version

Do not spend MVP time building:

- public signup;
- multi-user accounts;
- organizations/workspaces;
- social login;
- billing;
- customer-facing features;
- email verification;
- password reset;
- complicated RBAC;
- a general-purpose replacement for 1Password, Doppler, Vault, or similar products.

This tool exists to solve Pama's internal workflow first.

---

## Implementation rules

- Never commit real credentials to this repository.
- Never put project secrets into NEXT_PUBLIC variables.
- Never compare the admin password purely in the browser.
- Never expose all secrets through an unauthenticated/public Convex function.
- Never store plaintext secret values in audit logs.
- Never blur the boundary between staging and production.
- Centralize authorization checks.
- Centralize environment-resolution logic.
- Treat machine credentials separately from the admin login password.
- Require explicit authorization for production machine access.
- Prefer secure defaults: masked values, short-lived sessions, no public caching, and minimal permissions.

---

## Agent handoff

If you are an implementation agent receiving this repository, treat this README as the product and architecture brief.

Before building:

1. inspect the current repository and preserve the clean Next.js + Convex foundation;
2. design the Convex schema and secure secret-storage approach;
3. implement password-based admin access without adding an unnecessary auth provider;
4. build the project/environment management backend before wiring the final UI;
5. make the same backend authorization and environment-resolution logic reusable by the website and machine integrations;
6. verify that secrets cannot leak through client bundles, logs, unauthenticated Convex functions, or cached API responses;
7. implement a complete usable MVP rather than stopping after scaffolding.

When a technical choice is not specified here, prefer the simplest secure design that is easy for future Pama agents to operate and understand.

---

## Development

This repository was forked from the official Convex Next.js template.

Install dependencies and use the repository's existing scripts. Before connecting a new Convex deployment, make sure the correct Pama Convex project/deployment is selected.

Do not place real production credentials in example files. Documentation and fixtures must use placeholders.

---

## Summary

**Pama Env Store is the central source of truth for environment configuration used by Pama's Convex projects and trusted development automation.**

Its job is to answer one question safely and consistently:

> For this Pama project, and for this environment, what configuration is the authorized tool allowed to use?

The admin website manages the answer. Convex securely stores and serves it. Daytona, the Convex MCP server, and future Pama automation consume it.
