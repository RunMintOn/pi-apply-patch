import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { agentCore, model, modelOutput, sdk } from "./runtime.mjs";

const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-adapter-")));
function createLoader() {
  return new sdk.DefaultResourceLoader({
    cwd: workspace,
    agentDir: join(workspace, "agent"),
    settingsManager: sdk.SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [fileURLToPath(new URL("../index.ts", import.meta.url))],
  });
}
const loader = createLoader();
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
const registered = loaded.extensions.flatMap((extension) => [...extension.tools.values()]);
const tool = registered.find((entry) => (entry.definition ?? entry).name === "apply_patch");
assert.ok(tool, "Pi must load the extension and register apply_patch");
const definition = tool.definition ?? tool;
const fixtureBinary = fileURLToPath(new URL("./fixtures/helper.mjs", import.meta.url));
const context = { cwd: workspace, model };
const execute = (patch, signal = new AbortController().signal) =>
  definition.execute("test-call", { patch }, signal, undefined, context);

const originalBinary = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
const referenceBinary = process.env.PI_CODEX_APPLY_PATCH_BIN ??
  join(homedir(), "20-dev/90-third-party-repos/codex/codex-rs/target/release/apply_patch");
process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
test.after(() => {
  if (originalBinary === undefined) delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  else process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = originalBinary;
  delete process.env.PI_PATCH_TEST_MODE;
});

test("stdout and stderr reach the model without an inserted separator", async () => {
  process.env.PI_PATCH_TEST_MODE = "both";
  const result = await definition.execute(
    "test-call",
    { patch: "*** Begin Patch\n*** End Patch\n" },
    new AbortController().signal,
    undefined,
    { cwd: workspace, model },
  );
  assert.equal(modelOutput(result), "out\nerr\n\n\nNo confirmed file changes were recorded.");
  assert.equal(result.details.stdout, "out\n");
  assert.equal(result.details.stderr, "err\n");
  assert.equal(result.isError, true);
});

test("incomplete move records retain both per-path diffs and recovery uncertainty", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "inexact-move";
  const result = await execute("fixture patch");
  assert.equal(result.isError, true);
  assert.equal(result.details.diffView.exact, false);
  assert.deepEqual(result.details.diffView.files.map(({ path, kind, diff }) => ({ path, kind, diff })), [
    { path: "/source.txt", kind: "Deleted", diff: "-1 SOURCE" },
    { path: "/destination.txt", kind: "Wrote", diff: "+1 MOVED" },
  ]);
  assert.match(modelOutput(result), /The change record may be incomplete/);
});

test("an unset environment variable uses the installed local helper", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const result = await definition.execute(
    "test-call",
    { patch: "*** Begin Patch\n*** Add File: default.txt\n+ready\n*** End Patch\n" },
    new AbortController().signal,
    undefined,
    { cwd: workspace, model },
  );
  assert.equal(result.isError, false);
  assert.equal(await readFile(join(workspace, "default.txt"), "utf8"), "ready\n");
});

test("Pi reports an unavailable helper at startup and does not advertise it", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = join(workspace, "missing-helper");
  const resourceLoader = createLoader();
  await resourceLoader.reload();
  const { session } = await sdk.createAgentSession({
    cwd: workspace,
    agentDir: join(workspace, "agent"),
    model,
    resourceLoader,
    settingsManager: sdk.SettingsManager.inMemory(),
    sessionManager: sdk.SessionManager.inMemory(workspace),
  });
  const notifications = [];
  const errors = [];
  try {
    await session.bindExtensions({
      uiContext: { notify: (message, level) => notifications.push({ message, level }) },
      onError: (error) => errors.push(error),
    });
    assert.deepEqual(errors, []);
    assert.equal(session.getActiveToolNames().includes("apply_patch"), false);
    assert.ok(notifications.some(({ message, level }) =>
      level === "error" && message.includes("missing-helper")));
    assert.equal(session.getActiveToolNames().includes("read"), true);
  } finally {
    session.dispose();
  }
});

test("patch text survives stdin and the return route, including Unicode and whitespace", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "echo";
  for (const end of ["", "\n"]) {
    const patch = "*** Begin Patch\n*** Add File: 空 格.txt\n+中文🙂\t  \n+\n*** End Patch" + end;
    const result = await execute(patch);
    assert.equal(modelOutput(result), patch);
    assert.equal(result.isError, false);
  }
});

test("Pi agent core recognizes a returned non-zero exit as a failed tool call", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "both";
  const outcome = await agentCore.runToolCall(
    { type: "toolCall", id: "test-call", name: "apply_patch", arguments: { patch: "raw" } },
    {
      assistantMessage: { role: "assistant", content: [] },
      context: {
        messages: [],
        tools: [{ ...definition, execute: (_id, args, signal) => execute(args.patch, signal) }],
      },
      signal: new AbortController().signal,
    },
  );
  assert.equal(outcome.isError, true);
  assert.equal(modelOutput(outcome.result), "out\nerr\n\n\nNo confirmed file changes were recorded.");
});

test("the Agent sees ordered completed operations in English, with quoted paths and no internal flags", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "ordered-changes";
  const result = await execute("raw");
  assert.equal(modelOutput(result), "match failed\n\n\n" + String.raw`Changes already applied (in execution order):
- Wrote: "/a.txt"
- Updated: "/a.txt"
- Deleted: "/removed.txt"
- Moved: "/old.txt" -> "/new.txt"
- Wrote: "/line\n\"quoted\".txt"`);
  assert.equal(result.details.changes.exact, true);
});

test("an incomplete record is explained in English while its flag stays in details", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "inexact";
  const result = await execute("raw");
  assert.equal(result.isError, true);
  assert.deepEqual(result.details.changes, {
    exact: false,
    operations: [{ operation: "update", path: "/confirmed.txt" }],
  });
  assert.equal(modelOutput(result), 'write failed\n\n\nChanges already applied (in execution order):\n' +
    '- Updated: "/confirmed.txt"\n' +
    "The change record may be incomplete. Other changes may have occurred.\n" +
    "Inspect affected files before retrying.");
});

test("an empty incomplete record does not claim that no files changed", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const result = await execute("*** Begin Patch\n*** Delete File: missing-delete.txt\n*** End Patch\n");
  assert.deepEqual(result.details.changes, { exact: false, operations: [] });
  assert.ok(modelOutput(result).endsWith(
    "No confirmed file changes were recorded.\n" +
    "The change record may be incomplete. Other changes may have occurred.\n" +
    "Inspect affected files before retrying.",
  ));
});

test("a helper terminated after writing a file reports unknown state, not no changes", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  process.env.PI_PATCH_TEST_MODE = "terminated";
  const result = await execute("raw");
  assert.equal(result.isError, true);
  assert.equal(result.details.terminationSignal, "SIGTERM");
  assert.equal(result.details.changes, null);
  assert.match(modelOutput(result), /Could not determine which changes were applied/);
  assert.match(modelOutput(result), /Files may have changed\. Inspect affected files before retrying/);
  assert.equal(modelOutput(result).includes('"record":'), false);
  assert.equal(await readFile(join(workspace, "terminated.txt"), "utf8"), "already written\n");
});

test("malformed, invalid or inconsistent responses cannot be mistaken for a trustworthy record", async () => {
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = fixtureBinary;
  for (const mode of ["malformed", "invalid-record", "invalid-file-changes", "inconsistent"]) {
    process.env.PI_PATCH_TEST_MODE = mode;
    const result = await execute("raw");
    assert.equal(result.isError, true, mode);
    assert.equal(result.details.changes, null, mode);
    assert.ok(result.details.protocolError, mode);
    assert.match(modelOutput(result), /Could not determine which changes were applied/);
    assert.equal(modelOutput(result).includes('"version":1'), false);
    assert.ok(result.details.transportStdout);
  }
});

test("official helper errors pass through unchanged and the next valid patch succeeds", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const invalid = "*** Begin Patch\n*** Update File: absent.txt\n@@\n-old\n+new\n*** End Patch\n";
  const reference = spawnSync(referenceBinary, [], { cwd: workspace, input: invalid, encoding: "utf8" });
  assert.equal(reference.status, 1);
  const failed = await execute(invalid);
  assert.equal(failed.isError, true);
  assert.equal(failed.details.stdout, reference.stdout);
  assert.equal(failed.details.stderr, reference.stderr);
  assert.ok(modelOutput(failed).startsWith(reference.stdout + reference.stderr));
  assert.deepEqual(failed.details.changes, { exact: true, operations: [] });
  assert.ok(modelOutput(failed).endsWith("No confirmed file changes were recorded."));
  const recovered = await execute("*** Begin Patch\n*** Add File: absent.txt\n+new\n*** End Patch\n");
  assert.equal(recovered.isError, false);
  assert.equal(await readFile(join(workspace, "absent.txt"), "utf8"), "new\n");
});

test("official helper adds, updates, moves and deletes files in the Pi workspace", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const patches = [
    "*** Begin Patch\n*** Add File: nested/中文.txt\n+before\n*** End Patch\n",
    "*** Begin Patch\n*** Update File: nested/中文.txt\n@@\n-before\n+after\n*** End Patch\n",
    "*** Begin Patch\n*** Update File: nested/中文.txt\n*** Move to: moved.txt\n@@\n-after\n+moved\n*** End Patch\n",
    "*** Begin Patch\n*** Delete File: moved.txt\n*** End Patch\n",
  ];
  for (let i = 0; i < patches.length; i++) {
    const result = await execute(patches[i]);
    assert.equal(result.isError, false, result.details.stderr);
    if (i === 0) assert.equal(await readFile(join(workspace, "nested/中文.txt"), "utf8"), "before\n");
    if (i === 1) assert.equal(await readFile(join(workspace, "nested/中文.txt"), "utf8"), "after\n");
    if (i === 2) {
      assert.equal(await readFile(join(workspace, "moved.txt"), "utf8"), "moved\n");
      await assert.rejects(stat(join(workspace, "nested/中文.txt")), { code: "ENOENT" });
    }
  }
  await assert.rejects(stat(join(workspace, "moved.txt")), { code: "ENOENT" });
});

test("a later invalid update can leave an earlier write committed by the standalone helper", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  await writeFile(join(workspace, "later.txt"), "actual\n");
  const result = await execute(
    "*** Begin Patch\n*** Add File: earlier.txt\n+committed\n" +
    "*** Update File: later.txt\n@@\n-not present\n+replacement\n*** End Patch\n",
  );
  assert.equal(result.isError, true);
  assert.match(result.details.stderr, /Failed to find expected lines/);
  assert.equal(await readFile(join(workspace, "earlier.txt"), "utf8"), "committed\n");
  assert.equal(await readFile(join(workspace, "later.txt"), "utf8"), "actual\n");
  assert.deepEqual(result.details.changes, {
    exact: true,
    operations: [{ operation: "add", path: join(workspace, "earlier.txt") }],
  });
  assert.ok(modelOutput(result).startsWith(result.details.stderr));
  assert.match(modelOutput(result), /Changes already applied \(in execution order\):/);
  assert.match(modelOutput(result), /earlier\.txt/);
});

test("a cancelled call does not start the helper or change files", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  await assert.rejects(
    execute("*** Begin Patch\n*** Add File: cancelled.txt\n+no\n*** End Patch\n", AbortSignal.abort()),
    /cancelled before it started/,
  );
  await assert.rejects(stat(join(workspace, "cancelled.txt")), { code: "ENOENT" });
});

test("a Pi session exposes apply_patch and read while keeping edit and write disabled", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const resourceLoader = createLoader();
  await resourceLoader.reload();
  const { session } = await sdk.createAgentSession({
    cwd: workspace,
    agentDir: join(workspace, "agent"),
    model,
    resourceLoader,
    settingsManager: sdk.SettingsManager.inMemory(),
    sessionManager: sdk.SessionManager.inMemory(workspace),
  });
  try {
    await session.bindExtensions({});
    const tools = session.getActiveToolNames();
    assert.ok(tools.includes("apply_patch"));
    assert.ok(tools.includes("read"));
    assert.equal(tools.includes("write"), false);
    assert.equal(tools.includes("edit"), false);
    const boundTool = session.agent.state.tools.find((tool) => tool.name === "apply_patch");
    const result = await boundTool.execute(
      "session-call",
      { patch: "*** Begin Patch\n*** Add File: session.txt\n+through Pi\n*** End Patch\n" },
      new AbortController().signal,
    );
    assert.equal(result.isError, false);
    assert.equal(await readFile(join(workspace, "session.txt"), "utf8"), "through Pi\n");
  } finally {
    session.dispose();
  }
});

test("switching providers restores only the edit tools that were previously enabled", async () => {
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const resourceLoader = createLoader();
  await resourceLoader.reload();
  const modelRuntime = await sdk.ModelRuntime.create({
    authPath: join(workspace, "switch-auth.json"),
    modelsPath: join(workspace, "switch-models.json"),
  });
  await modelRuntime.setRuntimeApiKey("anthropic", "local-test-only");
  const other = modelRuntime.getModel("anthropic", "claude-sonnet-4-5");
  assert.ok(other);
  const { session } = await sdk.createAgentSession({
    cwd: workspace,
    agentDir: join(workspace, "agent"),
    model,
    modelRuntime,
    resourceLoader,
    settingsManager: sdk.SettingsManager.inMemory(),
    sessionManager: sdk.SessionManager.inMemory(workspace),
  });
  try {
    session.setActiveToolsByName(["read", "edit"]);
    await session.bindExtensions({});
    assert.equal(session.getActiveToolNames().includes("edit"), false);
    assert.equal(session.getActiveToolNames().includes("apply_patch"), true);
    await session.setModel(other);
    assert.equal(session.getActiveToolNames().includes("apply_patch"), false);
    assert.equal(session.getActiveToolNames().includes("edit"), true);
    assert.equal(session.getActiveToolNames().includes("write"), false);
  } finally {
    session.dispose();
  }
});

test.after(() => console.log(`Inspectable workspace: ${workspace}`));
