// CLI: pnpm policy   (exit code 1 on any violation; GitHub annotations when run in Actions)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { RULES, checkSources, formatViolation, githubAnnotation, type RuleId } from "./check";

const ROOT = path.resolve(__dirname, "../..");
const SCAN = ["apps", "packages", "services", "scripts"];
const SKIP = new Set(["node_modules", ".next", "dist", "coverage", ".turbo"]);

function collect(dir: string, out: Map<string, string>): void {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(name)) out.set(path.relative(ROOT, full).split(path.sep).join("/"), readFileSync(full, "utf8"));
  }
}

const sources = new Map<string, string>();
for (const d of SCAN) collect(path.join(ROOT, d), sources);
const violations = checkSources(sources);

if (violations.length === 0) {
  console.log(`Policy checks passed (${sources.size} files; rules: ${Object.values(RULES).map((r) => `${r.code} ${r.title}`).join(", ")}).`);
} else {
  for (const v of violations) console.error(`${formatViolation(v)}\n`);
  if (process.env.GITHUB_ACTIONS) for (const v of violations) console.log(githubAnnotation(v));
  const byRule = new Map<RuleId, number>();
  for (const v of violations) byRule.set(v.rule, (byRule.get(v.rule) ?? 0) + 1);
  console.error(`Policy checks FAILED: ${[...byRule].map(([r, n]) => `${n} × ${RULES[r].code} ${RULES[r].title}`).join(", ")}`);
  process.exitCode = 1;
}
