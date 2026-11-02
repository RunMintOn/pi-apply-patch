import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { piDir } from "./runtime.mjs";

const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-live-")));
await writeFile(join(workspace, "journey.txt"), "before\n");
const invalid = "*** Begin Patch\n*** Add File: first.txt\n+committed 中文\n" +
  "*** Update File: journey.txt\n@@\n-does not exist\n+after 中文\n*** End Patch\n";
const prompt = `This is an integration test in a disposable directory.
Use apply_patch directly, not another editing method.
1. First call apply_patch with this exact deliberately invalid patch. Its failure is expected:
${invalid}
2. After receiving the failure, use the execution record to recover and complete the task:
first.txt must contain "committed 中文\\n" and journey.txt must contain "after 中文\\n".
Do not undo or reapply operations already confirmed as committed.
3. Read both files to confirm their contents, then stop.
Do not skip the failing call.`;
const env = { ...process.env };
delete env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
const extension = process.env.PI_LIVE_EXTENSION ??
  fileURLToPath(new URL("../index.ts", import.meta.url));
const args = [
  join(piDir, "dist/bundle/cli.js"),
  "--offline", "--no-extensions", "--extension", extension,
  "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
  "--no-session", "--mode", "json",
  "--provider", process.env.PI_LIVE_PROVIDER ?? process.env.PI_PROVIDER ?? "openai-codex",
  "--model", process.env.PI_LIVE_MODEL ?? process.env.PI_MODEL ?? "gpt-5.4",
  "--thinking", "low", "--tools", "apply_patch,read",
  prompt,
];
console.log(`Live test workspace and logs: ${workspace}`);
const child = spawn(process.execPath, args, {
  cwd: workspace,
  env,
  stdio: ["ignore", "pipe", "pipe"],
  timeout: 180_000,
});
const stdout = [];
const stderr = [];
child.stdout.on("data", (chunk) => stdout.push(chunk));
child.stderr.on("data", (chunk) => stderr.push(chunk));
let spawnError;
child.on("error", (error) => { spawnError = error; });
const status = await new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
const output = Buffer.concat(stdout).toString("utf8");
await writeFile(join(workspace, "events.jsonl"), output);
await writeFile(join(workspace, "stderr.log"), Buffer.concat(stderr));
assert.ifError(spawnError);
assert.equal(status.code, 0, `Pi exited with ${JSON.stringify(status)}; inspect ${workspace}`);
const events = output.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const calls = events.filter((event) => event.type === "tool_execution_start" && event.toolName === "apply_patch");
const results = events.filter((event) => event.type === "tool_execution_end" && event.toolName === "apply_patch");
assert.equal(calls.length, 2, "The model must issue exactly the two requested patches");
assert.equal(calls[0].args.patch, invalid);
assert.equal(calls[1].args.patch.includes("first.txt"), false, "Recovery must not repeat the committed operation");
assert.equal(results.length, 2);
assert.equal(results[0].isError, true);
assert.equal(results[1].isError, false);
assert.match(results[0].result.details.stderr, /Failed to find expected lines/);
assert.deepEqual(results[0].result.details.changes, {
  exact: true,
  operations: [{ operation: "add", path: join(workspace, "first.txt") }],
});
assert.equal(results[0].result.details.fileChanges, undefined);
assert.deepEqual(results[0].result.details.diffView.files.map(({ path, diff, added, removed }) => ({
  path, diff, added, removed,
})), [{
  path: join(workspace, "first.txt"),
  diff: "+1 committed 中文",
  added: 1,
  removed: 0,
}]);
assert.equal(results[1].result.details.diffView.files.length, 1);
assert.equal(results[1].result.details.diffView.files[0].path, join(workspace, "journey.txt"));
assert.equal(results[1].result.details.diffView.files[0].diff, "-1 before\n+1 after 中文");
assert.equal(results[1].result.details.fileChanges, undefined);
assert.ok(results[0].result.content[0].text.startsWith(results[0].result.details.stderr));
assert.match(results[0].result.content[0].text, /Changes already applied \(in execution order\):/);
assert.ok(results[0].result.content[0].text.includes(`- Wrote: ${JSON.stringify(join(workspace, "first.txt"))}`));
assert.equal(results[0].result.content[0].text.includes('"record":'), false);
assert.equal(await readFile(join(workspace, "journey.txt"), "utf8"), "after 中文\n");
assert.equal(await readFile(join(workspace, "first.txt"), "utf8"), "committed 中文\n");
for (const filename of ["first.txt", "journey.txt"]) {
  const read = events.find((event) => event.type === "tool_execution_start" &&
    event.toolName === "read" && resolve(workspace, event.args.path) === join(workspace, filename));
  assert.ok(read, `The Agent must read ${filename}`);
  assert.ok(events.some((event) => event.type === "tool_execution_end" &&
    event.toolCallId === read.toolCallId && !event.isError));
}
await writeFile(join(workspace, "summary.json"), JSON.stringify({
  passed: true,
  extension,
  provider: process.env.PI_LIVE_PROVIDER ?? process.env.PI_PROVIDER ?? "openai-codex",
  model: process.env.PI_LIVE_MODEL ?? process.env.PI_MODEL ?? "gpt-5.4",
  environmentOverrideRemoved: true,
  patchCalls: calls.length,
  firstCallFailed: results[0].isError,
  secondCallFailed: results[1].isError,
  confirmedChanges: results[0].result.details.changes,
  confirmedDiffs: results.map((result) => result.result.details.diffView),
  recoveryDidNotRepeatCommittedOperation: true,
  finalContent: "after 中文\n",
}, null, 2) + "\n");
console.log("PASS: partial failure → confirmed changes → agent recovery without repeated writes → verified files");
