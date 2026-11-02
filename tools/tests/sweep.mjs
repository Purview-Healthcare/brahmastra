import { makeRig, REPO } from "./rig.mjs";
import fs from "fs";
const rig = await makeRig({ envExtra: {} });
const { as, sha } = rig;
await rig.app.seedDemo(() => {});
const adm = await as(null)("auth.login", { email: "supervisor@purview-healthcare.com", passHash: await sha("brahmastra-demo") });
const A = as(adm.token);
const cl = (await A("clients.list")).clients; const c0 = cl[0];
const claims = (await A("claims.list", { client_id: c0.id, page_size: 20 })).rows;
const users = (await A("users.list")).users; const biller = users.find((u) => u.role === "user");
// a biller token: give the demo biller a password through the admin reset if available
let B = null;
try { const lr = await A("users.loginCode", { id: biller.id }); } catch (e) {}
const ops = fs.readFileSync(REPO + "/worker.js", "utf8").match(/^  "[a-zA-Z]+\.[a-zA-Z]+": async/gm).map((s) => s.match(/"(.*)"/)[1]);
const skip = new Set(["demo.seed", "auth.logout", "auth.signOutOthers", "auth.deleteMyAccount", "users.delete", "clients.delete", "inventory.undoBatch", "auth.changePassword"]);
const payloads = (op) => [{}, { id: claims[0] && claims[0].id, client_id: c0.id, claim_id: claims[0] && claims[0].id, ids: claims.slice(0, 2).map((c) => c.id), user_id: biller.id, from_ms: 0, to_ms: Date.now(), q: "ta", day: new Date().toISOString().slice(0, 10) },
  { id: "nope", client_id: "nope", claim_id: "nope", ids: ["nope"], rows: "not-an-array", claims: null, saag: "x", note: 5, proof: "x", emails: 7, settings: "x", payload: null }];
const bad = [];
for (const op of ops) {
  if (skip.has(op)) continue;
  for (const [who, X] of [["admin", A], ["anon", as(null)]]) for (const p of payloads(op)) {
    try { await X(op, p); } catch (e) { if (!e.status || e.status >= 500 && e.status !== 502 && e.status !== 503) bad.push({ op, who, p: JSON.stringify(p).slice(0, 80), status: e.status, e: e.message.slice(0, 160) }); }
  }
}
console.log("ops swept:", ops.length - skip.size, "· crashes:", bad.length);
for (const b of bad) console.log(JSON.stringify(b));
