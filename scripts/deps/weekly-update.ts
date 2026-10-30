// Weekly dependency upgrade (run by .github/workflows/weekly-deps.yml, or locally: pnpm deps:update).
// For every exactly-pinned dependency in the workspace, bumps to the newest release that:
//   - has the same major version (majors are listed for manual follow-up, never auto-applied),
//   - is not a prerelease, and
//   - was published at least MIN_AGE_DAYS ago (same supply-chain rule as minimumReleaseAge).
// Writes the updated package.json files and a Markdown summary to $DEPS_SUMMARY_FILE (if set).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const MIN_AGE_DAYS = 7;
const ROOT = path.resolve(__dirname, "../..");
const MANIFESTS = ["package.json", "packages/models/package.json", "packages/platform/package.json", "services/payments-mock/package.json", "apps/internal-tools/package.json"];
const SECTIONS = ["dependencies", "devDependencies"] as const;
const EXACT = /^(\d+)\.(\d+)\.(\d+)$/;

type Parsed = [number, number, number];
const parse = (v: string): Parsed | undefined => {
  const m = EXACT.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};
const cmp = (a: Parsed, b: Parsed) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export interface Pick {
  sameMajor?: string;
  newerMajor?: string;
}

/** Pure: given the registry's `time` map, choose upgrade targets for `current`. */
export function pickVersions(current: string, times: Record<string, string>, now = Date.now(), minAgeDays = MIN_AGE_DAYS): Pick {
  const cur = parse(current);
  if (!cur) return {};
  const cutoff = now - minAgeDays * 86_400_000;
  const eligible = Object.entries(times)
    .filter(([v, t]) => parse(v) && Date.parse(t) <= cutoff)
    .map(([v]) => [v, parse(v)!] as const)
    .filter(([, p]) => cmp(p, cur) > 0)
    .sort((a, b) => cmp(a[1], b[1]));
  const sameMajor = eligible.filter(([, p]) => p[0] === cur[0]).at(-1)?.[0];
  const newerMajor = eligible.filter(([, p]) => p[0] > cur[0]).at(-1)?.[0];
  return { sameMajor, newerMajor };
}

function registryTimes(name: string): Record<string, string> {
  const out = execFileSync("npm", ["view", name, "time", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out) as Record<string, string>;
}

function main(): void {
  const cache = new Map<string, Record<string, string>>();
  const updates: string[] = [];
  const majors = new Map<string, string>();
  for (const rel of MANIFESTS) {
    const file = path.join(ROOT, rel);
    const pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, string> | undefined>;
    let changed = false;
    for (const section of SECTIONS) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (!parse(version)) continue; // workspace:*, ranges, etc.
        if (!cache.has(name)) cache.set(name, registryTimes(name));
        const pick = pickVersions(version, cache.get(name)!);
        if (pick.sameMajor) {
          pkg[section]![name] = pick.sameMajor;
          updates.push(`| \`${name}\` | ${rel} | ${version} | ${pick.sameMajor} |`);
          changed = true;
        }
        if (pick.newerMajor) majors.set(name, `${version} → ${pick.newerMajor}`);
      }
    }
    if (changed) writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const summary = [
    `### Dependency updates (same major, published ≥ ${MIN_AGE_DAYS} days ago)`,
    updates.length ? ["| Package | Manifest | From | To |", "| --- | --- | --- | --- |", ...updates].join("\n") : "_None._",
    "",
    "### Major upgrades available (not applied; need a manual PR)",
    majors.size ? [...majors].map(([n, v]) => `- \`${n}\`: ${v}`).join("\n") : "_None._",
  ].join("\n");
  console.log(summary);
  if (process.env.DEPS_SUMMARY_FILE) writeFileSync(process.env.DEPS_SUMMARY_FILE, summary);
  console.log(`\n${updates.length} update(s) applied.`);
}

if (require.main === module) main();
