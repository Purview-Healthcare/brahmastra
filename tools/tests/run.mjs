/* Runs every API check (suite1..13: roles, hand-offs, spans, RACI, feedback...) and the sweep that calls every
   server operation with good and bad input looking for crashes. Exits non-zero if anything fails. */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const runs = ["suite1.mjs", "suite2.mjs", "suite3.mjs", "suite4.mjs", "suite5.mjs", "suite6.mjs", "suite7.mjs", "suite8.mjs", "suite9.mjs", "suite10.mjs", "suite11.mjs", "suite12.mjs", "suite13.mjs", "suite14.mjs", "suite15.mjs", "suite16.mjs", "suite17.mjs", "suite18.mjs", "suite19.mjs", "suite20.mjs", "suite21.mjs", "suite22.mjs", "suite23.mjs", "suite24.mjs", "suite25.mjs", "sweep.mjs"];
let failed = 0;
for (const f of runs) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { cwd: here, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || "") + (r.stderr || "");
  const sum = (out.match(/^==== .*$/m) || out.match(/^ops swept:.*$/m) || ["(no summary)"])[0];
  // a suite fails on a non-zero exit, and also whenever its summary counts a failure
  let bad = r.status !== 0 || /\b[1-9]\d* failed\b/.test(sum);
  if (f === "sweep.mjs") { const m = out.match(/crashes: (\d+)/); bad = !m || Number(m[1]) > 0; }
  console.log((bad ? "FAIL " : "ok   ") + f.padEnd(12) + sum);
  if (bad) { failed++; console.log(out.split("\n").filter((l) => /FAIL|Error|crash|\{"op"/.test(l)).slice(0, 40).join("\n")); }
}
console.log(failed ? `\n${failed} of ${runs.length} failed.` : `\nAll ${runs.length} passed.`);
process.exit(failed ? 1 : 0);
