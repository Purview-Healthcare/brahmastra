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
const normParam = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

/* A small D1 look-alike over a sql.js Database: prepare().bind().first()/all()/run(), batch(), exec(). */
class D1Statement {
  constructor(d1, sql, params) { this.d1 = d1; this.sql = sql; this.params = params || []; }
  bind(...p) { return new D1Statement(this.d1, this.sql, p.map(normParam)); }
  _exec() {
    const db = this.d1.db;
    const st = db.prepare(this.sql);
    try {
      if (this.params.length) st.bind(this.params);
      const results = [];
      while (st.step()) results.push(st.getAsObject());
      const write = WRITE_RE.test(this.sql);
      const changes = write ? db.getRowsModified() : 0;
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
  async run() { const r = this._exec(); return { success: true, meta: r.meta, results: [] }; }
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
