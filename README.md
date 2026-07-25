# @runminton/pi-apply-patch

<a href="https://www.npmjs.com/package/@runminton/pi-apply-patch">
  <img src="https://img.shields.io/npm/dm/@runminton/pi-apply-patch" alt="npm monthly downloads" />
</a>
<a href="https://www.npmjs.com/package/@runminton/pi-apply-patch">
  <img src="https://img.shields.io/npm/dt/@runminton/pi-apply-patch" alt="npm total downloads" />
</a>

A Pi extension that provides Codex-compatible `apply_patch` file editing.

On Pi 0.82.0+ grammar-capable OpenAI GPT-5 models, it uses OpenAI native custom/freeform Lark grammar tools. Models without that capability automatically receive a normal `apply_patch({ patch })` function tool instead. The extension retains local Patch parsing, preflight validation, per-file mutation queues, preview rendering, path safety, sequential execution, cancellation boundaries, and partial-commit reporting.

## Install

```bash
pi install npm:@runminton/pi-apply-patch
```

Restart Pi or start a new session after installation. The extension activates `apply_patch` for `openai-responses` and `openai-codex-responses`, replacing Pi's built-in `edit` in those sessions. Other APIs continue to use the built-in `edit` tool.

## Requirements

- Pi `0.82.0` or newer.
- Node.js and Pi's supported extension runtime.

Pi supplies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` as peer dependencies; do not bundle another Pi runtime with this package.

## Model interface

For a model whose Pi catalog metadata enables `compat.supportsOpenAIGrammarTools`, the provider receives:

```json
{
  "type": "custom",
  "name": "apply_patch",
  "format": {
    "type": "grammar",
    "syntax": "lark",
    "definition": "..."
  }
}
```

The Patch grammar matches Codex's current `apply_patch.lark`. It is freeform input: capable models should not wrap the patch in JSON. Pi internally maps that input to `{ "patch": "..." }` for the extension executor. For a model without grammar support, Pi falls back to a normal function tool with the same internal `{ patch: string }` schema and no Patch regex or strict-schema injection.

## Verify a release tarball

From this directory:

```bash
npm pack --dry-run
```

The published tarball intentionally contains only `unified-edit.ts`, this README, and `LICENSE`.

## License

[MIT](LICENSE)
