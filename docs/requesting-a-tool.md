# Requesting an internal tool

Anyone (no engineering background needed) can request a new internal tool. Devin builds it on the platform following [`playbooks/new-tool.devin.md`](../playbooks/new-tool.devin.md), and an engineer reviews and merges the PR.

## How to request

1. Post in **`#internal-tools-requests`** and tag **@Devin**.
2. Paste the template below and fill in every section. Plain language is fine.
3. Add this line so Devin follows the platform procedure:
   > Build this following `playbooks/new-tool.devin.md` in `jaanavit/devin`.
4. Devin replies in the thread. If anything is missing or unclear (especially roles or approval rules), it asks before building. Answer in the same thread.
5. Devin opens a PR titled `tool: <name>` and posts the link. An engineer from the owning team reviews it. CI blocks the merge unless lint, typecheck, tests, build and the policy checks (audit on every write, role check on every page and action, no PII in logs, approved outbound hosts only) all pass.
6. After merge, the tool appears in the app catalog for the roles you listed.

What you get automatically (you don't need to ask for it): sign-in with your company account, role-based access, an audit trail of every change and every view of sensitive data, masking of SSN / date of birth / address / document numbers for anyone who isn't a Reviewer, and maker-checker approval where money or risk decisions are involved.

## Request template

```
Tool name: <short name, e.g. "Chargeback tracker">
Owner team: <team accountable for the tool and its data>
Users and roles: <who uses it, mapped to Analyst / Reviewer / Admin, and what each role may do>
Data: <what it shows or changes: existing records (customers, transactions, refunds, KYC cases, feature flags) or new data to store>
Actions: <each thing a user can do: view, search, create, edit, approve, export…>
Approval rules: <which actions need a second person, who may approve, any amount thresholds; or "none">
Notifications: <Slack alerts or reminders, and when; or "none">
Lifecycle: <permanent, or short-lived: when it can be removed>
Anything else: <deadlines, examples, links>
```

Every field maps to an input in the playbook ("Inputs you need from the request"). Roles must be existing platform roles: **Analyst**, **Reviewer** or **Admin**. If your team needs a different group of people, say so and Platform will map the right identity-provider group.

## Short-lived tools

Some tools are needed once: a data fix, a migration helper, a one-off review. Mark them `Lifecycle: short-lived` and say when they can go. They're built the same way (same security rules, audit trail and approvals) and show a **Short-lived** badge in the catalog. **Once the owner confirms the tool has been used, it is removed in a follow-up PR** (`tool: remove <name>`): the route and its catalog entry are deleted. The data it changed and its audit trail stay.

## Example: a short-lived backfill tool

> @Devin Build this following `playbooks/new-tool.devin.md` in `jaanavit/devin`.
>
> ```
> Tool name: MCC backfill
> Owner team: Risk
> Users and roles: Risk team only. Analysts preview the affected transactions and
>   submit a backfill run; Reviewers approve or reject the run. No access for anyone else.
> Data: Existing transactions from last calendar month whose merchant category code
>   (MCC) is missing. The correct MCC comes from the merchant's most common MCC on
>   its other transactions. Show transaction ID, date, merchant, amount and the
>   proposed MCC. No customer personal data is needed.
> Actions:
>   - Preview: list last month's transactions with a missing MCC and the proposed
>     code, with counts per merchant; flag merchants where no MCC can be inferred.
>   - Submit a backfill run (Analyst) for the transactions that have a proposed MCC.
>   - Approve or reject the run (Reviewer), with a reason when rejecting.
>   - Once approved, apply it in batches and show progress and a final summary.
>   - Export the preview to CSV.
> Approval rules: Every run needs a Reviewer's approval, and the approver can't be the
>   Analyst who submitted it. Nothing is changed before approval.
> Notifications: Slack message when a run is submitted, and when it finishes
>   (counts only).
> Lifecycle: Short-lived. Remove once last month's backfill has run and Risk has
>   checked the results (expected within two weeks).
> Anything else: Must not touch transactions outside last month, or any that already
>   have an MCC.
> ```

How Devin builds this, following the playbook:
- **Catalog:** an `mcc-backfill` tool, owner Risk, roles Analyst and Reviewer, `lifecycle: "short-lived"`.
- **Approval:** each run is an approval request (`createApprovalRequest`) that only a different Reviewer can approve. Nothing is written before approval.
- **Audit:** every batch update is audited with before/after MCCs and transaction IDs.
- **Notifications:** submissions and the finished summary go through `notify()`.
- **Data protection:** the preview and CSV contain no PII fields.
- **Tests:** RBAC, audit and approval tests, plus a test that transactions outside last month, or with an existing MCC, are never changed.
- **Removal:** after Risk confirms, a follow-up PR `tool: remove mcc-backfill` deletes the route and catalog entry. The updated transactions and the audit trail remain.

The seed data already contains this case: about 2% of transactions are missing an MCC (`scripts/seed/generate.ts`).
