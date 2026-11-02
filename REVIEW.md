# Review

Historical reviews below were imported from the local helper prototype. Commit references describe that repository's history. The replacement-package review is recorded at the end.

Reviewed directly without sub-agents, as requested.

## Baseline and specification

At initial implementation the project was not a Git repository. The pre-implementation file snapshot is `/tmp/pi-patch-before-VHJDh4`; the reviewed existing-file diff is `/tmp/pi-patch-review.diff`. New backend, scripts and tests were inspected directly as well. The implementation was subsequently committed as `1ebb593`.

Specification: `.scratch/failure-records/issues/01-report-confirmed-changes.md`, together with the confirmed conversation decisions. Existing Pi extension contracts and the user's project instructions were the standards sources. The Fowler smell baseline was considered; the thin forwarding layer is intentional because reuse of the official engine is the requirement.

## Standards

**0 unresolved findings.**

- No second parser, file-mutation engine, background service or speculative compatibility layer.
- Pinning/build artifacts are isolated from the original checkout. License, notice and modified-source attribution are preserved.
- The public tool boundary, real helper process, installed Pi serializer and real Agent journey are tested.
- Review/validation caught the SDK's optional `AbortSignal`; the plugin now handles absent signals without a type assertion or unnecessary controller.
- Malformed protocol stdout stays in tool details rather than being presented to the Agent as trustworthy error/change text.
- No unrelated user files, installed Pi source or original Codex checkout were edited.

## Spec

**0 unresolved findings.**

- Successful library output remains unchanged. Failed output is preserved before an explicitly marked compact execution record.
- Records are mapped from `ApplyPatchFailure.delta()`, in order, with paths, operation kind, optional move destination and official exactness. No file contents or guessed per-operation status are added.
- Inexact and missing records do not imply absence of changes. Termination after a confirmed fixture write is reported as unknown.
- The difficult partial-move case reports the destination write rather than claiming the move completed.
- The plugin directly selects its project-local replacement helper. No preflight, rollback, automatic upgrade or legacy backend fallback was added.
- The pinned release build, strict TypeScript check, 21-test suite and real-model partial-failure recovery all passed.

The agreed limitation remains: this exposes execution records; it does not make patch application transactional or track all filesystem effects.

## English Agent-output follow-up

Reviewed directly against `1ebb593`, using the user's subsequent requirement to replace exposed flags with concise English descriptions.

- **Standards: 0 unresolved findings.** Only presentation, the corresponding prompt guideline, tests and documentation changed. Backend execution and the internal protocol remain unchanged.
- **Spec: 0 unresolved findings.** Success text and original errors stay unchanged. Completed operations retain execution order, including repeated paths, and use quoted paths so embedded line breaks cannot become extra list entries. `Wrote` correctly avoids claiming that every `add` created a new file.
- Precise records need no extra inspection warning. Incomplete and unavailable records explain uncertainty in English. Empty records never claim that no files changed. Internal exactness remains in details.
- The original JSON-output test failed before the rendering change. All 23 tests, the strict TypeScript check, and real-Agent recovery using the English summary passed.

## Actual diff and responsive display

Reviewed directly without sub-agents against `0acb240807a8f07c3fd9fff452ae9667c308b8f1`, including the working-tree changes and new display module/tests. Specification: both tickets in `.scratch/actual-diff/issues/` and the conversation's confirmed decisions. Standards: project AGENTS, README contracts, Pi renderer/TUI documentation and the Fowler smell baseline.

### Standards

**0 unresolved findings.**

- Parsing, mutations and committed text remain owned by the pinned official engine. TypeScript only validates/transports records, computes display diffs through Pi and renders them.
- No new dependencies, diff algorithm, file snapshot reads, background service, configuration system or broad prefactoring.
- Persistent valid results omit raw snapshots. Collapsed formatting is cheap; colored diff rows and layout are cached and rebuilt after invalidation. All terminal wrapping/composition uses Pi TUI components.
- The v1 compatibility branch is justified by the observed live-session failure, not hypothetical future compatibility. A strict-envelope regression and the repaired original session validate it.
- The new public-boundary tests protect actual file changes, recovery, expansion, layout, result restore and compact persistence. Existing unrelated untracked AGENTS.md/HANDOFF.md were left untouched.

### Spec

**0 unresolved findings.**

- One net result per path per tool call, using the first recorded before-state and last recorded after-state. Moves show source deletion and target addition/overwrite; failed moves do not claim source deletion.
- Starts collapsed with paths/counts; expansion uses Pi's existing mechanism. Available width selects equal-width before/after columns or the existing unified renderer. Ordered row pairing, blank cells and per-pair wrapping preserve context alignment and complete content.
- Errors and incomplete records remain visible. Model-facing success/failure output and execution status are preserved, including a separate fallback for display-data computation failure.
- Review caught a CRLF presentation issue: raw carriage returns produced blank rows and failed line parsing. The public renderer regression first failed, then passed with visible carriage-return markers; final-newline notes also keep otherwise-identical lines distinguishable.
- No whole-session aggregation, file-identity tracker, similar-line matching or custom interaction system was introduced.

Validation: 38 tests, strict typecheck, Rust formatting/snapshot comparison and real-Agent recovery passed. Inspectable rendering outputs, performance observations and the untested full-terminal interaction boundary are recorded in VERIFICATION.md.

## Screenshot-driven correction

Reviewed directly against `4955996`, without sub-agents. Specification: the user's isolated-plugin screenshots and request to inspect the practical layout rather than ask them to choose layout terminology.

### Standards

**0 unresolved findings.** The correction is confined to presentation, its public renderer/tool-shell checks and documentation. Existing Pi diff calculation, coloring, wrapping, composition and theme APIs remain reused; no backend, protocol, data schema, dependency or global Pi code changed. The small ANSI adaptations address the specific segment resets and inverse attributes emitted by the installed components.

The earlier review missed inherited-background loss because its assertions examined stripped text, widths and content rather than terminal color state. The new regression uses the actual enclosing tool shell and Pi's converter to verify background styling. Tests enable real terminal text attributes instead of silently relying on a non-color test process.

### Spec

**0 unresolved findings.** Columns already divided the actual padded content area evenly; measurements now protect their stable midpoint. Backgrounds are continuous across cells and wraps for all tool statuses. Added/deleted files no longer leave a blank comparison column; captions are compact, and modified text keeps red/green foreground without inverse word blocks. Existing net-diff, restore, failure and recovery tests still pass.

Visual inspection covered wide and narrow previews generated from actual tool-component ANSI output. Full suite: 44 passed; strict typecheck and real-Agent recovery passed. Native terminal GUI/mouse interaction remains outside this check.

## Self-modification continuity retrospective

Reviewed directly against `8d93c4a`, without sub-agents. The user clarified that this plugin is used to edit and upgrade itself: the loaded tool must remain usable after helper replacement and before reload.

### Standards

**0 unresolved findings in this change.** Runtime code and protocol behavior remain unchanged. The requirement lives in README, with one task-triggered pointer in AGENTS.md. The new regression crosses the registered-tool and real-session interfaces and uses the official engine for all writes. The historical extension fixture is frozen from `0acb240`, preventing a current decoder change from silently weakening the old-caller check.

Tests replace only a helper in a temporary directory, restore environment overrides and dispose the session even on failure. The frozen-fixture comparison, 45-test suite, strict typecheck and whitespace check passed. An isolated v2-only replacement is rejected by the upgrade regression.

### Spec

**0 unresolved findings in this change.** The test covers self-editing through the old tool, same-path helper replacement, continued success and record-informed recovery, then actual SDK session reload into v2 diff output. It simulates the pre-upgrade helper transport and uses the built current executable as the replacement; it does not claim to run Cargo or test concurrent replacement.

The architecture review's recommendation to delete v1 compatibility is withdrawn. Its rationale overlooked an active mixed-version usage requirement despite reading the historical failure evidence. README now makes that requirement explicit; adding a generic “be careful” instruction would not address the missed judgment.

The project currently has check scripts but no active pre-commit hook or checked-in CI workflow. This change wires the regression into the existing test command; it does not install hooks or introduce CI requiring this machine's local Codex source, Cargo cache and Pi installation. Automatic check wiring remains a separate environment improvement.

## Codemode argument-form correction

Reviewed directly, without sub-agents. The earlier completion summary omitted a failed codemode call. The failure is now reproduced and recorded rather than treated as incidental.

### Standards

**0 unresolved findings in this change.** The adjustment is confined to the tool description, README and a regression through the real installed codemode extension. Direct FREEFORM grammar, TypeBox parameters, helper invocation and recovery behavior are unchanged. The test seeds its parent assistant call through SessionManager, restores its helper override and disposes the session.

### Spec

**0 unresolved findings in this change.** The generated guidance distinguishes direct raw-patch input from codemode's object arguments. The regression exercises both argument forms with a real nested tool call and verifies the resulting file. The strict object requirement remains intact; no string-to-object coercion or generic codemode change was introduced.

All 46 tests, typecheck and the existing real-Agent direct-call recovery flow passed. The same-patch probe confirms that the original string form was rejected before execution, while the object form executed successfully. These results do not demonstrate that the wording change alone will prevent future model mistakes; that requires further observed use.

## Compact-tool integration, large diffs and simple moves

Reviewed the changes in both worktrees directly, without sub-agents, against the user's confirmed scope: fix duplicate native bodies and sustained scrolling, preserve complete diff/wrapping, improve initial side-by-side layout, and compact only unambiguous moves.

### Standards

**0 unresolved findings in the scoped changes.** Compact-tool delegates native expanded content into its existing shell/cache instead of layering a second body or introducing another cache system. The small `renderExpanded` adapter hook serves this concrete integration. Fixed columns retain Pi Text's wrapping, padding and ANSI handling, with explicit style boundaries and restored tool backgrounds. No new dependencies, filesystem reads in renderers, backend/protocol changes, or edits to the user's existing untracked HANDOFF.md.

### Spec

**0 unresolved findings in the scoped changes.** Simple moves pair only complete records with one operation per endpoint, an absent destination and disjoint move endpoints. Overwrites, repeated paths, chains and incomplete records retain per-path diffs. The input record is not mutated, and persisted results still contain only the existing diff/count/path fields rather than snapshots. Model-visible errors and completed-operation summaries are unchanged.

Public-boundary regressions cover one error/recovery body across styles and expansion cycles, complete 4000-row native details with warm-layout reuse and invalidation, 2000-line initial layout, pure/edited moves, persistence and conservative fallback. Existing wrapping, Chinese/emoji/tabs, alignment, theme/background and self-modification checks remain passing. The two full suites, strict typechecks, real-Agent recovery and combined fullscreen replay passed; measurements and limits are recorded in VERIFICATION.md.
## Rust replacement and npm package preparation

Reviewed directly without sub-agents against the confirmed replacement scope and AGENTS.md.

**No unresolved findings in the scoped changes.**

- The old repository history remains intact; local `legacy` and annotated `legacy-v0.1.0` preserve `9d96408b65c11f697cf2679f93fe5cdc48396362`. No force push or remote mutation was performed.
- The replacement reuses the prototype engine, renderer and recovery protocol without semantic changes. Adapter changes are limited to bundled/development/override path selection, the macOS arm64 gate, and actionable startup diagnostics.
- The tarball contains an executable arm64 helper and the required modules/licenses/notices, without build snapshots, tests, or host-runtime dependencies. No install lifecycle scripts were introduced.
- README distinguishes upstream sequential partial application from the plugin's recovery reporting. It documents activation, prompt contributions, inherited permissions/environment, data retention, missing-helper behavior, migration and removal.
- Distribution tests first reproduced missing bundled-path precedence and missing platform gating. Pi's extension loader snapshots process properties at load time, so the platform fixture now sets them before loading. This tests the gate, not actual execution on other platforms.
- Pi 1.5.0 changed an argument-validation error message. Only the existing codemode test's accepted diagnostic wording was updated; runtime compatibility code was not added.
- Full tests, strict typecheck, pinned build, installed-tarball real-Agent recovery, and package registration/removal checks are recorded in VERIFICATION.md. Existing protocol/self-modification coverage remains passing.

At the time of this review, no npm publication, remote branch/tag push, or modification of the original prototype had been performed. Version 1.0.0 was an unreleased candidate.
