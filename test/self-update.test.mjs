import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { model, modelOutput, sdk } from "./runtime.mjs";

test("a loaded plugin edits itself, survives helper replacement, and reloads into v2", async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-self-update-")));
  console.log(`Inspectable self-update workspace: ${workspace}`);
  const plugin = join(workspace, "plugin");
  await mkdir(plugin);
  const entry = join(plugin, "index.ts");
  const helper = join(workspace, "helper");
  const binary = fileURLToPath(new URL("../.build/bin/pi-apply-patch", import.meta.url));
  const legacy = await readFile(new URL("./fixtures/v1-extension.ts", import.meta.url), "utf8");
  const current = await readFile(new URL("../index.ts", import.meta.url), "utf8");
  await writeFile(entry, legacy);
  await copyFile(new URL("../diff-view.ts", import.meta.url), join(plugin, "diff-view.ts"));
  // Simulate the old v1-only helper, while keeping all writes in the real Rust engine.
  await writeFile(helper, `#!${process.execPath}
const { readFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const result = spawnSync(${JSON.stringify(binary)}, [], {
  cwd: process.cwd(), input: readFileSync(0), encoding: "utf8",
  env: { ...process.env, PI_CODEX_APPLY_PATCH_PROTOCOL: "2" },
});
if (result.error) throw result.error;
const response = JSON.parse(result.stdout);
process.stdout.write(JSON.stringify({
  version: 1, stdout: response.stdout, stderr: response.stderr,
  exitCode: response.exitCode, changes: response.changes,
}) + "\\n");
process.exitCode = result.status;
`);
  await chmod(helper, 0o755);
  const previousBinary = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const previousProtocol = process.env.PI_CODEX_APPLY_PATCH_PROTOCOL;
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = helper;
  delete process.env.PI_CODEX_APPLY_PATCH_PROTOCOL;
  let session;
  const results = [];
  try {
    const loader = new sdk.DefaultResourceLoader({
      cwd: workspace,
      agentDir: join(workspace, "agent"),
      settingsManager: sdk.SettingsManager.inMemory(),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [entry],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({
      cwd: workspace,
      agentDir: join(workspace, "agent"),
      model,
      resourceLoader: loader,
      settingsManager: sdk.SettingsManager.inMemory(),
      sessionManager: sdk.SessionManager.inMemory(workspace),
    }));
    await session.bindExtensions({});
    const oldTool = session.agent.state.tools.find((tool) => tool.name === "apply_patch");
    assert.ok(oldTool);
    const execute = async (tool, patch) => {
      const result = await tool.execute("self-update", { patch }, new AbortController().signal);
      results.push(result);
      assert.equal(result.details.protocolError, undefined);
      return result;
    };

    const replacement = "*** Begin Patch\n*** Update File: plugin/index.ts\n@@\n" +
      legacy.trimEnd().split("\n").map((line) => "-" + line + "\n").join("") +
      current.trimEnd().split("\n").map((line) => "+" + line + "\n").join("") +
      "*** End Patch\n";
    const edited = await execute(oldTool, replacement);
    assert.equal(edited.isError, false);
    assert.equal(await readFile(entry, "utf8"), current);

    await copyFile(binary, helper);
    await chmod(helper, 0o755);
    assert.equal(session.agent.state.tools.find((tool) => tool.name === "apply_patch"), oldTool);
    const success = await execute(oldTool,
      "*** Begin Patch\n*** Add File: after-rebuild.txt\n+ready\n*** End Patch\n");
    assert.equal(success.isError, false);
    assert.equal(await readFile(join(workspace, "after-rebuild.txt"), "utf8"), "ready\n");
    const failed = await execute(oldTool,
      "*** Begin Patch\n*** Add File: committed.txt\n+keep\n" +
      "*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch\n");
    assert.equal(failed.isError, true);
    assert.deepEqual(failed.details.changes, {
      exact: true,
      operations: [{ operation: "add", path: join(workspace, "committed.txt") }],
    });
    assert.match(modelOutput(failed), /Changes already applied \(in execution order\):/);
    assert.equal(await readFile(join(workspace, "committed.txt"), "utf8"), "keep\n");
    const recovered = await execute(oldTool,
      "*** Begin Patch\n*** Add File: missing.txt\n+new\n*** End Patch\n");
    assert.equal(recovered.isError, false);
    assert.equal(await readFile(join(workspace, "missing.txt"), "utf8"), "new\n");

    await session.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const newTool = session.agent.state.tools.find((tool) => tool.name === "apply_patch");
    assert.ok(newTool);
    assert.notEqual(newTool, oldTool);
    const reloaded = await execute(newTool,
      "*** Begin Patch\n*** Update File: after-rebuild.txt\n@@\n-ready\n+v2\n*** End Patch\n");
    assert.equal(reloaded.isError, false);
    assert.equal(await readFile(join(workspace, "after-rebuild.txt"), "utf8"), "v2\n");
    assert.equal(reloaded.details.diffView.files[0].diff, "-1 ready\n+1 v2");
    assert.equal(reloaded.details.fileChanges, undefined);
  } finally {
    session?.dispose();
    if (previousBinary === undefined) delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
    else process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = previousBinary;
    if (previousProtocol === undefined) delete process.env.PI_CODEX_APPLY_PATCH_PROTOCOL;
    else process.env.PI_CODEX_APPLY_PATCH_PROTOCOL = previousProtocol;
    await writeFile(join(workspace, "results.json"), JSON.stringify(results, null, 2) + "\n");
  }
});
