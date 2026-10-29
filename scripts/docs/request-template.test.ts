// Keeps docs/requesting-a-tool.md in sync with playbooks/new-tool.devin.md: every input the
// playbook needs must have a field in the request template, and the example must use them all.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const playbook = readFileSync(path.join(root, "playbooks/new-tool.devin.md"), "utf8");
const doc = readFileSync(path.join(root, "docs/requesting-a-tool.md"), "utf8");

/** Playbook input (as worded in "Inputs you need from the request") → template field label. */
const INPUTS: Record<string, string> = {
  "tool name": "Tool name:",
  "owner team": "Owner team:",
  "users and roles": "Users and roles:",
  data: "Data:",
  actions: "Actions:",
  "approval rules": "Approval rules:",
  notifications: "Notifications:",
  lifecycle: "Lifecycle:",
};

const inputsLine = playbook.split("\n").find((l) => l.startsWith("**Inputs you need from the request:**")) ?? "";
const template = doc.slice(doc.indexOf("## Request template"), doc.indexOf("## Short-lived tools"));
const example = doc.slice(doc.indexOf("## Example"));

describe("tool request template", () => {
  it("covers every input the new-tool playbook asks for", () => {
    for (const [input, field] of Object.entries(INPUTS)) {
      expect(inputsLine.toLowerCase(), `playbook input "${input}"`).toContain(input);
      expect(template, `template field ${field}`).toContain(field);
      expect(example, `example field ${field}`).toContain(field);
    }
  });

  it("points requesters at the playbook and the PR naming it produces", () => {
    expect(doc).toContain("playbooks/new-tool.devin.md");
    expect(playbook).toContain("`tool: <name>`");
    expect(doc).toContain("`tool: <name>`");
    expect(playbook).toContain("tool: remove <name>");
    expect(doc).toContain("tool: remove <name>");
  });

  it("uses only roles that exist on the platform", () => {
    expect(playbook).toContain("`Analyst` | `Reviewer` | `Admin`");
    for (const role of ["Analyst", "Reviewer", "Admin"]) expect(template).toContain(role);
  });
});
