import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

let packageDir = process.env.PI_TEST_PACKAGE_DIR;
if (!packageDir) {
  const root = process.env.PI_MANAGED_INSTALL_ROOT ?? join(homedir(), ".pi/agent/install");
  const version = (await readFile(join(root, "current-version"), "utf8")).trim();
  packageDir = join(root, "releases", version, "node_modules/@earendil-works/pi-coding-agent");
}
export const piDir = resolve(packageDir);
export const sdk = await import(pathToFileURL(join(piDir, "dist/index.js")));
export const agentCore = await import(
  pathToFileURL(join(piDir, "../pi-agent-core/dist/index.js"))
);
// Exercise the installed provider serializer, rather than copying its behavior.
export const { convertResponsesMessages } = await import(
  pathToFileURL(join(piDir, "../pi-ai/dist/api/openai-responses-shared.js"))
);

export const model = {
  provider: "openai-codex",
  api: "openai-codex-responses",
  id: "apply-patch-test",
  input: ["text"],
};

export function modelOutput(result) {
  const messages = convertResponsesMessages(
    model,
    {
      messages: [{
        role: "toolResult",
        toolCallId: "test-call",
        toolName: "apply_patch",
        content: result.content,
        isError: result.isError,
        timestamp: 0,
      }],
    },
    new Set(["openai-codex"]),
    { grammarToolInputProperties: new Map([["apply_patch", "patch"]]) },
  );
  return messages.find((message) => message.type === "custom_tool_call_output").output;
}
