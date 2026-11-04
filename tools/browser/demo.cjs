/* Shared by the browser checks: makes a demo copy of Brahmastra that runs its server inside the page (no network),
   with test hooks, and serves the repository on a local port. The generated files are git-ignored. */
const fs = require("fs");
const path = require("path");
const http = require("http");

const REPO = path.resolve(__dirname, "..", "..");
const N = path.join(REPO, "tools", "node_modules");
// CDN files the page loads, served from tools/node_modules instead.
const CDN = {
  "react/18.2.0/umd/react.production.min.js": "react/umd/react.production.min.js",
  "react-dom/18.2.0/umd/react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "xlsx/0.18.5/xlsx.full.min.js": "xlsx/dist/xlsx.full.min.js",
  "sql.js/1.15.0/sql-wasm.js": "sql.js/dist/sql-wasm.js",
  "sql.js/1.15.0/sql-wasm.wasm": "sql.js/dist/sql-wasm.wasm",
  "html2canvas/1.4.1/html2canvas.min.js": "html2canvas/dist/html2canvas.min.js",
};
const HOOKS = 'window.__rpc = (...a) => rpc(...a); window.__setToken = (t) => setToken(t); window.__sha = (p) => sha256Hex(p); window.__flush = async () => (await getLocalBackend()).flush(); window.__sql = async (q, ...a) => (await getLocalBackend()).env.DB.prepare(q).bind(...a).run();';

function must(s, find, repl) { if (!s.includes(find)) throw new Error("demo build: could not find " + JSON.stringify(find.slice(0, 60))); return s.split(find).join(repl); }

/* base: the address the repository is served at. thirdEye / drishti: the embedded apps (default: a blank stub page). */
function prepareDemo({ thirdEye, drishti, base = "http://localhost:8766" } = {}) {
  const stub = `${base}/tools/browser/stub.html`;
  let html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  html = must(html, 'API_BASE: "https://brahmastra-api.purviewautomate.workers.dev"', 'API_BASE: ""');
  html = must(html, 'THIRD_EYE_URL: "https://purview-healthcare.github.io/Sashas-third-eye/"', `THIRD_EYE_URL: "${thirdEye || stub + "?app=thirdeye"}"`);
  html = must(html, 'DRISHTI_URL: "https://purview-healthcare.github.io/Drishti/"', `DRISHTI_URL: "${drishti || stub + "?app=drishti"}"`);
  html = html.replace(/<script src="app\/app\.js(\?v=[0-9a-f]*)?"><\/script>/, `<script src="app/app-test.js?r=${Date.now()}"></script><script>${HOOKS}</script>`);
  let app = fs.readFileSync(path.join(REPO, "app", "app.js"), "utf8");
  app = must(app, 'new URL("worker.js",document.baseURI)', 'new URL("worker-test.js",document.baseURI)');
  app = must(app, "env:{DEMO:true,", 'env:{SHASTRA_FEED_KEY:"test-key-for-local-demo-only-0000000000",DRISHTI_TOKEN_SECRET:"test-secret-for-local-demo-only",DEMO:true,');
  fs.writeFileSync(path.join(REPO, "demo-test.html"), html);
  fs.writeFileSync(path.join(REPO, "app", "app-test.js"), app);
  fs.copyFileSync(path.join(REPO, "worker.js"), path.join(REPO, "worker-test.js"));
  return `${base}/demo-test.html`;
}

const TYPES = { ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript", ".cjs": "application/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".svg": "image/svg+xml" };
/* Serves `root` (default: the parent of the repository, so sibling checkouts of the embedded apps work too). */
function serve(port = 8766, root = REPO) {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      let f = path.join(root, decodeURIComponent(q.url.split("?")[0]));
      if (!f.startsWith(root)) { r.writeHead(403); r.end(); return; }
      if (f.endsWith(path.sep) || f.endsWith("/")) f += "index.html";
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }); r.end(d); });
    });
    s.listen(port, () => res(s));
  });
}

/* Routes a Playwright page's CDN and font requests to local files. */
async function routeCdn(page) {
  await page.context().route("https://cdnjs.cloudflare.com/ajax/libs/**", (r) => {
    const k = r.request().url().split("/ajax/libs/")[1];
    return CDN[k] ? r.fulfill({ path: path.join(N, CDN[k]), contentType: k.endsWith(".wasm") ? "application/wasm" : "application/javascript" }) : r.abort();
  });
  await page.context().route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
}

module.exports = { REPO, prepareDemo, serve, routeCdn };
