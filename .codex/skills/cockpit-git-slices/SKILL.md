---
name: cockpit-git-slices
description: Use in the cockpit repository when the user asks to commit changes by folder, module, or slice, especially server, admin, main-project, docs, or root-level support files. Stages and commits each slice separately while preserving unrelated dirty work.
---

# Cockpit Git Slices

Use this skill only inside the `cockpit` repository.

## Slice Boundaries

- `server/`: backend API, parsers, data import, calculation logic, backend tests, backend config.
- `admin/`: admin validation workbench, admin API client, admin UI types, admin routes and mock data.
- `main-project/`: CEO cockpit frontend.
- `doc/` and `docs-site/`: documentation. Commit separately from code unless the docs directly explain the same slice and the user wants them together.
- Root files: commit separately unless they clearly support exactly one slice.

## Workflow

1. Run `git status --short`.
2. Group changed files by the slice above.
3. Inspect each slice diff before staging.
4. Stage only one slice at a time with explicit paths, for example `git add server/...`.
5. Commit each slice separately.
6. Never stage unrelated dirty files or user work outside the active slice.
7. If a change crosses slices, explain the grouping decision before committing.
8. After each successful stage or commit, emit the appropriate Codex git directive in the final response.

## Verification

Before committing a slice, run the smallest relevant check:

- `server/`: targeted `uv run` tests, `py_compile`, or import checks.
- `admin/`: `npm run build` or `npm run typecheck` when practical.
- `main-project/`: `npm run build` or the relevant frontend check when practical.
- Docs-only: spelling/grep sanity check is enough.

If a check cannot run, record the reason in the commit message `Not-tested:` trailer.

## Commit Message

Use the repository Lore Commit Protocol. The first line describes why the change was made.

Example:

```text
Stabilize settlement extraction for income reconciliation

Constraint: Keep AI extraction advisory; deterministic rules own filename and amount fallbacks.
Confidence: high
Scope-risk: narrow
Tested: uv run python -m py_compile app/modules/income_reconciliation/service.py
Not-tested: Full browser upload flow not rerun.
```
