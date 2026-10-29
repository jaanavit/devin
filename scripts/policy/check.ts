// Static policy checks for the security rules in docs/CONVENTIONS.md. Fails CI when:
//   1. a server action / API route / page writes to the DB without a reachable audit() call
//   2. a server action / API route / page has no requireRole()/requirePageRole() call
//   3. a console.* call logs a field named ssn, dob, documentNumber or address
//   4. code calls fetch() directly (instead of outboundFetch) or targets a non-allowlisted host
import ts from "typescript";
import { isExcepted } from "./exceptions";

export type RuleId = 1 | 2 | 3 | 4;

export const RULES: Record<RuleId, { code: string; title: string; doc: string }> = {
  1: { code: "POLICY-1", title: "audit-on-write", doc: "Every mutation is audited: call audit() from @fintech/platform/server (docs/CONVENTIONS.md rule 1)." },
  2: { code: "POLICY-2", title: "require-role", doc: "Deny by default: call requireRole() (actions/routes) or requirePageRole() (pages) (docs/CONVENTIONS.md rule 2)." },
  3: { code: "POLICY-3", title: "no-pii-logging", doc: "Never log PII: log IDs instead of ssn, dob, documentNumber or address (docs/CONVENTIONS.md rule 3)." },
  4: { code: "POLICY-4", title: "outbound-allowlist", doc: "Outbound calls only via outboundFetch()/paymentsClient() to allowlisted hosts (docs/CONVENTIONS.md rule 5)." },
};

export interface Violation {
  rule: RuleId;
  file: string;
  line: number;
  message: string;
}

/** Map of repo-relative path → file contents. */
export type Sources = ReadonlyMap<string, string>;

const APP_ROOT = "apps/internal-tools/";
const APP_DIR = `${APP_ROOT}app/`;
const PII = new Set(["ssn", "dob", "documentNumber", "address"]);
const DB_ROOTS = new Set(["prisma", "tx", "db"]);
const WRITE_METHODS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const RAW_WRITES = new Set(["$executeRaw", "$executeRawUnsafe"]);
/** Platform helpers that write and audit internally. */
const AUDITED_HELPERS = new Set(["audit", "createApprovalRequest", "approveRequest", "rejectRequest", "runJob"]);
const ROLE_GUARDS = new Set(["requireRole", "requirePageRole"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const CONSOLE_METHODS = new Set(["log", "info", "warn", "error", "debug", "trace"]);
const FORBIDDEN_HTTP_MODULES = new Set(["axios", "node-fetch", "got", "superagent", "undici", "cross-fetch"]);
/** The only file allowed to call fetch() directly. */
const OUTBOUND_IMPL = "packages/platform/src/outbound.ts";
export const STATIC_ALLOWED_HOSTS = ["hooks.slack.com", "*.sentry.io", "api.devin.ai", "api.anthropic.com", "api.openai.com", "localhost", "127.0.0.1"];

const isTest = (f: string) => /\.test\.tsx?$/.test(f) || f.includes("/__fixtures__/");
const isSource = (f: string) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts");

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
}

function calleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return undefined;
}

function rootIdentifier(expr: ts.Expression): string | undefined {
  let e: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e)) {
    e = ts.isCallExpression(e) ? e.expression : (e as ts.PropertyAccessExpression | ts.NonNullExpression | ts.ParenthesizedExpression).expression;
  }
  return ts.isIdentifier(e) ? e.text : undefined;
}

/** `prisma.refund.update(...)`, `tx.kycCase.updateMany(...)`, `tx.$executeRaw\`...\`` → description, else undefined. */
function dbWrite(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const target = node.expression.expression;
    if (WRITE_METHODS.has(method) && ts.isPropertyAccessExpression(target) && DB_ROOTS.has(rootIdentifier(target) ?? "")) return node.expression.getText(sf);
    if (RAW_WRITES.has(method) && DB_ROOTS.has(rootIdentifier(target) ?? "")) return node.expression.getText(sf);
  }
  if (ts.isTaggedTemplateExpression(node) && ts.isPropertyAccessExpression(node.tag) && RAW_WRITES.has(node.tag.name.text) && DB_ROOTS.has(rootIdentifier(node.tag.expression) ?? "")) {
    return node.tag.getText(sf);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Module graph (for following local helpers called by actions/routes)
// ---------------------------------------------------------------------------

interface FnRef {
  file: string;
  sf: ts.SourceFile;
  node: ts.Node;
}

class Project {
  private parsed = new Map<string, ts.SourceFile>();
  constructor(readonly sources: Sources) {}

  sf(file: string): ts.SourceFile | undefined {
    const text = this.sources.get(file);
    if (text === undefined) return undefined;
    let sf = this.parsed.get(file);
    if (!sf) this.parsed.set(file, (sf = parse(file, text)));
    return sf;
  }

  resolve(from: string, spec: string): string | undefined {
    let base: string;
    if (spec.startsWith("@/")) base = APP_ROOT + spec.slice(2);
    else if (spec.startsWith(".")) {
      const parts = from.split("/").slice(0, -1);
      for (const seg of spec.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      base = parts.join("/");
    } else return undefined;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => this.sources.has(c) && isSource(c));
  }

  /** Top-level function-like declarations of `file` and of every local module it imports (transitively). */
  functionIndex(file: string): Map<string, FnRef[]> {
    const index = new Map<string, FnRef[]>();
    const seen = new Set<string>();
    const visit = (f: string) => {
      if (seen.has(f)) return;
      seen.add(f);
      const sf = this.sf(f);
      if (!sf) return;
      for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
          const target = this.resolve(f, st.moduleSpecifier.text);
          if (target) visit(target);
        }
        const add = (name: string, node: ts.Node) => index.set(name, [...(index.get(name) ?? []), { file: f, sf, node }]);
        if (ts.isFunctionDeclaration(st) && st.name && st.body) add(st.name.text, st.body);
        if (ts.isVariableStatement(st)) {
          for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) add(d.name.text, d.initializer);
        }
      }
    };
    visit(file);
    return index;
  }
}

interface Entry {
  name: string;
  node: ts.Node;
  kind: "route" | "page" | "action";
}

function hasUseServer(sf: ts.SourceFile): boolean {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
}

function entriesOf(file: string, sf: ts.SourceFile): Entry[] {
  const isRoute = /(^|\/)route\.tsx?$/.test(file);
  const isPage = /(^|\/)page\.tsx?$/.test(file);
  const isAction = hasUseServer(sf);
  if (!isRoute && !isPage && !isAction) return [];
  const exported = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n: ts.Node) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  const out: Entry[] = [];
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body && exported(st)) {
      const name = st.name?.text ?? "default";
      if (isPage && isDefault(st)) out.push({ name, node: st.body, kind: "page" });
      else if (isRoute && HTTP_METHODS.has(name)) out.push({ name, node: st.body, kind: "route" });
      else if (isAction) out.push({ name, node: st.body, kind: "action" });
    }
    if (ts.isVariableStatement(st) && exported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (isRoute && HTTP_METHODS.has(d.name.text)) out.push({ name: d.name.text, node: d.initializer, kind: "route" });
        else if (isAction && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) out.push({ name: d.name.text, node: d.initializer, kind: "action" });
      }
    }
    if (ts.isExportAssignment(st) && isPage) out.push({ name: "default", node: st.expression, kind: "page" });
  }
  return out;
}

/** Walks `entry` plus every local helper it references (by name), calling `visit` on each node. */
function reachable(project: Project, file: string, entry: ts.Node, visit: (n: ts.Node, sf: ts.SourceFile, file: string) => void): void {
  const index = project.functionIndex(file);
  const done = new Set<ts.Node>();
  const queue: FnRef[] = [{ file, sf: project.sf(file)!, node: entry }];
  while (queue.length) {
    const ref = queue.pop()!;
    if (done.has(ref.node)) continue;
    done.add(ref.node);
    walk(ref.node, (n) => {
      visit(n, ref.sf, ref.file);
      if (ts.isIdentifier(n)) for (const target of index.get(n.text) ?? []) if (!done.has(target.node)) queue.push(target);
    });
  }
}

function checkEntries(project: Project, file: string, out: Violation[]): void {
  const sf = project.sf(file)!;
  for (const entry of entriesOf(file, sf)) {
    const label = entry.kind === "page" ? "page" : entry.kind === "route" ? `route handler \`${entry.name}\`` : `server action \`${entry.name}\``;

    // Rule 2: a role guard inside the entry itself.
    let guarded = false;
    walk(entry.node, (n) => {
      if (ts.isCallExpression(n) && ROLE_GUARDS.has(calleeName(n.expression) ?? "")) guarded = true;
    });
    if (!guarded && !isExcepted(2, file)) {
      out.push({ rule: 2, file, line: lineOf(sf, entry.node), message: `${label} never calls ${entry.kind === "page" ? "requirePageRole()" : "requireRole()"}.` });
    }

    // Rule 1: any reachable DB write needs a reachable audit().
    let firstWrite: { what: string; file: string; line: number } | undefined;
    let audited = false;
    reachable(project, file, entry.node, (n, nsf, nfile) => {
      const w = dbWrite(n, nsf);
      if (w && !firstWrite) firstWrite = { what: w, file: nfile, line: lineOf(nsf, n) };
      if (ts.isCallExpression(n) && AUDITED_HELPERS.has(calleeName(n.expression) ?? "")) audited = true;
    });
    if (firstWrite && !audited && !isExcepted(1, file)) {
      const where = firstWrite.file === file ? `line ${firstWrite.line}` : `${firstWrite.file}:${firstWrite.line}`;
      out.push({ rule: 1, file, line: lineOf(sf, entry.node), message: `${label} writes to the database (${firstWrite.what} at ${where}) but never calls audit().` });
    }
  }
}

function piiIn(node: ts.Node): string | undefined {
  let found: string | undefined;
  walk(node, (n) => {
    if (found) return;
    if (ts.isIdentifier(n) && PII.has(n.text)) found = n.text;
    else if (ts.isPropertyAccessExpression(n) && PII.has(n.name.text)) found = n.name.text;
    else if (ts.isElementAccessExpression(n) && ts.isStringLiteral(n.argumentExpression) && PII.has(n.argumentExpression.text)) found = n.argumentExpression.text;
  });
  return found;
}

export function hostAllowed(url: string, extraHosts: readonly string[] = []): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return [...STATIC_ALLOWED_HOSTS, ...extraHosts].some((e) => (e.startsWith("*.") ? host.endsWith(e.slice(1)) : host === e));
}

function literalUrl(arg: ts.Expression | undefined): string | undefined {
  if (!arg) return undefined;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  if (ts.isTemplateExpression(arg) && /^https?:\/\//.test(arg.head.text)) return arg.head.text;
  return undefined;
}

function checkFile(project: Project, file: string, out: Violation[]): void {
  const sf = project.sf(file)!;
  walk(sf, (n) => {
    // Rule 3: PII in console.* arguments.
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "console" && CONSOLE_METHODS.has(n.expression.name.text)) {
      for (const arg of n.arguments) {
        const field = piiIn(arg);
        if (field && !isExcepted(3, file)) {
          out.push({ rule: 3, file, line: lineOf(sf, n), message: `console.${n.expression.name.text}() logs the PII field \`${field}\`.` });
          break;
        }
      }
    }
    // Rule 4: direct fetch, literal hosts, and alternative HTTP clients.
    if (ts.isCallExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "globalThis" ? n.expression.name.text : undefined;
      if (name === "fetch" && file !== OUTBOUND_IMPL && !isExcepted(4, file)) {
        out.push({ rule: 4, file, line: lineOf(sf, n), message: "calls fetch() directly; use outboundFetch() (or paymentsClient()) so the host allowlist is enforced." });
      }
      if (name === "outboundFetch" || (name === "fetch" && file === OUTBOUND_IMPL)) {
        const url = literalUrl(n.arguments[0]);
        if (url && !hostAllowed(url) && !isExcepted(4, file)) out.push({ rule: 4, file, line: lineOf(sf, n), message: `calls a host that is not on the outbound allowlist (${url}).` });
      }
    }
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && FORBIDDEN_HTTP_MODULES.has(n.moduleSpecifier.text) && !isExcepted(4, file)) {
      out.push({ rule: 4, file, line: lineOf(sf, n), message: `imports the HTTP client "${n.moduleSpecifier.text}"; use outboundFetch() instead.` });
    }
  });
}

/** Runs all checks over `sources` (repo-relative paths). */
export function checkSources(sources: Sources): Violation[] {
  const project = new Project(sources);
  const out: Violation[] = [];
  for (const file of [...sources.keys()].sort()) {
    if (!isSource(file) || isTest(file)) continue;
    if (file.startsWith(APP_DIR)) checkEntries(project, file, out);
    checkFile(project, file, out);
  }
  return out;
}

export function formatViolation(v: Violation): string {
  const r = RULES[v.rule];
  return `✖ [${r.code} ${r.title}] ${v.file}:${v.line}\n    ${v.message}\n    Rule: ${r.doc}`;
}

export function githubAnnotation(v: Violation): string {
  const r = RULES[v.rule];
  return `::error file=${v.file},line=${v.line},title=${r.code} ${r.title}::${v.message} ${r.doc}`;
}
