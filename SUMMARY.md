# Build Summary

Running log of what was built per phase, deviations, security exceptions, stubs, and gaps.

## Open blockers / questions

- **No GitHub remote / `gh` auth.** The `gh` token on the build machine is invalid and no remote is configured, so PRs cannot be opened yet. Each phase is committed on its own stacked local branch (`phase-0-setup` → `phase-1-platform` → …). PR descriptions are recorded below so they can be opened as-is once a remote exists (`gh auth login`, `git remote add origin …`, `git push -u origin --all`).

## Phase 0 — Repo setup

**Branch:** `phase-0-setup` (PR: _pending remote_)

Built:
- pnpm workspace monorepo with the spec layout (`packages/models`, `packages/platform`, `services/payments-mock`, `apps/internal-tools`, `scripts/`, `playbooks/`, `docs/`).
- Root `pnpm lint | typecheck | test | build` scripts; shared strict `tsconfig.base.json`; ESLint 10 flat config (typescript-eslint + Next plugin); Vitest.
- Prisma schema with an initial `User` model and migration; Next.js 15 App Router app with Tailwind v4.
- `docs/CONVENTIONS.md` (security rules + stack conventions), `README.md` (Docker or Homebrew Postgres), `.env.example`, `docker-compose.yml`.

Decisions / deviations:
- **Postgres via Homebrew** on the build machine (Docker not installed). `docker-compose.yml` is still provided and documented; app code is identical either way (only `DATABASE_URL` differs).
- **Pinned versions, supply-chain guard.** All direct deps pinned exactly; `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml` so transitive deps never resolve to brand-new releases (a dependency published minutes earlier 404'd during install, which prompted this). Requires pnpm ≥ 10.16 (pinned to 10.34.7 via `packageManager`).
- **Stable majors over bleeding edge:** Next 15.5 (patched), React 19.1, Prisma 6.19, TypeScript 5.9, Vitest 3.2. Newer majors (Next 16, Prisma 7/8, TS 7) exist but are recent and change configuration significantly; upgrading is a follow-up for the weekly dependency PR (Phase 9).
- Workspace packages are consumed as TypeScript source (Next `transpilePackages`), so there is no separate build step for `models`/`platform`.
- ESLint runs once at the root; `next build` skips its own lint pass to avoid a duplicate, divergent config.
