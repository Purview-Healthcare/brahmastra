// Runs Brahmastra's own page code (the built app/app.js) in Node against the real worker.js and a fresh sql.js database,
// so the checks call the server exactly the way the page does.
import fs from "fs"; import vm from "vm"; import path from "path"; import { createRequire } from "module"; import { webcrypto } from "crypto"; import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..", "..");
export async function makeRig({ envExtra = {}, fetchMock = null } = {}) {
  const initSqlJs = require("sql.js");
  globalThis.window = globalThis.window || {}; const _w = console.warn; console.warn = (...a) => { if (!/demo db not saved/.test(String(a[0]))) _w(...a); };
  window.initSqlJs = (o) => initSqlJs({ locateFile: (f) => require.resolve("sql.js/dist/" + f) });
  const lib = await import(REPO + "/lib/local-backend.js?" + Math.random());
  // worker.js is an ES module; a .mjs copy lets Node load it as one.
  const wcopy = path.join(HERE, ".worker.mjs");
  fs.copyFileSync(REPO + "/worker.js", wcopy);
  const worker = await import(wcopy + "?" + Math.random());
  const realFetch = globalThis.fetch;
  if (fetchMock) globalThis.fetch = (u, i) => fetchMock(String(u), i, realFetch);
  const backend = await lib.createLocalBackend({ worker: worker.default, env: { DEMO: true, ADMIN_EMAILS: "supervisor@purview-healthcare.com", BOOTSTRAP_EMAIL: "supervisor@purview-healthcare.com", BOOTSTRAP_PASSWORD: "brahmastra-demo", ALLOWED_DOMAINS: "*purview*", ...envExtra }, dbKey: "t" + Math.random() });
  // the page's code, as built by tools/build.mjs
  const code = fs.readFileSync(REPO + "/app/app.js", "utf8");
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const el = () => ({ style: {}, appendChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, addEventListener() {}, classList: { add() {}, remove() {} } });
  const React = { createElement: () => null, Fragment: "f", useState: (v) => [typeof v === "function" ? v() : v, () => {}], useEffect() {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: () => ({ current: null }), memo: (f) => f };
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, crypto: webcrypto, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response, Headers, Blob, atob, btoa,
    fetch: globalThis.fetch, React, ReactDOM: { createRoot: () => ({ render() {} }) }, XLSX: require("xlsx"), localStorage: ls, sessionStorage: ls,
    document: { baseURI: "http://localhost/", documentElement: el(), head: el(), body: el(), createElement: el, getElementById: () => el(), querySelector: () => null, addEventListener() {} },
    location: { hash: "", href: "http://localhost/", origin: "http://localhost", search: "" }, history: { replaceState() {} }, navigator: { userAgent: "node" },
    matchMedia: () => ({ matches: false, addEventListener() {} }), CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } }, addEventListener() {}, dispatchEvent() {},
    BRAHMASTRA_CONFIG: { API_BASE: "", ALLOWED_DOMAINS: ["*purview*"], THIRD_EYE_URL: "", DRISHTI_URL: "" } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: "app.js" });
  ctx.getLocalBackend = async () => backend;
  const app = ctx;
  // rpc as a given token
  const as = (token) => async (op, payload) => { app.setToken(token); return app.rpc(op, payload); };
  const tryOp = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, e: e.message, status: e.status }; } };
  return { app, backend, worker, as, tryOp, sha: (p) => app.sha256Hex(p) };
}
