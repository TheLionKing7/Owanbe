// Fails the build if the JavaScript loaded on first paint of "/" exceeds the budget.
// Initial = the entry chunk plus the chunks it statically imports (lazy routes excluded).
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const BUDGET_KB = Number(process.env.INITIAL_JS_BUDGET_KB ?? 100);
const dist = path.resolve("dist");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const initial = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]));

let total = 0;
for (const file of initial) {
  const kb = gzipSync(readFileSync(path.join(dist, file))).length / 1024;
  total += kb;
  console.log(`${file.padEnd(40)} ${kb.toFixed(1)} kB gz`);
}
const lazy = readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js") && !initial.has(`assets/${f}`));
console.log(`initial JS: ${total.toFixed(1)} kB gz (budget ${BUDGET_KB} kB) · ${lazy.length} lazy route chunks`);
if (total > BUDGET_KB) {
  console.error("Initial JS bundle is over budget.");
  process.exit(1);
}
