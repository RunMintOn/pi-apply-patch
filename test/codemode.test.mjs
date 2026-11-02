import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { model, sdk } from "./runtime.mjs";

test("codemode declares the object call form and executes apply_patch through it", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-codemode-")));
  console.log(`Inspectable codemode workspace: ${workspace}`);
  const previousBinary = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  let session;
  try {
    const settingsManager = sdk.SettingsManager.inMemory();
    const loader = new sdk.DefaultResourceLoader({
      cwd: workspace,
      agentDir: join(workspace, "agent"),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [fileURLToPath(new URL("../index.ts", import.meta.url))],
      extensionFactories: [sdk.createCodemodeExtension({ mode: "on" })],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const patch = "*** Begin Patch\n*** Add File: probe.txt\n+codemode works\n*** End Patch\n";
    const script = `
const declaration = await describeTool("apply_patch");
text(declaration);
if (!declaration.includes("tools.apply_patch({ patch })")) {
  throw new Error("Missing codemode object-call guidance");
}
const patch = ${JSON.stringify(patch)};
let rejected = false;
try {
  await tools.apply_patch(patch);
} catch (error) {
  if (!/root: (?:must be object|expected object, got string)/.test(String(error))) throw error;
  rejected = true;
}
if (!rejected) throw new Error("Raw-string call unexpectedly accepted");
const result = await tools.apply_patch({ patch });
text(result);
text(await tools.read({ path: "probe.txt" }));
`;
    // Nested tool calls require the assistant message that issued the parent call.
    const sessionManager = sdk.SessionManager.inMemory(workspace);
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "toolCall", id: "codemode-test", name: "codemode", arguments: { code: script } }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 0,
    });
    ({ session } = await sdk.createAgentSession({
      cwd: workspace,
      agentDir: join(workspace, "agent"),
      model,
      resourceLoader: loader,
      settingsManager,
      sessionManager,
    }));
    await session.bindExtensions({});
    session.setActiveToolsByName(["apply_patch", "read", "codemode"]);
    const codemode = session.agent.state.tools.find((tool) => tool.name === "codemode");
    assert.ok(codemode);
    const result = await codemode.execute("codemode-test", { code: script }, new AbortController().signal);
    await writeFile(join(workspace, "result.json"), JSON.stringify(result, null, 2) + "\n");
    const output = result.content.filter((item) => item.type === "text").map((item) => item.text).join("\n");
    assert.match(output, /Script completed/);
    assert.doesNotMatch(output, /Script failed/);
    assert.match(output, /Success\. Updated the following files:/);
    assert.equal(await readFile(join(workspace, "probe.txt"), "utf8"), "codemode works\n");
  } finally {
    session?.dispose();
    if (previousBinary === undefined) delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
    else process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = previousBinary;
  }
});
