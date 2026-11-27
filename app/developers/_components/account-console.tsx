"use client";

import { useEffect, useState } from "react";

type Org = { id: number; name: string; role: string };
type Project = { id: number; name: string; allowedOrigins: string[] };
type Key = { id: number; label: string; prefix: string; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; rateLimitPerMin: number };

async function call<T>(method: "GET" | "POST", q: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/developers${q}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Request failed");
  return d as T;
}

export function AccountConsole() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [keys, setKeys] = useState<Key[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  // State is only set after a request completes (never synchronously inside an effect).
  const [tick, setTick] = useState({ orgs: 0, projects: 0, keys: 0 });
  const reload = (k: keyof typeof tick) => setTick((t) => ({ ...t, [k]: t[k] + 1 }));
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  // Loaders: state is set only in the request callbacks.
  useEffect(() => {
    let alive = true;
    call<{ orgs: Org[] }>("GET", "?resource=orgs").then((d) => alive && setOrgs(d.orgs), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [tick.orgs]);
  useEffect(() => {
    if (!org) return;
    let alive = true;
    call<{ projects: Project[] }>("GET", `?resource=projects&orgId=${org.id}`).then((d) => alive && setProjects(d.projects), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [org, tick.projects]);
  useEffect(() => {
    if (!project) return;
    let alive = true;
    call<{ keys: Key[] }>("GET", `?resource=keys&projectId=${project.id}`).then((d) => alive && setKeys(d.keys), (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [project, tick.keys]);

  const btn = "rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-white/5";
  return (
    <div className="space-y-4 text-sm">
      {err && <p role="alert" className="text-amber-300">{err}</p>}
      {secret && (
        <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-xs">
          <p className="text-gold">Copy this key now: it will not be shown again.</p>
          <code className="mt-1 block break-all font-mono text-white">{secret}</code>
          <button className={`${btn} mt-2`} onClick={() => setSecret(null)}>Done</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded-lg border border-line bg-panel px-2 py-1" placeholder={org ? (project ? "Key label" : "New project name") : "New organisation name"} value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        {!org && <button className={btn} onClick={() => run(async () => { await call("POST", "", { action: "createOrg", name }); setName(""); reload("orgs"); })}>Create organisation</button>}
        {org && !project && <button className={btn} onClick={() => run(async () => { await call("POST", "", { action: "createProject", orgId: org.id, name }); setName(""); reload("projects"); })}>Create project</button>}
        {project && <button className={btn} onClick={() => run(async () => { const r = await call<{ key: { plaintext: string } }>("POST", "", { action: "issueKey", projectId: project.id, label: name || "default" }); setSecret(r.key.plaintext); setName(""); reload("keys"); })}>Issue key</button>}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ul className="space-y-1">{orgs.map((o) => <li key={o.id}><button className={`${btn} w-full text-left ${org?.id === o.id ? "bg-white/10" : ""}`} onClick={() => { setOrg(o); setProject(null); setKeys([]); }}>{o.name} <span className="text-muted">({o.role})</span></button></li>)}</ul>
        <ul className="space-y-1">{projects.map((p) => <li key={p.id}><button className={`${btn} w-full text-left ${project?.id === p.id ? "bg-white/10" : ""}`} onClick={() => setProject(p)}>{p.name}</button></li>)}</ul>
        <ul className="space-y-1 text-xs">
          {keys.map((k) => (
            <li key={k.id} className="rounded-lg border border-line p-2">
              <div className="font-mono">xck_{k.prefix}_… · {k.label}</div>
              <div className="text-muted">{k.revokedAt ? "revoked" : k.expiresAt ? `expires ${k.expiresAt.slice(0, 16)}` : "active"} · {k.rateLimitPerMin}/min · last used {k.lastUsedAt?.slice(0, 16) ?? "never"}</div>
              {!k.revokedAt && (
                <div className="mt-1 flex gap-1">
                  <button className={btn} onClick={() => run(async () => { const r = await call<{ key: { plaintext: string } }>("POST", "", { action: "rotateKey", keyId: k.id }); setSecret(r.key.plaintext); reload("keys"); })}>Rotate</button>
                  <button className={btn} onClick={() => run(async () => { await call("POST", "", { action: "revokeKey", keyId: k.id }); reload("keys"); })}>Revoke</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
