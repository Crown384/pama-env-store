import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

function mod(source, imports = {}) {
  let js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  for (const [specifier, target] of Object.entries(imports)) {
    js = js.replaceAll('from "' + specifier + '"', 'from "' + target + '"');
  }
  return "data:text/javascript;base64," + Buffer.from(js).toString("base64");
}
function file(path) { return readFileSync(resolve(path), "utf8"); }
const cryptoURL = mod(file("convex/crypto.ts"));
const valueURL = mod("const f=new Proxy(function(){},{get(){return f},apply(){return f}});export const v=f;");
const generatedURL = mod("export const internalQuery = ({handler}) => ({handler}); export const internalMutation = ({handler}) => ({handler}); export const httpAction = fn => fn;");
const refs = ["canAttempt","recordAttempt","readAdmin","logout","write","readMachine","logAccess"];
const apiURL = mod("export const internal={store:{" + refs.map(x=>x+":"+JSON.stringify(x)).join(",") + "}};");
const store = await import(mod(file("convex/store.ts"), {
  "convex/values":valueURL, "./_generated/server":generatedURL,
}));
const vaultURL = mod(file("convex/vault.ts"), {
  "./_generated/api":apiURL, "./crypto":cryptoURL,
});
const admin = await import(mod(file("convex/admin-http.ts"), {
  "./_generated/server":generatedURL, "./crypto":cryptoURL, "./vault":vaultURL,
}));
const lookupURL = mod(file("convex/machine-request.ts"));
const machine = await import(mod(file("convex/machine.ts"), {
  "./_generated/server":generatedURL, "./_generated/api":apiURL,
  "./crypto":cryptoURL, "./machine-request":lookupURL,
}));
const nextHeadersURL = mod("export async function cookies(){return {get(){return null}}} export async function headers(){return new Headers()}");
let serverSource = ts.transpileModule(file("lib/server.ts"), {compilerOptions:{
  module:ts.ModuleKind.ESNext, target:ts.ScriptTarget.ES2022
}}).outputText
  .replace(/import "server-only";/g,"")
  .replace(/from ["']next\/headers["']/g,'from "'+nextHeadersURL+'"');
const server = await import("data:text/javascript;base64,"+Buffer.from(serverSource).toString("base64"));

function makeDB() {
  const tables = Object.fromEntries(
    ["projects","variables","sessions","machineClients","auditEvents","loginAttempts"].map(t=>[t,[]]),
  );
  let nextId=0;
  const db={
    query(name) {
      const filters=[];
      const chain={
        withIndex(_name,fn) {
          if (fn) {
            const builder={eq(key,value){filters.push([key,value]);return builder;}};
            fn(builder);
          }
          return chain;
        },
        order(){return chain;},
        unique:async()=>tables[name].find(row=>filters.every(([k,v])=>row[k]===v)),
        collect:async()=>tables[name].filter(row=>filters.every(([k,v])=>row[k]===v)),
        take:async(n)=>(await chain.collect()).slice(0,n),
      };
      return chain;
    },
    get:async(id)=>Object.values(tables).flat().find(x=>x._id===id)??null,
    insert:async(name,data)=>{const id="id"+(++nextId);tables[name].push({_id:id,...data});return id;},
    patch:async(id,data)=>{const row=await db.get(id);if(!row)throw Error("missing id");Object.assign(row,data);},
    delete:async(id)=>{for(const arr of Object.values(tables)){const at=arr.findIndex(r=>r._id===id);if(at>=0){arr.splice(at,1);return;}}},
  };
  const ctx={
    db,
    afterMachineQuery:null,
    async runQuery(ref,args){
      const result=await store[ref].handler(ctx,args);
      if(ref==="readMachine"&&ctx.afterMachineQuery) {
        const hook=ctx.afterMachineQuery;ctx.afterMachineQuery=null;await hook();
      }
      return result;
    },
    async runMutation(ref,args){return store[ref].handler(ctx,args);},
  };
  return {tables,db,ctx};
}
const internalKey="internal-only-"+ "k".repeat(48);
const adminPassword="correct-admin-test-password";
const old={
  admin:process.env.ADMIN_PASSWORD,
  encryption:process.env.SECRET_ENCRYPTION_KEY,
  key:process.env.ENV_STORE_INTERNAL_API_KEY,
  convex:process.env.CONVEX_URL,
};
process.env.ADMIN_PASSWORD=adminPassword;
process.env.SECRET_ENCRYPTION_KEY=Buffer.alloc(32,11).toString("base64");
process.env.ENV_STORE_INTERNAL_API_KEY=internalKey;
process.env.CONVEX_URL="https://test-env.convex.cloud";
test.after(()=>{ for (const [k,n] of [["admin","ADMIN_PASSWORD"],["encryption","SECRET_ENCRYPTION_KEY"],["key","ENV_STORE_INTERNAL_API_KEY"],["convex","CONVEX_URL"]]) {
  if(old[k]===undefined)delete process.env[n];else process.env[n]=old[k];
}});
const authHeaders=(session)=>({"X-Pama-Internal-Key":internalKey,
  ...(session?{Authorization:"Bearer "+session}:{})});
async function invoke(handler,ctx,body={},opts={}) {
  const url="https://test-env.convex.site"+(opts.path??"/admin");
  const request=new Request(url,{method:opts.method??"POST",headers:{
    ...authHeaders(opts.session),
    ...(opts.headers??{}),
  },...(opts.method==="GET"?{}:{body:JSON.stringify(body)})});
  return handler(ctx,request);
}
async function api(handler,ctx,body={},opts={}) {
  const r=await invoke(handler,ctx,body,opts);
  return {status:r.status,data:await r.json(),headers:r.headers};
}

test("real admin HTTP + vault/store/session + Next server proxy: create/set/reveal/export/logout/revoke", async () => {
  const {tables,ctx}=makeDB();
  const priorFetch=globalThis.fetch;
  try {
    // Route the *actual* Next server proxy to the *actual* Convex HTTP handlers,
    // backed by the in-memory Convex query/mutation harness.
    globalThis.fetch=async(url,init)=>{
      const route=new URL(url).pathname;
      assert.equal(new URL(url).host,"test-env.convex.site");
      assert.equal(init.cache,"no-store");
      assert.equal(init.redirect,"error");
      assert.equal(init.headers["X-Pama-Internal-Key"],internalKey);
      const handler={"/auth/login":admin.login,"/auth/logout":admin.logout,"/admin":admin.admin}[route];
      assert.ok(handler,"unexpected route "+route);
      return handler(ctx,new Request(url,{method:"POST",headers:init.headers,body:init.body}));
    };
    const logged=await server.internalRequest("/auth/login",{password:adminPassword,identity:"test-ip"});
    assert.equal(logged.expiresIn,21600);
    assert.match(logged.token,/^[A-Za-z0-9_-]{32,}$/);
    const session=logged.token;
    let snapshot=await server.adminSnapshot(session);
    assert.deepEqual(snapshot.projects,[]);
    await server.adminAction(session,"project.create",{name:"Track",slug:"track"});
    snapshot=await server.adminSnapshot(session);
    const projectId=snapshot.projects[0]._id;
    await server.adminAction(session,"variable.set",{projectId,scope:"shared",key:"API_URL",value:"https://test.example"});
    await server.adminAction(session,"variable.set",{projectId,scope:"staging",key:"API_URL",value:"https://staging.example"});
    await server.adminAction(session,"variable.set",{projectId,scope:"staging",key:"TEST_KEY",value:"fake-staging-secret"});
    assert.equal(tables.variables.length,3);
    assert.ok(tables.variables.every(row=>!row.encryptedValue.includes("fake-staging-secret")));
    assert.equal((await server.adminAction(session,"variable.reveal",{projectId,scope:"staging",key:"TEST_KEY"})).value,"fake-staging-secret");
    const resolved=await server.adminAction(session,"environment.export",{projectId,environment:"staging"});
    assert.equal(resolved.values.API_URL,"https://staging.example");
    assert.equal(resolved.values.TEST_KEY,"fake-staging-secret");
    assert.equal(tables.auditEvents.some(x=>x.action==="variable.revealed"),true);
    const machineClient=await server.adminAction(session,"client.create",{
      name:"QA staging",allowedProjectIds:[projectId],allowedEnvironments:["staging"],
    });
    assert.match(machineClient.token,/^pes_/);
    const machineReq=async(tok,path)=>{
      const request=new Request("https://test-env.convex.site/machine?"+path,{headers:{
        Authorization:"Bearer "+tok,
      }});
      const response=await machine.machine(ctx,request);
      return {status:response.status,data:await response.json(),headers:response.headers};
    };
    const read=await machineReq(machineClient.token,"slug=track&environment=staging");
    assert.equal(read.status,200);
    assert.equal(read.data.values.API_URL,"https://staging.example");
    assert.match(read.headers.get("Cache-Control"),/no-store/);
    assert.equal((await machineReq(machineClient.token,"slug=track&environment=production")).status,404);
    assert.equal((await machineReq(machineClient.token,"slug=other&environment=staging")).status,404);
    assert.equal((await machineReq("pes_invalid_credential","slug=track&environment=staging")).status,404);
    // Revoke machine access via *real* admin mutation.
    const clients=(await server.adminSnapshot(session)).clients;
    await server.adminAction(session,"client.revoke",{clientId:clients[0]._id});
    assert.equal((await machineReq(machineClient.token,"slug=track&environment=staging")).status,404);
    // Expired sessions must be denied by the actual store query.
    const sessionRow=tables.sessions[0];sessionRow.expiresAt=Date.now()-1;
    await assert.rejects(server.adminSnapshot(session),/Env Store request refused/);
    sessionRow.expiresAt=Date.now()+60000;
    await server.internalRequest("/auth/logout",{},session);
    await assert.rejects(server.adminSnapshot(session),/Env Store request refused/);
  } finally {globalThis.fetch=priorFetch;}
});

test("machine audit races deny after project disabled, deleted, or token revoked", async()=>{
  for (const race of ["disabled","deleted","revoked"]) {
    const {tables,db,ctx}=makeDB();
    const projectId=await db.insert("projects",{name:"Track",slug:"track",enabled:true,createdAt:1,updatedAt:1});
    const clientId=await db.insert("machineClients",{name:"QA",tokenHash:"fakehash",enabled:true,
      allowedProjectIds:[projectId],allowedEnvironments:["staging"],createdAt:1});
    await db.insert("variables",{projectId,key:"TEST",scope:"staging",
      encryptedValue:"ciphertext-unused",createdAt:1,updatedAt:1});
    const {readMachine,logAccess}=store;
    const before=await readMachine.handler(ctx,{tokenHash:"fakehash",slug:"track",environment:"staging"});
    assert.equal(before.projectId,projectId);
    if(race==="disabled") await db.patch(projectId,{enabled:false});
    if(race==="deleted") await db.delete(projectId);
    if(race==="revoked") await db.patch(clientId,{enabled:false});
    await assert.rejects(logAccess.handler(ctx,{
      tokenHash:"fakehash",projectId,scope:"staging",action:"machine_client.environment_accessed",
    }),/Not authorized/,race);
    assert.equal(tables.auditEvents.length,0,"must not record success after revocation");
  }
});
