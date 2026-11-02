# Changelog

## [1.0.0] - 2026-11-02

Breaking replacement of the 0.1.0 TypeScript implementation:

- Use a pinned official Codex Rust patch engine with a modified helper entry point.
- Include a precompiled helper; support macOS arm64 only. No Codex CLI or Rust installation is required.
- Activate only for `openai-codex`, disabling both `write` and `edit` and restoring their prior state when switching away.
- Report confirmed operations after partial failures so recovery need not repeat completed edits.
- Display compact actual committed diffs, with responsive expanded layouts.
- Remove the old engine's whole-patch preflight and per-file queues; sequential operations can partially succeed before an error.

The legacy implementation is preserved on `legacy` and at `legacy-v0.1.0`, without an ongoing maintenance commitment. See README for migration and uninstall instructions.
