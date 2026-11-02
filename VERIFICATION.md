# Verification

The historical sections below were imported from the local helper prototype. Their checks, paths and commit references describe that prototype, not new executions in this repository. Replacement-package checks are recorded separately below.

## Rust replacement package candidate (1.0.0, unpublished)

Environment: macOS arm64, Node v24.20.0, installed Pi 1.5.0.

Executed checks in this repository:

- `npm run build`: **passed**, pinned source, locked/offline Cargo build. Both development and stripped distribution helpers were produced. Log: `/tmp/pi-apply-patch-release-build.log`.
- `npm test`: **53 passed, 0 failed, 0 skipped**. Includes real registered-tool distribution path selection, unsupported-host gating, backend/renderer tests, codemode, and the frozen-v1 self-update journey. Log: `/tmp/pi-apply-patch-release-tests.log`.
- `npm run typecheck`: **passed**, with `PI_TSC` selecting the sibling compact-tool checkout's existing TypeScript compiler. Log: `/tmp/pi-apply-patch-release-typecheck.log`.
- `rustfmt --check --edition 2024 backend/standalone_executable.rs`, maintained/generated Rust-source comparison, and `git diff --check`: **passed**.
- `npm pack --dry-run --json` and `npm pack --json`: **passed**. The package has nine files: manifest, two TypeScript modules, helper, README, changelog, and three license/notice files. Helper mode is `0755`; `file` identifies Mach-O arm64. No host-runtime packages, tests or build snapshots are included. Manifests: `/tmp/pi-apply-patch-release-pack-dry.json` and `/tmp/pi-apply-patch-release-pack.json`.
- Local tarball `npm install --legacy-peer-deps`: **passed**, without suppressing lifecycle scripts. Prefix: `/tmp/pi-apply-patch-install-Pq44ZZ`. The installed helper retained executable mode.
- `pi install` of the npm-installed local package, `pi list`, `pi remove`, and another `pi list`: **passed**, using `PI_CODING_AGENT_DIR=/tmp/pi-apply-patch-install-Pq44ZZ/agent`. Registration was confined to temporary settings and removal left no packages registered there. This tests local tarball installation plus Pi registration, not fetching unpublished 1.0.0 from npm.
- `PI_LIVE_EXTENSION=/tmp/pi-apply-patch-install-Pq44ZZ/node_modules/@runminton/pi-apply-patch/index.ts PI_LIVE_MODEL=gpt-6.1-sol npm run test:live`: **passed**. The actual installed/stripped helper handled a two-operation call with a committed first write and failed second update. The real Agent retried only the unfinished work and read both final files. No helper-path override was set. Log: `/tmp/pi-apply-patch-release-live.log`.

Inspectable real-Agent results: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-BeJsBC/`, including `events.jsonl`, `stderr.log`, and `summary.json`. The extension path recorded in the summary points into the temporary npm installation, not this checkout.

Distribution tests were red before implementation: `/tmp/pi-apply-patch-distribution-red.log`. The platform fixture needed loading after mocked process properties because Pi snapshots them when loading the extension. Both distribution tests then passed; focused log: `/tmp/pi-apply-patch-distribution-green.log`. An existing codemode test initially failed because Pi 1.5.0 changed the raw-string argument error wording; the assertion now accepts both observed wordings without changing production behavior.

Limits: other operating systems/architectures were not run or validated; simulated host properties only verify refusal to activate. No new manual desktop/TUI check was performed. Final README-only corrections do not change the runtime files exercised by the installed-package journey. No npm publication, GitHub push, or user-global Pi registration was performed. Legacy branch/tag preservation is local until explicitly pushed.

## Baseline

- Pi: installed version `1.2.0`, Node `v22.23.2`.
- Codex source: `c22a06c18070c3e33bd2648c7210a00a2a9f6f80`; checkout was clean when inspected.
- Original comparison helper: `~/20-dev/90-third-party-repos/codex/codex-rs/target/release/apply_patch`.
- Active helper: this project's `.build/bin/pi-apply-patch`.
- No second parser/engine was added. Pi Core and the original Codex checkout/executable were not changed. The copied CLI entry point is modified inside the generated, pinned source snapshot.

## Executed checks

`npm run build`: **passed**, using `--locked --offline`, fixed source commit and existing Cargo cache.

The generated lockfile differs from upstream only by adding `serde_json` to `codex-apply-patch`'s direct dependencies. Existing dependency versions are unchanged.

`npm run typecheck`: **passed** with the cached TypeScript executable on PATH. The check is strict for the plugin and uses installed Pi/TypeBox/Node declarations with `skipLibCheck`.

Single-file checks passed: **7 backend tests** and **16 adapter/session tests**.

Final `npm test`: **23 passed, 0 failed, 0 skipped**. Log: `/tmp/pi-patch-english-full.log`.
Final typecheck, Rust format check and comparison of compiled snapshot source against the maintained Rust entry point all passed.

Backend checks:

- Later failure returns the unchanged original error and the library's committed prefix.
- Initial deletion failure has no confirmed operations and stops later operations. The library conservatively marks this record inexact; the wrapper preserves that flag.
- Ordered add, update, delete and move records contain no file contents.
- A failed later chunk within one update does not claim an earlier chunk was written.
- A filesystem write error preserves confirmed earlier operations and the library's inexact flag.
- Moving into a writable destination followed by failure to remove the protected source reports only the destination write; both actual files are inspected.
- Successful stdout, stderr and exit code match the original executable, with no added change record.

Adapter/session checks:

- Real Pi extension loading, provider activation/restoration and execution are exercised.
- Patch text preserves Unicode, whitespace, blank lines and the optional final newline through stdin and provider serialization.
- Original output streams are preserved with no separator inserted between them; failure-only status is a distinct appended section.
- Pi agent core receives a failed result for non-zero exits.
- Inexact records reach the model with inspection guidance.
- Agent-facing summaries use English completed-operation labels, preserve repeated paths in execution order, and quote embedded newlines/quotes in paths. Exactness stays in details rather than requiring the Agent to interpret a library flag.
- Empty incomplete records still carry the inspection notice and do not claim that no files changed.
- A helper terminated after a real fixture write yields unknown state, not an empty confirmed record.
- Malformed JSON, invalid record shapes and conflicting exit status cannot produce a trusted record or a successful tool result.
- Official failure text matches a direct invocation, and a subsequent valid patch succeeds.
- Real add/update/move/delete operations and before-start cancellation are checked.
- Default project-local helper selection works without its environment override; unavailable helpers are inactive and reported.

The new backend test initially failed because the program did not exist. The adapter committed-prefix test initially failed because no record was exposed. Existing separator/default-path/startup regressions had also been reproduced before their earlier fixes.

`npm run test:live`: **passed**, using `openai-codex/gpt-6.1-sol`.

This launched the installed Pi CLI with the extension explicitly loaded, other extensions/MCP/context files disabled, and `PI_CODEX_APPLY_PATCH_HELPER_BIN` removed. The old official-helper environment variable remained harmlessly set: the plugin no longer uses it.

The real model issued an exact two-file patch: adding `first.txt` succeeded, then updating `journey.txt` failed. The result preserved the original error and reported the confirmed addition. Without receiving a canned corrected patch, the model recovered by modifying only `journey.txt`, did not repeat the committed addition, and read both files. Only `apply_patch` and `read` were available.

Inspectable results from that run:

```text
/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-dvRSSk/
  events.jsonl
  stderr.log
  summary.json
  first.txt
  journey.txt
```

Live log: `/tmp/pi-patch-english-live.log`. The live test checks the English summary, successful Agent reads of both files, and independent final-content assertions. Build log: `/tmp/pi-patch-build-final.log`. Typecheck log: `/tmp/pi-patch-english-typecheck.log`. Temporary results can be reproduced with the documented commands.

Self-review is recorded in `REVIEW.md`. The initial implementation was subsequently committed as `1ebb593`; the English Agent-output follow-up was reviewed against that baseline.

## Scope and remaining differences

- Codex Core verifies the whole patch before execution through `core/src/tools/handlers/apply_patch.rs` and `apply-patch/src/invocation.rs`. The standalone CLI calls the sequential application path in `apply-patch/src/lib.rs` without that preflight. Partial modification on a later invalid operation was reproduced.
- No whole-patch preflight or rollback is added, by agreement.
- Codex itself can also partially modify files on later write errors. Neither approach should be described as an all-or-nothing transaction.
- Codex approval, sandbox, remote environments and diff tracking are not implemented here. Pi's direct-call sequential scheduling is reused; this is not a filesystem lock across all nested calls, processes or tools.
- On valid responses, original stdout followed by stderr is preserved as a prefix. Failure-only status follows it. Cross-stream temporal ordering is not preserved.
- The Pi serializer uses a placeholder for empty output and sanitizes invalid surrogates. Normal UTF-8 helper success/failure output was tested; arbitrary byte transparency is not promised.
- Startup detection checks existence, executability and regular-file status; execution additionally validates protocol version, shape and exit status.
- Exactness is the official library's textual-change-record flag, not a transactional guarantee or a complete filesystem audit. Parent-directory creation and concurrent external changes are not separately tracked.
- Before-start cancellation and post-write process termination were tested. Actual mid-write termination, disk-full errors and cross-process concurrency were not tested.

The current local workflow now exposes the official library's confirmed changes for Agent recovery. Full native Codex behavior is not claimed.

## Actual diff display

Implemented the two local tickets under `.scratch/actual-diff/issues/` serially. The diff uses the same pinned official library's committed before/after text, not an input-patch preview or filesystem reread.

Executed checks:

- `npm run build`: **passed**, still pinned, locked and offline. Log: `/tmp/pi-patch-diff-build.log`.
- `npm run typecheck`: **passed** using `PI_TSC` with the locally cached TypeScript executable. Log: `/tmp/pi-patch-diff-typecheck-final.log`.
- Rust formatting and maintained-entry-point/generated-snapshot comparison: **passed**.
- Final `npm test`: **38 passed, 0 failed, 0 skipped**. Log: `/tmp/pi-patch-diff-full.log`.
- `PI_LIVE_MODEL=gpt-6.1-sol npm run test:live`: **passed**. Log: `/tmp/pi-patch-diff-live-final.log`.

Backend checks include success and partial-failure before/after records, an incomplete move recording only its destination write, a move onto its own path recording the actual deletion, and strict v1 compatibility for already-loaded adapters.

Registered-tool/renderer checks include per-path net diffs, overwrites, overwritten move destinations, deleted empty files, reverted paths, final-newline notes, CRLF rendering, incomplete records, responsive column selection, unequal line counts and wrapping, Chinese/emoji/tabs, theme invalidation, and persisted-result restore through Pi's real ToolExecutionComponent. Malformed v2 display records are rejected through the registered tool.

A rebuild initially broke the running session's v1 report decoder while file writes still completed. This was reproduced by a failing strict-envelope regression test. The helper now returns v1 by default and serializes display text only when the new adapter explicitly requests v2 in its subprocess. The regression passed, and subsequent real apply_patch calls in the original session returned valid success/failure reports.

Inspectable final rendering results:

```text
/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-rendering-pFVTEw/
  expanded-wide.txt
  expanded-narrow.txt
  expanded-wide.ansi
  performance.json
```

Performance checks:

- A 10,000-line file with one replaced line retained less than 2 KB in valid tool details; distant unchanged regions and raw snapshots were absent.
- A 500-line replacement rendered completely in both layouts. A focused run recorded about 43 ms for helper execution plus diff preparation, 130 ms for the first wide layout, and 0.12 ms for 100 cached renders. These are local observations, not portable performance limits. Focused measurements: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-rendering-Cl7AXI/performance.json`.
- Collapsed rendering does not prepare colored diff rows. Valid results persist one unstyled compact diff per path, not full before/after snapshots or parallel layout copies.

Final real-model results:

```text
/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-lr3Nhm/
  events.jsonl
  stderr.log
  summary.json
```

The Agent failed the intended second operation, recovered without repeating the first write, read both files, and returned the expected compact actual diffs for the failed and recovered calls.

Remaining boundaries: no manual full-terminal screenshot/mouse-click check was performed; the real tool component's expansion and rendering APIs were exercised directly. Very large expanded diffs still cost time proportional to displayed content; no viewport virtualization or background computation was added. Incomplete library records remain incomplete, and earlier persisted results without display data retain their text fallback.

## Screenshot-driven presentation correction

The user's isolated-plugin screenshot exposed a background-compositing defect missed by the original plain-text checks. A real ToolExecutionComponent regression reproduced it: `Before` had foreground styling but no tool background after HStack's segment reset. That check failed before the correction and passed afterward.

Measured equal-width column placement already passed before the correction. Checks at 102, 120, 121 and 160 terminal columns verify one stable divider position across all rows, within half a cell of the padded tool shell's center. No replacement column-allocation scheme was needed.

The renderer now reapplies the shell's background after segment resets, uses single-column display for added/deleted files, shortens captions without parent-directory ladders, removes inverse word blocks, and avoids allocating a styled empty newline-note row. Backend execution, protocol, persistence and Agent-facing content are unchanged.

Executed checks:

- Final `npm test`: **44 passed, 0 failed, 0 skipped**. Log: `/tmp/pi-patch-ui-full.log`.
- Strict typecheck: **passed**. Log: `/tmp/pi-patch-ui-typecheck.log`.
- Real Agent recovery: **passed**, `openai-codex/gpt-6.1-sol`. Log: `/tmp/pi-patch-ui-live.log`; results: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-nGI5bc/`.
- Background checks cover dark/light themes, success/error/pending shells, narrow/wide widths and wrapped rows. The renderer tests enable interactive-terminal text attributes through the installed Chalk API, so inverse/bold behavior is exercised even without a TTY.
- Actual added→updated/deleted tool-block output was exported with Pi's ANSI-to-HTML converter and inspected in a browser at wide/narrow sizes. This is a preview of real component output, not a screenshot of the full interactive terminal.

Inspectable final test results: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-rendering-NHrNRU/`, including `visual.html`, `visual-narrow.html`, ANSI/text output and performance measurements.

Inspected previews from the focused run:

```text
/tmp/pi-patch-ui-before.png
/tmp/pi-patch-ui-after.png
/tmp/pi-patch-ui-narrow.png
```

## Self-modification continuity regression

Added `test/self-update.test.mjs` to the existing `npm test` discovery. It loads the frozen v1 extension from `0acb240` through the installed Pi SDK, then exercises its registered tool in a real in-memory session:

- The loaded v1 tool replaces its own temporary entry file with the current extension source, using the real Rust patch engine.
- A simulated v1-only helper transport is replaced at the same temporary path by the built current helper. The session keeps the original tool instance.
- That tool successfully edits another file, reports an earlier committed addition on a later failure, and completes recovery.
- `session.reload()` loads the edited extension; its next call succeeds and returns the expected compact v2 diff.

The fixture matches `0acb240:index.ts` exactly after its provenance comment. It is a frozen historical adapter, not a new test implementation of the tool. The old-helper transport projects the real helper's v2 result into the old v1 envelope; this is not an archived old helper executable. Actual filesystem writes and replacement-helper records come from the built Rust helper.

Executed checks:

- Focused upgrade test: **passed**. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/self-update-test-uWFftA`.
- Full `npm test`: **45 passed, 0 failed, 0 skipped**. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/retro-full-tests-5xBZL1`.
- `npm run typecheck`: **passed**, with `PI_TSC` selecting the existing cached compiler. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/retro-typecheck-UMXFjD`.
- Isolated negative control: **passed**. Forcing the replacement helper to emit only v2 made the new upgrade test fail at the old adapter's decoder, after a file write. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-v2-only-mutation-5GztyZ/mutation.log`.
- Frozen-fixture comparison and `git diff --check`: **passed**.

Inspectable successful journey: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-self-update-gnlrvQ/`, containing the edited plugin, replacement helper, final files and `results.json`. The negative-control workspace is separate; the active project helper was not modified.

No runtime implementation or Agent-visible result semantics changed. Cargo rebuilding, concurrent calls during helper replacement and a model-driven `/reload` journey were not exercised in this check. The existing real-Agent recovery test was not rerun.

## Codemode argument-form regression

The session contained a failed `tools.apply_patch(patchString)` call, rejected with `root: must be object`. A same-patch probe reproduced that validation error without writing the target file; `tools.apply_patch({ patch })` then succeeded and its file was read back. Observations are saved under `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-codemode-probe-ERQLMa/observations.json`.

The tool's description said “do not wrap the patch in JSON” without limiting that instruction to direct model calls, while codemode's generated declaration required `{ patch: string }`. The description now states both entry points explicitly. No schema, grammar, helper protocol or codemode implementation changed. The observation establishes the argument-validation failure; it does not establish why the model chose that form or guarantee that clearer guidance prevents every future misuse.

Added `test/codemode.test.mjs`, using the installed codemode extension, a real in-memory Pi session and the registered patch tool. A recorded assistant tool call supplies the parent context required by nested calls. The test checks generated call guidance, rejection of a raw string, successful object invocation and independent file contents. It first failed for missing guidance. An intermediate run with the updated guidance failed because the initial test setup lacked the parent assistant message; after correcting that setup, the test passed.

Executed checks:

- Focused regression: **passed**. Initial missing-guidance log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/codemode-red-sFxYPD`; passing log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/codemode-green-yyVYkC`.
- Full `npm test`: **46 passed, 0 failed, 0 skipped**. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/codemode-full-4Tg14K`.
- Strict typecheck: **passed**. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/codemode-typecheck-d9hlmM`.
- Real Agent recovery: **passed**, `openai-codex/gpt-6.1-sol`. Log: `/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/codemode-live-Cnqh3N`; results: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-eDxGeu/`.

Inspectable codemode result: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-codemode-VDqBGi/result.json`. The live model test covers direct calls and recovery, not model selection of the codemode argument form. Newly loaded extensions expose the updated description; the original running session was not reloaded.

## Compact-tool integration, large diffs and simple moves

Validated against the installed Pi **1.4.0**, Node **v22.23.2**, and the sibling `22-pi-compact-tool` checkout. No helper, Rust engine, protocol or model-facing recovery content changed.

The original screenshot symptom was reproduced through real ToolExecutionComponent instances: one copy of the recovery section without compact-tool, two in tidy/aggregate. A one-line native Text result reproduces the same duplication. The compact adapter now supplies the native expanded body to its existing shell, rather than both mutating a compact shell with a generic body and returning another native body. Aggregate's existing painted-layout cache now covers the native body as well.

Red-before-green checks:

- Compact expanded-error regression failed with `2 !== 1`, then passed.
- A 2000-line replacement's initial wide layout took **499.8ms**, failing a **250ms** regression budget; after replacing per-row HStack compositing with padded Text columns, the regression passed.
- Pure and edited move regressions failed because unchanged files were shown as full deletion/addition, then passed with conservative move pairing.

Executed checks:

- Current project `npm test`: **51 passed, 0 failed, 0 skipped**.
- Current project `npm run typecheck`: **passed**, with `PI_TSC` selecting the sibling project's installed compiler.
- Sibling `npm run check`: **passed**, including typecheck and **84 tests**.
- `PI_LIVE_MODEL=gpt-6.1-sol npm run test:live`: **passed**. Inspectable real-Agent recovery: `/private/var/folders/zh/qf_nccyd0_b0fc84rk8dl4lm0000gp/T/pi-patch-live-MLmsIK/`.
- Combined real fullscreen replay: **passed** in aggregate, tidy, claude and off styles, using Ctrl+O and style commands, followed by an 80-column resize. The replay uses actual persisted results from the real helper: a partial failure and a 2000-line pure move. It asserts one visible error/recovery section and one move summary, with no unchanged moved-file content.
- Same before/after component and scrolling-layout probe: **passed** after the fix, including all original symptom assertions. It uses a 40-line ScrollView and Pi's fullscreen layout function; each sample scrolls three lines.
- Both worktrees' `git diff --check`: **passed**.

Artifacts are retained under `/tmp/pi-patch-diagnosis-kWKOtH/`: red logs, `patch-tests.log`, `patch-types.log`, `compact-check.log`, `live.log`, `before-report.json`, `report.json`, `after-run.log`, `tui-check.log`, `fullscreen.ansi.log`, reconstructed screens and the re-runnable probes.

For the same 2000-line replacement, the focused probe observed:

| Measurement | Before | After |
| --- | ---: | ---: |
| Aggregate scroll layout, 80 columns | 128.7ms | 0.053ms |
| Aggregate scroll layout, 140 columns | 220.1ms | 0.078ms |
| Standalone initial wide layout | 604.3ms | 94.0ms |
| Aggregate initial wide layout | 735.9ms | 211.6ms |

These are local CPU observations, not portable timing guarantees or physical terminal-paint measurements. The timing regressions use generous budgets rather than promising 60Hz first expansion.

Move checks cover pure moves, edited moves restored from persisted results without rereads, overwritten destinations, move chains, recreated source paths and incomplete records. Ambiguous or incomplete moves deliberately keep the existing complete per-path display. There is no file-identity tracker or new serialized DiffView schema.

The original interactive session was not reloaded. Fullscreen checks ran in a separate temporary session; no human-perceived scroll-latency or terminal screenshot claim is made.
