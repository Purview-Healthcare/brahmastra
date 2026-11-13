/* =====================================================================
   Brahmastra demo backend: runs worker.js INSIDE the browser.
   ---------------------------------------------------------------------
   D1 is stood in by sql.js (SQLite compiled to WebAssembly, loaded from
   cdnjs) and the database is kept in this browser's IndexedDB, so the
   demo survives a refresh but is never shared with anyone else.
   The Worker code is untouched: its fetch() is called with a Request,
   exactly as Cloudflare would call it.
   ===================================================================== */

const SQLJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.15.0/";
const IDB_NAME = "brahmastra-demo";
const IDB_STORE = "sqlite";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}
let sqlPromise = null;
function loadSqlJs() {
  if (!sqlPromise) sqlPromise = (async () => {
    if (!window.initSqlJs) await loadScript(SQLJS_BASE + "sql-wasm.js");
    return window.initSqlJs({ locateFile: (f) => SQLJS_BASE + f });
  })();
  return sqlPromise;
}

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const r = tx.objectStore(IDB_STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}
async function idbSet(key, value) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn("demo db not saved", e); }
}
async function idbDel(key) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

const WRITE_RE = /^\s*(insert|update|delete|replace|create|drop|alter|begin|commit)/i;

/* D1's own rules, so the demo and the tests refuse what Cloudflare refuses, in D1's words (sql.js alone takes all of it).
   Measured on Cloudflare's runtime (workerd's D1 through wrangler dev 4.160.0):
   - a value is a number, a string, a boolean, null or bytes: undefined, an object or a bigint is refused when it is bound
     (D1_TYPE_ERROR), never quietly turned into NULL; NaN and Infinity arrive as NULL;
   - a statement gets exactly as many values as it has ?s;
   - a LIKE or GLOB pattern is at most 50 bytes ("LIKE or GLOB pattern too complex"). D1 checks it when a row is compared, so
     an empty table hides it there; here it is checked every time the statement runs, whatever the data;
   - meta.changes counts what the statement changed plus what its triggers changed (D1 takes total_changes() before and
     after), so closing a claim counts 2: the claim and the trigger that stamps closed_at. */
const d1Error = (m) => new Error("D1_ERROR: " + m, { cause: new Error(m) });
function d1Value(v) {
  const t = typeof v;
  if (t === "string" || v === null) return v;
  if (t === "number") return Number.isFinite(v) ? v : null;
  if (t === "boolean") return v ? 1 : 0;
  if (ArrayBuffer.isView(v) || (Array.isArray(v) && v.every((b) => typeof b === "number" && b >= 0 && b < 256))) return v;
  throw new Error(`D1_TYPE_ERROR: Type '${t}' not supported for value '${v}'`, { cause: new Error(`Type '${t}' not supported for value '${v}'`) });
}
const D1_MAX_PATTERN_BYTES = 50;
const utf8Len = (x) => new TextEncoder().encode(String(x)).length;
/* What D1's SQLite reads in a statement: how many ?s it has (?NNN counts as NNN), which of them are LIKE / GLOB patterns,
   and whether a pattern written in the SQL itself is too long. Strings, quoted names and comments are skipped. Kept per
   statement text (a few thousand at most). */
const SCANS = new Map();
function scanSql(sql) {
  let s = SCANS.get(sql);
  if (s) return s;
  s = { vars: 0, patterns: [], longPattern: false };
  let prev = "";   // the word or sign before, to tell a pattern (LIKE ?, GLOB '...') from any other value
  for (let i = 0; i < sql.length;) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === "`") {   // a string or a quoted name; a doubled quote stays inside it
      let j = i + 1;
      for (; j < sql.length; j++) if (sql[j] === ch) { if (sql[j + 1] === ch) j++; else break; }
      if (ch === "'" && (prev === "LIKE" || prev === "GLOB") && utf8Len(sql.slice(i + 1, j).replace(/''/g, "'")) > D1_MAX_PATTERN_BYTES) s.longPattern = true;
      prev = ch; i = j + 1; continue;
    }
    if (ch === "[") { const j = sql.indexOf("]", i + 1); i = j < 0 ? sql.length : j + 1; prev = ch; continue; }
    if (ch === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j + 1; continue; }
    if (ch === "/" && sql[i + 1] === "*") { const j = sql.indexOf("*/", i + 2); i = j < 0 ? sql.length : j + 2; continue; }
    if (ch === "?") {
      let j = i + 1;
      while (j < sql.length && sql[j] >= "0" && sql[j] <= "9") j++;
      const n = j > i + 1 ? Number(sql.slice(i + 1, j)) : s.vars + 1;
      s.vars = Math.max(s.vars, n);
      if (prev === "LIKE" || prev === "GLOB") s.patterns.push(n - 1);
      prev = ch; i = j; continue;
    }
    if (/[A-Za-z_]/.test(ch)) { let j = i + 1; while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j])) j++; prev = sql.slice(i, j).toUpperCase(); i = j; continue; }
    if (!/\s/.test(ch)) prev = ch;
    i++;
  }
  if (SCANS.size > 5000) SCANS.clear();
  SCANS.set(sql, s);
  return s;
}
function d1Check(sql, params) {
  const s = scanSql(sql);
  if (params.length !== s.vars) throw d1Error("Wrong number of parameter bindings for SQL query.");
  if (s.longPattern || s.patterns.some((k) => typeof params[k] === "string" && utf8Len(params[k]) > D1_MAX_PATTERN_BYTES)) throw d1Error("LIKE or GLOB pattern too complex: SQLITE_ERROR");
}

/* A small D1 look-alike over a sql.js Database: prepare().bind().first()/all()/run(), batch(), exec(). */
class D1Statement {
  constructor(d1, sql, params) { this.d1 = d1; this.sql = sql; this.params = params || []; }
  bind(...p) { return new D1Statement(this.d1, this.sql, p.map(d1Value)); }
  _exec() {
    d1Check(this.sql, this.params);
    const db = this.d1.db;
    const write = WRITE_RE.test(this.sql);
    const totalChanges = () => db.exec("SELECT total_changes()")[0].values[0][0];
    const before = write ? totalChanges() : 0;
    const st = db.prepare(this.sql);
    try {
      if (this.params.length) st.bind(this.params);
      const results = [];
      while (st.step()) results.push(st.getAsObject());
      const changes = write ? totalChanges() - before : 0;
      let last_row_id = 0;
      if (write) { try { const r = db.exec("SELECT last_insert_rowid() AS id"); last_row_id = r[0] ? r[0].values[0][0] : 0; } catch {} }
      if (write) this.d1.touched();
      return { results, success: true, meta: { changes, last_row_id, rows_read: results.length, rows_written: changes, duration: 0 } };
    } finally { st.free(); }
  }
  async first(col) {
    const r = this._exec();
    const row = r.results[0];
    if (!row) return null;
    return col == null ? row : (col in row ? row[col] : null);
  }
  async all() { return this._exec(); }
  async run() { const r = this._exec(); return { success: true, meta: r.meta, results: r.results }; }   // D1's run() gives the rows too (RETURNING)
  async raw() { const r = this._exec(); return r.results.map((o) => Object.values(o)); }
}
class D1Shim {
  constructor(db, onWrite) { this.db = db; this.onWrite = onWrite; this.dirty = false; }
  touched() { this.dirty = true; this.onWrite && this.onWrite(); }
  prepare(sql) { return new D1Statement(this, sql, []); }
  async batch(stmts) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(s._exec());
      this.db.exec("COMMIT");
      return out;
    } catch (e) { try { this.db.exec("ROLLBACK"); } catch {} throw e; }
  }
  async exec(sql) { this.db.exec(sql); this.touched(); return { count: 1, duration: 0 }; }
}

/* Build the demo backend. Returns { fetch(url, init), reset(), env }. */
export async function createLocalBackend({ worker, env = {}, dbKey = "main" } = {}) {
  if (!worker || typeof worker.fetch !== "function") throw new Error("createLocalBackend needs the Worker module (worker.js).");
  const SQL = await loadSqlJs();
  const saved = await idbGet(dbKey);
  let db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
  let timer = null, persisting = Promise.resolve();
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { persisting = persisting.then(() => idbSet(dbKey, db.export())); }, 250);
  };
  let d1 = new D1Shim(db, persist);
  const fullEnv = () => ({ PEPPER: "local-demo-pepper", DEMO: true, ...env, DB: d1 });
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  return {
    env: fullEnv(),
    async fetch(url, init) {
      const req = new Request(url, init);
      return worker.fetch(req, fullEnv(), ctx);
    },
    async reset() {
      clearTimeout(timer);
      await persisting;
      await idbDel(dbKey);
      db.close();
      db = new SQL.Database();
      d1 = new D1Shim(db, persist);
      return true;
    },
    async flush() { clearTimeout(timer); persisting = persisting.then(() => idbSet(dbKey, db.export())); await persisting; },
    export() { return db.export(); },
  };
}
