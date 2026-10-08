"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownToLine, ArrowRight, Check, CheckCircle2,
  ChevronRight, ClipboardCopy, Copy, Database, Eye, EyeOff, FileCode2,
  FolderClosed, KeyRound, Layers3, LockKeyhole, LogOut, Menu, Plus, RefreshCw,
  Search, Settings2, ShieldAlert, ShieldCheck, Terminal, Trash2, Upload, X,
} from "lucide-react";
import { downloadEnv, parseDotenv } from "@/lib/dotenv";

type Scope = "shared" | "staging" | "production";
type View = "projects" | "access" | "audit";
type Project = { _id: string; name: string; slug: string; description?: string; enabled: boolean; createdAt: number; updatedAt: number };
type Variable = { _id: string; projectId: string; scope: Scope; key: string; createdAt: number; updatedAt: number };
type MachineClient = { _id: string; name: string; enabled: boolean; allowedProjectIds: string[]; allowedEnvironments: Array<"staging" | "production">; createdAt: number; lastUsedAt?: number };
type Audit = { _id: string; action: string; actor: string; projectId?: string; scope?: string; key?: string; at: number };
type Snapshot = { projects: Project[]; variables: Variable[]; clients: MachineClient[]; audits: Audit[]; expiresAt: number };
type Modal = "project" | "editProject" | "variable" | "import" | "export" | "client" | "issued" | "deleteProject" | null;

const scopes: { id: Scope; label: string; hint: string }[] = [
  { id: "shared", label: "Shared", hint: "Both environments" },
  { id: "staging", label: "Staging", hint: "Development & QA" },
  { id: "production", label: "Production", hint: "Live infrastructure" },
];
const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const solid = button + " bg-emerald-600 text-white hover:bg-emerald-700";
const light = button + " border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
const field = "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";
const label = "mb-1.5 block text-xs font-semibold text-slate-600";
const timestamp = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

function SmallPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  const colors = { neutral: "bg-slate-100 text-slate-600", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", red: "bg-red-50 text-red-700" };
  return <span className={"inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold " + colors[tone]}>{children}</span>;
}
function Empty({ icon: Icon, title, detail, action }: { icon: typeof FolderClosed; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
    <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Icon size={21} /></div>
    <h3 className="font-semibold text-slate-900">{title}</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{detail}</p>
    {action && <div className="mt-5">{action}</div>}
  </div>;
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [view, setView] = useState<View>("projects");
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState<Scope>("shared");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [selectedVar, setSelectedVar] = useState<Variable | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [importText, setImportText] = useState("");
  const [exportEnvironment, setExportEnvironment] = useState<"staging" | "production">("staging");
  const [clientName, setClientName] = useState("");
  const [clientProjects, setClientProjects] = useState<string[]>([]);
  const [clientEnvs, setClientEnvs] = useState<Array<"staging" | "production">>(["staging"]);
  const [issuedToken, setIssuedToken] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin", { cache: "no-store" });
    if (!response.ok) { setSnapshot(null); return; }
    const next = await response.json() as Snapshot;
    setSnapshot(next);
    setProjectId(previous => next.projects.some(p => p._id === previous) ? previous : (next.projects[0]?._id ?? ""));
  }, []);

  useEffect(() => { refresh().catch(() => setSnapshot(null)).finally(() => setLoading(false)); }, [refresh]);
  const project = snapshot?.projects.find(p => p._id === projectId) ?? null;
  const projectVariables = useMemo(() => snapshot?.variables.filter(item => item.projectId === projectId) ?? [], [snapshot, projectId]);
  const visibleVariables = useMemo(() => projectVariables.filter(item => item.scope === scope && item.key.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.key.localeCompare(b.key)), [projectVariables, scope, search]);
  const scopeCount = (s: Scope) => projectVariables.filter(item => item.scope === s).length;
  const parsedImport = useMemo(() => {
    try { return { entries: parseDotenv(importText), error: "" }; }
    catch (e) { return { entries: [], error: e instanceof Error ? e.message : "Invalid dotenv text" }; }
  }, [importText]);
  const importPreview = parsedImport.entries.map(item => ({ key: item.key, exists: projectVariables.some(v => v.scope === scope && v.key === item.key) }));
  const inModal = Boolean(modal);

  async function post(op: string, data?: unknown) {
    const response = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, data }), cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Action failed");
    return result;
  }
  async function perform(op: string, data?: unknown, success = "Changes saved") {
    setBusy(true); setError("");
    try {
      const result = await post(op, data);
      await refresh();
      setModal(null); setNotice(success);
      setRevealed({});
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally { setBusy(false); }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setLoggingIn(true); setLoginError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", password }) });
      if (!response.ok) throw new Error("Incorrect password or temporarily locked out");
      setPassword(""); await refresh();
    } catch (e) { setLoginError(e instanceof Error ? e.message : "Sign-in failed"); }
    finally { setLoggingIn(false); }
  }
  async function logout() {
    try { await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); }
    finally { setSnapshot(null); setRevealed({}); setIssuedToken(""); }
  }
  async function reveal(item: Variable, copy = false) {
    const id = item.scope + ":" + item.key;
    if (!copy && revealed[id] !== undefined) { setRevealed(current => { const next = { ...current }; delete next[id]; return next; }); return; }
    setError("");
    try {
      const result = await post("variable.reveal", { projectId, scope: item.scope, key: item.key }) as { value: string };
      if (copy) { await navigator.clipboard.writeText(result.value); setNotice("Value copied to clipboard"); }
      else setRevealed(current => ({ ...current, [id]: result.value }));
    } catch { setError("Unable to reveal or copy the value."); }
  }
  const openModal = (m: Modal) => { setError(""); setNotice(""); setModal(m); };
  function openProject() { setProjectName(""); setProjectSlug(""); setProjectDescription(""); openModal("project"); }
  function editProject() {
    setProjectName(project?.name ?? ""); setProjectSlug(project?.slug ?? "");
    setProjectDescription(project?.description ?? ""); openModal("editProject");
  }
  function openVariable(item?: Variable) {
    setSelectedVar(item ?? null); setKey(item?.key ?? ""); setValue(""); openModal("variable");
  }
  async function exportEnv(format: "copy" | "download") {
    if (!project) return;
    setBusy(true); setError("");
    try {
      const result = await post("environment.export", { projectId, environment: exportEnvironment }) as { values: Record<string, string> };
      if (format === "download") downloadEnv(project.slug + "." + exportEnvironment, result.values);
      else {
        const source = Object.entries(result.values).map(([k, v]) => k + "=\"" + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + "\"").join("\n");
        await navigator.clipboard.writeText(source);
      }
      setModal(null); setNotice(format === "copy" ? "Environment copied" : "Environment downloaded");
    } catch { setError("Could not export environment."); }
    finally { setBusy(false); }
  }
  async function createClient() {
    if (!clientName.trim() || !clientProjects.length || !clientEnvs.length) { setError("Choose a name, projects, and at least one environment."); return; }
    setBusy(true); setError("");
    try {
      const result = await post("client.create", { name: clientName.trim(), allowedProjectIds: clientProjects, allowedEnvironments: clientEnvs }) as { token: string };
      await refresh(); setIssuedToken(result.token); setModal("issued"); setNotice("");
    } catch { setError("Could not create the machine credential."); }
    finally { setBusy(false); }
  }
  const nav = [
    { id: "projects" as View, title: "Projects", icon: FolderClosed },
    { id: "access" as View, title: "Machine access", icon: KeyRound },
    { id: "audit" as View, title: "Audit log", icon: Activity },
  ];
  const selectView = (next: View) => { setView(next); setMobileMenu(false); setError(""); setRevealed({}); };

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-[#f8fafb] text-slate-500"><RefreshCw className="animate-spin text-emerald-600" size={24} /><span className="ml-3 text-sm">Connecting to Env Store...</span></div>;

  if (!snapshot) return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7faf8] px-5">
    <div className="pointer-events-none absolute -left-44 -top-44 size-[540px] rounded-full bg-emerald-100/50 blur-[100px]" />
    <div className="pointer-events-none absolute -bottom-60 -right-40 size-[600px] rounded-full bg-teal-100/60 blur-[110px]" />
    <div className="relative z-10 w-full max-w-md">
      <div className="mb-8 flex justify-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-[#113b32] text-white shadow-xl shadow-emerald-950/15"><LockKeyhole size={25} strokeWidth={1.7}/></div></div>
      <div className="rounded-[28px] border border-white bg-white p-8 shadow-2xl shadow-slate-900/5 sm:p-10">
        <div className="mb-1 flex items-center justify-center gap-2"><div className="size-2 rounded-full bg-emerald-500"/><span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Pama infrastructure</span></div>
        <h1 className="mt-5 text-center text-3xl font-semibold tracking-tight text-[#132c26]">Welcome back.</h1>
        <p className="mt-3 text-center text-sm leading-6 text-slate-500">Your projects. Your environments. One secure place.</p>
        <form onSubmit={login} className="mt-9 space-y-5">
          <div><label htmlFor="password" className={label}>Admin password</label><input id="password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} className={field} placeholder="Enter your password"/></div>
          {loginError && <div role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={15}/>{loginError}</div>}
          <button type="submit" disabled={loggingIn} className={solid + " w-full py-3.5"}>{loggingIn ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16}/>} Access dashboard</button>
        </form>
        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400"><ShieldCheck size={15}/> Encrypted storage · Session protected</p>
      </div>
      <p className="mt-8 text-center text-xs text-slate-400">Private Pama infrastructure · Authorized access only</p>
    </div>
  </main>;

  return <div className="min-h-screen bg-[#f8fafb] text-slate-900">
    <div className="flex min-h-screen">
      <aside className={(mobileMenu ? "fixed inset-y-0 left-0 z-40 flex " : "hidden ") + "w-[268px] shrink-0 flex-col bg-[#112d27] px-4 pb-6 pt-7 text-white lg:sticky lg:top-0 lg:flex lg:h-screen"}>
        <div className="mb-11 flex items-center gap-3 px-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400 text-[#102b24]"><Layers3 size={23} strokeWidth={2.5}/></div>
          <div><div className="text-base font-bold tracking-tight">pama<span className="font-normal text-emerald-300">/env</span></div><div className="text-[10px] uppercase tracking-[0.22em] text-emerald-200/60">Infrastructure</div></div>
          <button className="ml-auto lg:hidden" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={20}/></button>
        </div>
        <div className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/40">Workspace</div>
        <nav className="space-y-1" aria-label="Main navigation">{nav.map(item => {
          const Icon = item.icon; return <button key={item.id} onClick={() => selectView(item.id)} className={"flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition " + (view === item.id ? "bg-white/12 font-semibold text-white" : "text-emerald-100/70 hover:bg-white/5 hover:text-white")}><Icon size={18} />{item.title}{item.id === "projects" && <span className="ml-auto rounded-md bg-white/10 px-2 py-0.5 text-xs">{snapshot.projects.length}</span>}</button>;
        })}</nav>
        <div className="mt-9 mb-2 px-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/40">Security</div>
        <div className="mx-2 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-100"><ShieldCheck size={15} className="text-emerald-300"/> Vault protected</div>
          <p className="mt-2 text-xs leading-5 text-emerald-100/50">Values are encrypted and never shown by default.</p>
          <div className="mt-4 h-1 rounded-full bg-white/10"><div className="h-1 w-3/4 rounded-full bg-emerald-400"/></div>
        </div>
        <div className="mt-auto border-t border-white/10 pt-5">
          <div className="mb-4 flex items-center gap-3 px-3"><div className="flex size-9 items-center justify-center rounded-full bg-emerald-200 text-xs font-bold text-[#112d27]">PA</div><div className="flex-1"><p className="text-sm font-semibold">Pama Admin</p><p className="text-[11px] text-emerald-100/50">Private workspace</p></div></div>
          <button className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-emerald-100/70 hover:bg-white/10" onClick={logout}><LogOut size={17}/> Sign out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[74px] items-center justify-between border-b border-slate-200/70 bg-white/95 px-5 backdrop-blur-xl sm:px-8 lg:px-10">
          <div className="flex items-center gap-4"><button className="text-slate-700 lg:hidden" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={22}/></button><span className="text-sm font-medium text-slate-400">Workspace</span><ChevronRight size={15} className="text-slate-300"/><span className="text-sm font-semibold text-slate-800">{view === "projects" ? "Projects" : view === "access" ? "Machine access" : "Audit log"}</span></div>
          <div className="flex items-center gap-3"><SmallPill tone="green"><span className="size-1.5 rounded-full bg-emerald-500"/> Secure session</SmallPill><button onClick={() => refresh().catch(() => setError("Could not refresh dashboard"))} className="flex size-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" title="Refresh"><RefreshCw size={17}/></button></div>
        </header>
        <main className="mx-auto max-w-[1500px] px-5 pb-20 pt-9 sm:px-8 lg:px-10">
          {(notice || error) && <div role="status" className={"mb-6 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm " + (error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800")}><span className="flex items-center gap-2">{error ? <AlertCircle size={17}/> : <CheckCircle2 size={17}/ >}{error || notice}</span><button aria-label="Dismiss" onClick={() => { setError(""); setNotice(""); }}><X size={16}/></button></div>}
          {view === "projects" && <>
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Overview</div><h1 className="text-3xl font-semibold tracking-tight text-[#152d27]">Environment store</h1><p className="mt-2 text-sm text-slate-500">Manage your projects and configuration from one secure workspace.</p></div>
              <button className={solid} onClick={openProject}><Plus size={17}/> New project</button>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                { name: "Total projects", count: snapshot.projects.length, icon: FolderClosed, description: "Managed applications" },
                { name: "Stored variables", count: snapshot.variables.length, icon: Database, description: "Encrypted key-value pairs" },
                { name: "Active machine clients", count: snapshot.clients.filter(c => c.enabled).length, icon: KeyRound, description: "Authorized integrations" },
              ].map(stat => { const Icon = stat.icon; return <div key={stat.name} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02]"><div className="flex items-start justify-between"><span className="text-sm font-medium text-slate-500">{stat.name}</span><div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon size={18}/></div></div><div className="mt-3 text-3xl font-semibold tracking-tight">{stat.count}</div><p className="mt-1 text-xs text-slate-400">{stat.description}</p></div>; })}
            </div>
            <div className="mt-9 grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[265px_minmax(0,1fr)]">
              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4"><h2 className="text-sm font-semibold">Your projects</h2><button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={openProject} aria-label="Add project"><Plus size={17}/></button></div>
                <div className="max-h-[560px] space-y-1 overflow-y-auto p-2">
                  {snapshot.projects.length === 0 && <p className="px-3 py-8 text-center text-xs text-slate-400">No projects yet.</p>}
                  {snapshot.projects.map(p => <button key={p._id} onClick={() => { setProjectId(p._id); setScope("shared"); setSearch(""); setRevealed({}); }} className={"flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition " + (projectId === p._id ? "bg-emerald-50" : "hover:bg-slate-50")}><div className={"flex size-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold " + (projectId === p._id ? "bg-emerald-200 text-emerald-950" : "bg-slate-100 text-slate-600")}>{initials(p.name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{p.name}</p><p className="truncate text-xs text-slate-400">{p.slug}</p></div><span className={"size-2 shrink-0 rounded-full " + (p.enabled ? "bg-emerald-400" : "bg-slate-300")}/></button>)}
                </div>
                <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">{snapshot.projects.length} managed projects</div>
              </section>
              {!project ? <Empty icon={FolderClosed} title="Start with a project" detail="Create a project to organize the Shared, Staging, and Production environments." action={<button className={solid} onClick={openProject}><Plus size={16}/> Create project</button>}/> :
              <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.02]">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
                  <div className="flex items-center gap-4"><div className="flex size-12 items-center justify-center rounded-2xl bg-[#e9f6ef] text-sm font-bold text-emerald-800">{initials(project.name)}</div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-slate-900">{project.name}</h2><SmallPill tone={project.enabled ? "green" : "neutral"}>{project.enabled ? "Active" : "Disabled"}</SmallPill></div><p className="mt-0.5 text-xs text-slate-400">{project.description || project.slug}</p></div></div>
                  <button className={light} onClick={editProject}><Settings2 size={15}/> Settings</button>
                </div>
                <div className="flex overflow-x-auto border-b border-slate-100 px-4 sm:px-6">{scopes.map(s => <button key={s.id} onClick={() => { setScope(s.id); setRevealed({}); setSearch(""); }} className={"relative flex shrink-0 items-center gap-2 border-b-2 px-4 py-4 text-sm font-medium transition " + (scope === s.id ? "border-emerald-600 text-emerald-800" : "border-transparent text-slate-500 hover:text-slate-900")}>{s.label}<span className={"rounded-md px-2 py-0.5 text-[11px] " + (scope === s.id ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-400")}>{scopeCount(s.id)}</span></button>)}</div>
                <div className="px-5 pt-6 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-4"><div><h3 className="text-base font-semibold">{scope[0].toUpperCase() + scope.slice(1)} variables</h3><p className="mt-1 text-xs text-slate-500">{scopes.find(s => s.id === scope)?.hint} · All values encrypted at rest</p></div><div className="flex flex-wrap gap-2"><button className={light} onClick={() => { setImportText(""); openModal("import"); }}><Upload size={15}/> Import .env</button><button className={solid} onClick={() => openVariable()}><Plus size={16}/> Add variable</button></div></div>
                  {scope === "production" && <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-800"><ShieldAlert size={17} className="shrink-0"/><div><b>Production environment</b> · Changes to these keys can affect live systems. Review them before saving.</div></div>}
                  <div className="relative mt-6"><Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/><input value={search} onChange={e => setSearch(e.target.value)} className={field + " pl-10"} placeholder="Search environment keys..."/></div>
                </div>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[580px] text-left text-sm"><thead><tr className="border-y border-slate-100 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wider text-slate-400"><th className="px-6 py-3">Key</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Updated</th><th className="px-6 py-3 text-right">Actions</th></tr></thead><tbody>
                    {visibleVariables.map(item => { const id = item.scope + ":" + item.key; const shown = revealed[id] !== undefined; const override = item.scope !== "shared" && projectVariables.some(v => v.scope === "shared" && v.key === item.key); return <tr key={item._id} className="group border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                      <td className="px-6 py-4"><div className="flex items-center gap-2"><KeyRound size={14} className="shrink-0 text-slate-400"/><span className="font-mono text-xs font-semibold text-slate-800">{item.key}</span></div>{override && <span className="mt-1.5 inline-block text-[11px] text-amber-700">Overrides Shared</span>}</td>
                      <td className="max-w-[250px] px-4 py-4"><div className="max-w-[240px] truncate font-mono text-xs text-slate-500">{shown ? revealed[id] : "••••••••••••••••"}</div></td>
                      <td className="whitespace-nowrap px-4 py-4 text-xs text-slate-400">{timestamp(item.updatedAt)}</td>
                      <td className="px-6 py-4"><div className="flex justify-end gap-1"><button title={shown ? "Hide value" : "Reveal value"} aria-label={shown ? "Hide " + item.key : "Reveal " + item.key} onClick={() => reveal(item)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">{shown ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button title="Copy value" aria-label={"Copy " + item.key} onClick={() => reveal(item, true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Copy size={15}/></button><button title="Replace value" aria-label={"Edit " + item.key} onClick={() => openVariable(item)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Settings2 size={15}/></button><button title="Delete variable" aria-label={"Delete " + item.key} onClick={() => { if (confirm("Delete " + item.key + " from " + scope + "?")) void perform("variable.delete", { projectId, scope, key: item.key }, "Variable deleted"); }} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={15}/></button></div></td>
                    </tr>; })}
                  </tbody></table>
                  {visibleVariables.length === 0 && <div className="px-4 py-14 text-center"><div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><KeyRound size={19}/></div><p className="text-sm font-medium text-slate-700">{search ? "No keys match your search" : "No variables in this scope"}</p><p className="mt-1 text-xs text-slate-400">Add variables individually or import a .env file.</p></div>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4"><span className="flex items-center gap-2 text-xs text-slate-400"><LockKeyhole size={14}/> Values encrypted and masked</span><button className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-900" onClick={() => { setExportEnvironment(scope === "production" ? "production" : "staging"); openModal("export"); }}><ArrowDownToLine size={15}/> Export resolved environment</button></div>
              </section>}
            </div>
          </>}
          {view === "access" && <>
            <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Integrations</div><h1 className="text-3xl font-semibold tracking-tight text-[#152d27]">Machine access</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Give trusted automation secure, project-scoped access to environment configuration. Tokens are displayed only once.</p></div><button className={solid} onClick={() => { setClientName(""); setClientProjects([]); setClientEnvs(["staging"]); openModal("client"); }}><Plus size={17}/> Create access token</button></div>
            <div className="mt-8 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><ShieldCheck size={21} className="mt-0.5 shrink-0 text-emerald-700"/><div><h3 className="text-sm font-semibold text-emerald-900">Least-privilege access</h3><p className="mt-1 text-xs leading-6 text-emerald-800">Each credential is restricted to selected projects and environments. Production access must be explicitly selected. Tokens are hashed in Convex and can be revoked instantly.</p></div></div>
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-6 py-5"><h2 className="text-base font-semibold">Connected clients</h2><p className="mt-1 text-xs text-slate-400">{snapshot.clients.length} registered credentials</p></div>
              {!snapshot.clients.length ? <div className="p-6"><Empty icon={Terminal} title="No machine clients yet" detail="Create a restricted token for Daytona, your Convex MCP service, or another trusted integration."/></div> : <div className="divide-y divide-slate-100">{snapshot.clients.map(client => <div key={client._id} className="flex flex-wrap items-center gap-4 px-6 py-5"><div className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Terminal size={20}/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{client.name}</h3><SmallPill tone={client.enabled ? "green" : "red"}>{client.enabled ? "Active" : "Revoked"}</SmallPill></div><p className="mt-1 text-xs text-slate-400">{client.allowedProjectIds.map(id => snapshot.projects.find(p => p._id === id)?.name).filter(Boolean).join(", ") || "No available projects"} · {client.allowedEnvironments.join(" + ")}</p><p className="mt-1 text-[11px] text-slate-400">Created {timestamp(client.createdAt)} · {client.lastUsedAt ? "Last used " + timestamp(client.lastUsedAt) : "Never used"}</p></div>{client.enabled && <button className={light + " text-red-600"} disabled={busy} onClick={() => { if (confirm("Revoke access for " + client.name + "? This cannot be undone.")) void perform("client.revoke", { clientId: client._id }, "Client revoked"); }}><Trash2 size={15}/> Revoke</button>}</div>)}</div>}
            </div>
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center gap-2"><FileCode2 size={18} className="text-emerald-700"/><h3 className="text-sm font-semibold">Machine API</h3></div><p className="mt-2 text-xs leading-6 text-slate-500">Use your token as an HTTP Bearer credential. The API only returns scopes explicitly permitted for that client.</p><pre className="mt-4 overflow-x-auto rounded-xl bg-[#112d27] p-4 text-xs leading-6 text-emerald-100">GET /api/projects{"\n"}GET /api/projects/:slug/env/staging{"\n"}GET /api/projects/:slug/env/production{"\n"}GET /api/projects/:slug/env/staging/:key</pre></div>
          </>}
          {view === "audit" && <>
            <div className="mb-8"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Security</div><h1 className="text-3xl font-semibold tracking-tight text-[#152d27]">Audit log</h1><p className="mt-2 text-sm text-slate-500">Recent access and configuration changes. Secret values are never recorded.</p></div>
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-6 py-5"><h2 className="text-sm font-semibold">Recent activity</h2><p className="mt-1 text-xs text-slate-400">Latest 100 events</p></div>
              {!snapshot.audits.length ? <div className="p-6"><Empty icon={Activity} title="No activity recorded" detail="Security events will appear as you configure projects and use the vault."/></div> :
              <div className="divide-y divide-slate-100">{snapshot.audits.map(event => <div key={event._id} className="flex items-center gap-4 px-6 py-4"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Activity size={16}/></div><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium text-slate-800">{event.action.replace(/\./g, " · ")}</p><p className="mt-1 text-xs text-slate-400">{event.actor}{event.scope ? " · " + event.scope : ""}{event.key ? " · " + event.key : ""}</p></div><span className="shrink-0 text-right text-xs text-slate-400">{timestamp(event.at)}</span></div>)}</div>}
            </section>
          </>}
          <p className="mt-12 text-center text-xs text-slate-400">Pama Env Store · Internal infrastructure · Always verify production changes</p>
        </main>
      </div>
    </div>
    {mobileMenu && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileMenu(false)} />}
    {inModal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 px-4 py-8 backdrop-blur-[3px]" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setModal(null); }}>
      <section role="dialog" aria-modal="true" aria-label="Manage environment" className="my-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4"><div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">{modal === "client" || modal === "issued" ? <KeyRound size={20}/> : modal === "export" ? <ArrowDownToLine size={20}/> : modal === "import" ? <Upload size={20}/> : <Settings2 size={20}/>}</div><div><h2 className="text-lg font-semibold tracking-tight">{modal === "project" ? "New project" : modal === "editProject" ? "Project settings" : modal === "variable" ? selectedVar ? "Replace variable" : "New variable" : modal === "import" ? "Import .env variables" : modal === "export" ? "Export environment" : modal === "client" ? "Create machine token" : modal === "issued" ? "Token created" : "Delete project"}</h2><p className="mt-0.5 text-xs text-slate-400">{project?.name || "Pama infrastructure"}</p></div></div><button aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => { setModal(null); setIssuedToken(""); }}><X size={20}/></button></div>
        {error && <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700"><AlertCircle size={16}/>{error}</div>}
        {(modal === "project" || modal === "editProject") && <form onSubmit={event => { event.preventDefault(); void perform(modal === "project" ? "project.create" : "project.update", modal === "project" ? { name: projectName, slug: projectSlug, description: projectDescription } : { projectId, name: projectName, description: projectDescription }, "Project saved"); }} className="space-y-4">
          <div><label className={label}>Project name</label><input required minLength={2} maxLength={100} className={field} value={projectName} onChange={e => { setProjectName(e.target.value); if (modal === "project") setProjectSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} placeholder="e.g. Pamastore"/></div>
          <div><label className={label}>Project slug</label><input required disabled={modal === "editProject"} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={64} className={field + " font-mono disabled:bg-slate-50"} value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="pamastore"/><p className="mt-1 text-[11px] text-slate-400">Stable identifier for API calls and agents.</p></div>
          <div><label className={label}>Description (optional)</label><textarea className={field + " min-h-24 resize-y"} maxLength={500} value={projectDescription} onChange={e => setProjectDescription(e.target.value)} placeholder="What does this project do?"/></div>
          {modal === "editProject" && <div className="rounded-xl border border-slate-200 p-4"><p className="mb-3 text-xs font-semibold">Project status</p><button type="button" className={light + " w-full"} disabled={busy} onClick={() => { if (confirm(project?.enabled ? "Disable this project? Machine access will stop." : "Enable this project?")) void perform("project.update", { projectId, enabled: !project?.enabled }, "Project status updated"); }}>{project?.enabled ? "Disable project" : "Enable project"}</button></div>}
          <div className="flex flex-wrap justify-between gap-2 pt-2">{modal === "editProject" ? <button type="button" className={button + " text-red-600"} onClick={() => openModal("deleteProject")}><Trash2 size={16}/> Delete project</button> : <span/>}<button type="submit" className={solid} disabled={busy}>{busy ? <RefreshCw size={16} className="animate-spin"/> : <Check size={16}/>} Save project</button></div>
        </form>}
        {modal === "deleteProject" && <div><div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="shrink-0" size={19}/><p>This permanently deletes <b>{project?.name}</b> and all of its encrypted environment variables. Machine permissions for this project will also be removed.</p></div><div className="mt-6 flex justify-end gap-2"><button className={light} onClick={() => openModal("editProject")}>Cancel</button><button className={button + " bg-red-600 text-white hover:bg-red-700"} disabled={busy} onClick={() => perform("project.delete", { projectId }, "Project deleted")}>Delete permanently</button></div></div>}
        {modal === "variable" && <form onSubmit={event => { event.preventDefault(); void perform("variable.set", { projectId, scope, key, value }, "Variable saved"); }} className="space-y-4">
          <div><label className={label}>Environment</label><div className="rounded-xl bg-slate-100 p-3 text-xs font-semibold capitalize text-slate-700">{scope}</div></div>
          <div><label className={label}>Key</label><input required disabled={Boolean(selectedVar)} className={field + " font-mono disabled:bg-slate-50"} pattern="[A-Za-z_][A-Za-z0-9_]*" maxLength={128} value={key} onChange={e => setKey(e.target.value)} placeholder="CONVEX_DEPLOY_KEY"/></div>
          <div><label className={label}>{selectedVar ? "Replacement value" : "Value"}</label><textarea autoComplete="off" spellCheck={false} className={field + " min-h-28 resize-y font-mono"} value={value} onChange={e => setValue(e.target.value)} placeholder="Secret value (stored encrypted)"/><p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500"><LockKeyhole size={13}/> Encrypted in Convex before storage</p></div>
          {scope === "production" && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><AlertTriangle size={14} className="mr-1 inline"/> You are changing production configuration.</p>}
          <div className="flex justify-end gap-2 pt-2"><button type="button" className={light} onClick={() => setModal(null)}>Cancel</button><button type="submit" disabled={busy} className={solid}>Save encrypted value</button></div>
        </form>}
        {modal === "import" && <div className="space-y-4"><p className="text-xs leading-5 text-slate-500">Paste dotenv text for <b>{scope}</b>. Review which keys will be replaced before importing. Up to 100 entries at once.</p><textarea spellCheck={false} className={field + " min-h-40 resize-y font-mono text-xs leading-6"} value={importText} onChange={e => setImportText(e.target.value)} placeholder={"API_URL=https://example.test\nCONVEX_DEPLOY_KEY=..."} />
          {parsedImport.error && <p className="text-xs text-red-600">{parsedImport.error}</p>}
          {importPreview.length > 0 && <div className="max-h-48 overflow-auto rounded-xl border border-slate-200"><div className="sticky top-0 flex justify-between bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-600">Import preview <span>{importPreview.length} keys</span></div>{importPreview.map(item => <div key={item.key} className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5"><span className="truncate font-mono text-xs">{item.key}</span><SmallPill tone={item.exists ? "amber" : "green"}>{item.exists ? "Overwrite" : "Create"}</SmallPill></div>)}</div>}
          {scope === "production" && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><ShieldAlert className="mr-1 inline" size={15}/> Importing into production may replace live credentials.</p>}
          <div className="flex justify-end gap-2"><button className={light} onClick={() => setModal(null)}>Cancel</button><button disabled={busy || Boolean(parsedImport.error) || !importPreview.length} className={solid} onClick={() => perform("variable.import", { projectId, scope, entries: parsedImport.entries }, "Variables imported")}>Import {importPreview.length} keys</button></div>
        </div>}
        {modal === "export" && <div className="space-y-5"><p className="text-sm leading-6 text-slate-500">Export a resolved environment. Shared values are merged with the selected environment; environment-specific values win.</p>
          <div className="grid grid-cols-2 gap-2">{(["staging", "production"] as const).map(e => <button key={e} onClick={() => setExportEnvironment(e)} className={"rounded-xl border p-4 text-left text-sm font-semibold " + (exportEnvironment === e ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-slate-200 text-slate-600")}><span className={"mb-2 block size-2 rounded-full " + (e === "staging" ? "bg-blue-500" : "bg-amber-500")}/>{e[0].toUpperCase() + e.slice(1)}</button>)}</div>
          <div className={"flex gap-3 rounded-xl p-4 text-xs leading-5 " + (exportEnvironment === "production" ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600")}><ShieldAlert size={17} className="shrink-0"/><p>{exportEnvironment === "production" ? "This contains live production secrets. Export only to a trusted machine and never commit it to Git." : "The exported file includes decrypted secret values. Store and use it carefully."}</p></div>
          <div className="flex flex-wrap justify-end gap-2"><button className={light} disabled={busy} onClick={() => exportEnv("copy")}><ClipboardCopy size={15}/> Copy</button><button className={solid} disabled={busy} onClick={() => exportEnv("download")}><ArrowDownToLine size={15}/> Download .env</button></div>
        </div>}
        {modal === "client" && <div className="space-y-5">
          <div><label className={label}>Client name</label><input className={field} maxLength={100} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="e.g. Daytona staging agent"/></div>
          <div><p className={label}>Allowed projects</p><div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{snapshot.projects.map(p => <label key={p._id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><input type="checkbox" className="accent-emerald-600" checked={clientProjects.includes(p._id)} onChange={e => setClientProjects(previous => e.target.checked ? [...previous, p._id] : previous.filter(id => id !== p._id))}/>{p.name}</label>)}{!snapshot.projects.length && <p className="p-3 text-xs text-slate-400">Create a project first.</p>}</div></div>
          <div><p className={label}>Allowed environments</p><div className="space-y-2">{(["staging", "production"] as const).map(e => <label key={e} className={"flex cursor-pointer items-center justify-between rounded-xl border p-3.5 " + (e === "production" ? "border-amber-200 bg-amber-50" : "border-slate-200")}><span className="flex items-center gap-3 text-sm font-medium capitalize"><input type="checkbox" className="accent-emerald-600" checked={clientEnvs.includes(e)} onChange={event => setClientEnvs(prev => event.target.checked ? [...prev, e] : prev.filter(item => item !== e))}/>{e}</span>{e === "production" && <SmallPill tone="amber">Sensitive</SmallPill>}</label>)}</div></div>
          {clientEnvs.includes("production") && <div className="flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><AlertTriangle size={17} className="shrink-0"/>This credential will be able to read live production secrets for all selected projects.</div>}
          <div className="flex justify-end gap-2"><button className={light} onClick={() => setModal(null)}>Cancel</button><button disabled={busy} className={solid} onClick={createClient}><KeyRound size={16}/> Generate token</button></div>
        </div>}
        {modal === "issued" && <div className="space-y-5"><div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"><CheckCircle2 size={20} className="shrink-0"/><div><b>Machine token created</b><p className="mt-1 text-xs leading-5 text-emerald-800">Copy it now. This token cannot be retrieved again. Only its hash is stored.</p></div></div><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><code className="block break-all text-xs leading-6 text-slate-800">{issuedToken}</code></div><div className="flex justify-end gap-2"><button className={light} onClick={async () => { await navigator.clipboard.writeText(issuedToken); setNotice("Token copied"); }}><Copy size={15}/> Copy token</button><button className={solid} onClick={() => { setIssuedToken(""); setModal(null); }}>Done</button></div></div>}
      </section>
    </div>}
  </div>;
}
