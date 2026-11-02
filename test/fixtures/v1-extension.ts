// Frozen adapter from 0acb240:index.ts; keep its strict v1 decoder unchanged.
import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const APPLY_PATCH_BINARY_ENV = "PI_CODEX_APPLY_PATCH_HELPER_BIN";
const DEFAULT_APPLY_PATCH_BINARY = fileURLToPath(new URL("./.build/bin/pi-apply-patch", import.meta.url));
const APPLY_PATCH_TOOL_NAME = "apply_patch";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const TOOLS_DISABLED_FOR_CODEX = ["write", "edit"] as const;

// Copied unchanged from OpenAI Codex at c22a06c18070c3e33bd2648c7210a00a2a9f6f80:
// codex-rs/core/assets/tools/apply_patch.lark (Apache-2.0).
const APPLY_PATCH_LARK_GRAMMAR = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF`;

const APPLY_PATCH_PARAMETERS = Type.Object(
  {
    patch: Type.String({ description: "Complete Codex-format patch text." }),
  },
  { additionalProperties: false },
);

type ApplyPatchProcessOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  terminationSignal: NodeJS.Signals | null;
};

const CHANGE_RECORD = Type.Object({
  exact: Type.Boolean(),
  operations: Type.Array(Type.Union([
    Type.Object({
      operation: Type.Union([Type.Literal("add"), Type.Literal("update"), Type.Literal("delete")]),
      path: Type.String(),
    }, { additionalProperties: false }),
    Type.Object({
      operation: Type.Literal("move"),
      path: Type.String(),
      moveTo: Type.String(),
    }, { additionalProperties: false }),
  ])),
}, { additionalProperties: false });

const HELPER_RESPONSE = Type.Object({
  version: Type.Literal(1),
  stdout: Type.String(),
  stderr: Type.String(),
  exitCode: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
  changes: Type.Union([Type.Null(), CHANGE_RECORD]),
}, { additionalProperties: false });

type ChangeRecord = Static<typeof CHANGE_RECORD>;
type ApplyPatchOutput = ApplyPatchProcessOutput & {
  changes: ChangeRecord | null;
  protocolError?: string;
  transportStdout?: string;
};

function decodeOutput(output: ApplyPatchProcessOutput): ApplyPatchOutput {
  try {
    const response: unknown = JSON.parse(output.stdout);
    if (!Check(HELPER_RESPONSE, response) ||
      output.terminationSignal !== null || response.exitCode !== output.exitCode || output.stderr !== "") {
      throw new Error("Missing or inconsistent helper response.");
    }
    return { ...output, stdout: response.stdout, stderr: response.stderr, changes: response.changes };
  } catch (error) {
    return {
      ...output,
      stdout: "",
      changes: null,
      protocolError: String(error),
      transportStdout: output.stdout,
    };
  }
}

function failureState(changes: ChangeRecord | null): string {
  if (changes === null) {
    return "\n\nCould not determine which changes were applied.\n" +
      "Files may have changed. Inspect affected files before retrying.";
  }
  const labels = { add: "Wrote", update: "Updated", delete: "Deleted", move: "Moved" };
  const operations = changes.operations.map((change) => {
    const source = JSON.stringify(change.path);
    return `- ${labels[change.operation]}: ${source}` +
      (change.operation === "move" ? ` -> ${JSON.stringify(change.moveTo)}` : "");
  });
  const summary = operations.length > 0
    ? "Changes already applied (in execution order):\n" + operations.join("\n")
    : "No confirmed file changes were recorded.";
  return "\n\n" + summary + (changes.exact ? "" :
    "\nThe change record may be incomplete. Other changes may have occurred.\n" +
    "Inspect affected files before retrying.");
}

function resolveApplyPatchBinary(): string {
  return process.env[APPLY_PATCH_BINARY_ENV] || DEFAULT_APPLY_PATCH_BINARY;
}

function syncToolsForProvider(
  pi: ExtensionAPI,
  model: { provider: string } | undefined,
  restoreTools: Set<string> | undefined,
  helperAvailable = true,
): Set<string> | undefined {
  const activeTools = new Set(pi.getActiveTools());
  if (model?.provider === OPENAI_CODEX_PROVIDER) {
    const previousActive = restoreTools ?? new Set(
      TOOLS_DISABLED_FOR_CODEX.filter((tool) => activeTools.has(tool)),
    );
    for (const tool of TOOLS_DISABLED_FOR_CODEX) activeTools.delete(tool);
    if (helperAvailable) activeTools.add(APPLY_PATCH_TOOL_NAME);
    else activeTools.delete(APPLY_PATCH_TOOL_NAME);
    pi.setActiveTools([...activeTools]);
    return previousActive;
  }

  activeTools.delete(APPLY_PATCH_TOOL_NAME);
  if (restoreTools) {
    for (const tool of restoreTools) activeTools.add(tool);
    pi.setActiveTools([...activeTools]);
    return undefined;
  }
  pi.setActiveTools([...activeTools]);
  return undefined;
}

function runCodexApplyPatch(
  patch: string,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<ApplyPatchProcessOutput> {
  const executable = resolveApplyPatchBinary();

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill("SIGTERM");
    };

    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    // A child that exits early can close stdin before the patch has been fully written.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (exitCode, terminationSignal) =>
      finish(() =>
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          exitCode,
          terminationSignal,
        }),
      ),
    );

    child.stdin.end(patch, "utf8");
  });
}

export default function registerCodexApplyPatchHelper(pi: ExtensionAPI): void {
  let toolsToRestore: Set<string> | undefined;
  const syncForModel = (model: { provider: string } | undefined, ctx: ExtensionContext) => {
    let helperAvailable = true;
    if (model?.provider === OPENAI_CODEX_PROVIDER) {
      const executable = resolveApplyPatchBinary();
      try {
        accessSync(executable, constants.X_OK);
        if (!statSync(executable).isFile()) throw new Error("Not a regular file.");
      } catch (error) {
        helperAvailable = false;
        ctx.ui.notify(
          `apply_patch is unavailable: ${executable}\n${String(error)}\n` +
            `Run npm run build in the extension directory, then reload the extension.`,
          "error",
        );
      }
    }
    toolsToRestore = syncToolsForProvider(pi, model, toolsToRestore, helperAvailable);
  };

  pi.on("session_start", (_event, ctx) => syncForModel(ctx.model, ctx));
  pi.on("model_select", (event, ctx) => syncForModel(event.model, ctx));

  pi.registerTool({
    name: APPLY_PATCH_TOOL_NAME,
    label: APPLY_PATCH_TOOL_NAME,
    description:
      "The `apply_patch` tool can be used to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.",
    promptSnippet: "Apply freeform patches to add, update, move, or delete files",
    promptGuidelines: [
      "Use `apply_patch` for local file edits.",
      "Do not create or edit files with `cat` or other shell write tricks.",
      "Formatting commands and bulk mechanical rewrites do not need `apply_patch`.",
      "A failed `apply_patch` may have applied some operations. Use its completed-operations summary when recovering; do not blindly replay completed operations. If the change record is incomplete or unavailable, inspect affected files before retrying.",
    ],
    parameters: APPLY_PATCH_PARAMETERS,
    constrainedSampling: {
      type: "grammar",
      variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR },
    },
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.model?.provider !== OPENAI_CODEX_PROVIDER) {
        throw new Error(`apply_patch is only available for the ${OPENAI_CODEX_PROVIDER} provider.`);
      }
      if (signal?.aborted) throw new Error("apply_patch was cancelled before it started.");
      let output: ApplyPatchOutput;
      try {
        output = decodeOutput(await runCodexApplyPatch(params.patch, ctx.cwd, signal));
      } catch (error) {
        output = {
          stdout: "",
          stderr: String(error),
          exitCode: null,
          terminationSignal: null,
          changes: null,
          protocolError: "The helper did not return an execution record.",
        };
      }
      const isError = output.exitCode !== 0 || output.terminationSignal !== null || !!output.protocolError;
      // Pi inserts a newline between text blocks; keep the streams separate in details.
      const content = [{
        type: "text" as const,
        text: output.stdout + output.stderr +
          (output.protocolError ? "\nThe helper did not return a valid execution report.\n" : "") +
          (isError ? failureState(output.changes) : ""),
      }];
      return {
        content,
        details: output,
        isError,
      };
    },
  });
}
