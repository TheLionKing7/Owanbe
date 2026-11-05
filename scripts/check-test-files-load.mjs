// CI gate for F-80: prove that every test file vitest is supposed to run actually ran.
//
// Why this exists: `vitest run` prints the passing tests of the files that collected and treats an
// unloadable file as a separate complaint. On 2026-11-05 that produced "99 tests pass, 0 fail"
// while four React suites had never loaded for the missing @testing-library/dom peer — a green
// suite that was quietly 11 files short. This script compares the files on disk against the files
// in the JSON report and fails on the difference, so a missing dependency can no longer look like
// a passing build.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
// vitest.config.ts owns which files are tests. Mirroring it here is only safe if a change to that
// pattern is noticed, so an unexpected shape aborts instead of silently checking less than before.
const config = readFileSync(path.join(root, "vitest.config.ts"), "utf8");
const PATTERN = /include:\s*\[\s*"src\/\*\*\/\*\.\{test,spec\}\.\{ts,tsx\}"\s*\]/;
if (!PATTERN.test(config)) {
  console.error(
    'check-test-files-load: vitest.config.ts no longer has include: ["src/**/*.{test,spec}.{ts,tsx}"].\n' +
      "Update this script to match it — do not let the gate keep checking the old pattern.",
  );
  process.exit(1);
}
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name))
      : TEST_FILE.test(entry.name)
        ? [path.relative(root, path.join(dir, entry.name)).replace(/\\/g, "/").toLowerCase()]
        : [],
  );
const expected = new Set(walk(path.join(root, "src")));
const relative = (file) => path.relative(root, file).replace(/\\/g, "/").toLowerCase();

const dir = mkdtempSync(path.join(tmpdir(), "owanbe-test-load-"));
const report = path.join(dir, "vitest.json");
// dot reporter keeps the CI log readable; the json file is what this script judges.
const run = spawnSync(
  process.execPath,
  [
    path.join("node_modules", "vitest", "vitest.mjs"),
    "run",
    "--reporter=dot",
    "--reporter=json",
    `--outputFile.json=${report}`,
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, CI: "true" } },
);
let json;
try {
  json = JSON.parse(readFileSync(report, "utf8"));
} catch {
  console.error(
    `check-test-files-load: vitest exited ${run.status} without writing a JSON report, so nothing was verified.`,
  );
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const ran = json.testResults.map((file) => ({
  file: relative(file.name),
  status: file.status,
  tests: file.assertionResults.length,
  message: file.message,
}));
const ranByFile = new Map(ran.map((entry) => [entry.file, entry]));

const neverLoaded = [...expected].filter((file) => !ranByFile.has(file));
const notExpected = ran.map((entry) => entry.file).filter((file) => !expected.has(file));
const emptySuites = ran.filter((entry) => entry.tests === 0);
const failedSuites = ran.filter((entry) => entry.status === "fail");

console.log(
  `\ncheck-test-files-load: ${ran.length} of ${expected.size} test files loaded · ` +
    `${json.numPassedTests}/${json.numTotalTests} tests passed · ${json.numFailedTests} failed`,
);

const problems = [];
const list = (files) => files.map((file) => `    ${file}`).join("\n");
if (neverLoaded.length)
  problems.push(
    `${neverLoaded.length} test file(s) on disk produced no results, which means they failed to load:\n${list(neverLoaded)}`,
  );
if (notExpected.length)
  problems.push(`results for file(s) the config does not include:\n${list(notExpected)}`);
if (emptySuites.length)
  problems.push(
    `loaded but collected no test:\n${list(emptySuites.map((e) => `${e.file}${e.message ? ` — ${e.message}` : ""}`))}`,
  );
if (failedSuites.length) problems.push(`failed suites:\n${list(failedSuites.map((e) => e.file))}`);
if (json.numFailedTests > 0) problems.push(`${json.numFailedTests} failing test(s)`);
if (!json.success)
  problems.push("vitest reported success: false (an unhandled error outside any test)");
if (run.status !== 0) problems.push(`vitest exited ${run.status}`);

if (problems.length) {
  console.error(`\nFAIL\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("OK — every test file on disk was collected and passed.");
