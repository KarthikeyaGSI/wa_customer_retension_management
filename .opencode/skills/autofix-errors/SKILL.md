---
name: autofix-errors
description: Use when the project fails to build, type-check, lint, or test. This skill detects every error in the output and fixes each one automatically, then re-verifies until clean. Trigger on phrases like "fix the errors", "build is failing", "autofix", "it didn't compile", or after any command reports TypeScript/ESLint/test/vitest errors.
---

# Autofix Errors

Goal: make the project compile, type-check, lint, and test cleanly with zero
manual intervention. Treat every reported error as a task to resolve.

## When to run

- `npm run build` / `next build` / `tsc` fails (Turbopack, TypeScript errors).
- `npm run lint` / ESLint reports problems.
- `npm test` / `vitest` / `jest` tests fail.
- A deploy (Vercel/CI) fails on a build or type-check step.
- The user says "autofix", "fix every error", "it won't build", etc.

## Procedure

1. **Reproduce the failure.** Run the failing command and capture full output.
   Keep the last ~40 lines; if truncated, re-run capturing to a file and grep it.
   ```
   cd wacrm && npm run build 2>&1 | Select-Object -Last 40
   ```

2. **Enumerate every distinct error.** Do not stop at the first. Collect all of:
   - file path + line:column
   - the symbol/message (duplicate declaration, used before declaration,
     cannot find module, property does not exist, type mismatch, test failure,
     lint rule violation).
   Group duplicates that share a root cause.

3. **Fix each error by root cause.** Prefer minimal, surgical edits:
   - **Duplicate declarations** (e.g. `the name X is defined multiple times`):
     delete the redundant block/import/interface; keep one definition.
   - **Used before declaration / block-scoped variable**: rename the shadowing
     local so it doesn't collide with an outer parameter or declaration.
   - **Cannot find module './x'**: correct the relative import path
     (e.g. `./redis` -> `../redis` for a file one level deeper).
   - **Property does not exist on type**: use the correct BullMQ/API method or
     field name for the installed library version; check
     `node_modules/<pkg>/dist/**/*.d.ts` for the real API.
   - **Type error from async/sync mismatch** (e.g. `Property 'success' does not
     exist on type 'Promise<...>'`): either `await` the call at every call site
     (including test files — make `it`/`test` callbacks `async` and `await`), or
     make the function synchronous if all callers expect that.
   - **Test failures**: align the test with the corrected API (add `await`,
     update field names, update expectations).
   - **Lint**: run the linter's auto-fix where safe, otherwise edit by hand.

4. **Re-verify.** Re-run the same command. If new errors appear, loop back to
   step 2. Continue until the command exits 0 (or tests pass).

5. **Report.** Summarize, grouped by root cause: what was broken, what you
   changed, and the final green result (build OK / N tests passing). Keep it
   concise.

## Guardrails

- Only edit code to fix the reported errors. Do not refactor unrelated code,
  change behavior, or touch secrets/config unrelated to the failure.
- Preserve existing function signatures and public APIs unless the fix requires
  changing them; if so, update ALL call sites consistently.
- Confirm the fix with the actual build/test command, not by inspection alone.
- If an error is environmental (missing env var, network), say so instead of
  guessing a code change.
- Do not commit or push unless the user explicitly asks.
