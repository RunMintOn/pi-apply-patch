import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const binary = fileURLToPath(new URL("../.build/bin/pi-apply-patch", import.meta.url));
const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-backend-")));

function apply(patch) {
  const result = spawnSync(binary, [], {
    cwd: workspace, input: patch, encoding: "utf8",
    env: { ...process.env, PI_CODEX_APPLY_PATCH_PROTOCOL: "2" },
  });
  assert.ifError(result.error);
  const response = JSON.parse(result.stdout);
  assert.equal(response.version, 2);
  assert.equal(response.exitCode, result.status);
  assert.equal(result.stderr, "");
  return response;
}

test("a later failed update returns the original error and the committed prefix", async () => {
  await writeFile(join(workspace, "b.txt"), "actual\n");
  const response = apply(
    "*** Begin Patch\n*** Add File: a.txt\n+committed\n" +
    "*** Update File: b.txt\n@@\n-missing\n+new\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 1);
  assert.match(response.stderr, /Failed to find expected lines/);
  assert.deepEqual(response.changes, {
    exact: true,
    operations: [{ operation: "add", path: join(workspace, "a.txt") }],
  });
  assert.equal(await readFile(join(workspace, "a.txt"), "utf8"), "committed\n");
  assert.equal(await readFile(join(workspace, "b.txt"), "utf8"), "actual\n");
  assert.deepEqual(response.fileChanges, {
    exact: true,
    operations: [{ path: join(workspace, "a.txt"), before: null, after: "committed\n" }],
    moves: [],
  });
});

test("success exposes committed before/after text without changing the original output", async () => {
  await writeFile(join(workspace, "diff.txt"), "before\n");
  const response = apply(
    "*** Begin Patch\n*** Update File: diff.txt\n@@\n-before\n+after\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 0);
  assert.deepEqual(response.fileChanges, {
    exact: true,
    operations: [{ path: join(workspace, "diff.txt"), before: "before\n", after: "after\n" }],
    moves: [],
  });
  assert.equal(response.changes, null);
  assert.equal(await readFile(join(workspace, "diff.txt"), "utf8"), "after\n");
});

test("an initial failure reports no committed changes and does not execute later operations", async () => {
  const response = apply(
    "*** Begin Patch\n*** Delete File: missing.txt\n" +
    "*** Add File: never.txt\n+no\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 1);
  assert.deepEqual(response.changes, { exact: false, operations: [] });
  await assert.rejects(stat(join(workspace, "never.txt")), { code: "ENOENT" });
});

test("a later failure preserves ordered add, update, delete and move records without file contents", async () => {
  await writeFile(join(workspace, "update.txt"), "old\n");
  await writeFile(join(workspace, "remove.txt"), "delete me\n");
  await writeFile(join(workspace, "move.txt"), "old\n");
  const response = apply(
    "*** Begin Patch\n*** Add File: added.txt\n+added\n" +
    "*** Update File: update.txt\n@@\n-old\n+updated\n" +
    "*** Delete File: remove.txt\n" +
    "*** Update File: move.txt\n*** Move to: destination.txt\n@@\n-old\n+moved\n" +
    "*** Update File: missing.txt\n@@\n-no\n+yes\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 1);
  assert.deepEqual(response.changes, {
    exact: true,
    operations: [
      { operation: "add", path: join(workspace, "added.txt") },
      { operation: "update", path: join(workspace, "update.txt") },
      { operation: "delete", path: join(workspace, "remove.txt") },
      { operation: "move", path: join(workspace, "move.txt"), moveTo: join(workspace, "destination.txt") },
    ],
  });
  assert.equal(await readFile(join(workspace, "update.txt"), "utf8"), "updated\n");
  assert.equal(await readFile(join(workspace, "destination.txt"), "utf8"), "moved\n");
  await assert.rejects(stat(join(workspace, "remove.txt")), { code: "ENOENT" });
  await assert.rejects(stat(join(workspace, "move.txt")), { code: "ENOENT" });
});

test("a failed later chunk in one update does not claim its earlier chunk was written", async () => {
  await writeFile(join(workspace, "chunks.txt"), "first\nmiddle\nlast\n");
  const response = apply(
    "*** Begin Patch\n*** Update File: chunks.txt\n@@\n-first\n+FIRST\n" +
    "@@\n-not present\n+LAST\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 1);
  assert.deepEqual(response.changes, { exact: true, operations: [] });
  assert.equal(await readFile(join(workspace, "chunks.txt"), "utf8"), "first\nmiddle\nlast\n");
});

test("a write failure carries the library's inexact flag without losing confirmed earlier writes", async () => {
  await mkdir(join(workspace, "blocked"));
  const response = apply(
    "*** Begin Patch\n*** Add File: before-write-error.txt\n+confirmed\n" +
    "*** Add File: blocked\n+cannot overwrite a directory\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 1);
  assert.deepEqual(response.changes, {
    exact: false,
    operations: [{ operation: "add", path: join(workspace, "before-write-error.txt") }],
  });
  assert.equal(await readFile(join(workspace, "before-write-error.txt"), "utf8"), "confirmed\n");
});

test("a move whose source cannot be deleted reports the destination write, not a completed move", async () => {
  const sourceDir = join(workspace, "protected");
  await mkdir(sourceDir);
  await writeFile(join(sourceDir, "source.txt"), "original\n");
  await chmod(sourceDir, 0o555);
  try {
    const response = apply(
      "*** Begin Patch\n*** Update File: protected/source.txt\n" +
      "*** Move to: copied.txt\n@@\n-original\n+changed\n*** End Patch\n",
    );
    assert.equal(response.exitCode, 1);
    assert.deepEqual(response.changes, {
      exact: true,
      operations: [{ operation: "add", path: join(workspace, "copied.txt") }],
    });
    assert.equal(await readFile(join(sourceDir, "source.txt"), "utf8"), "original\n");
    assert.equal(await readFile(join(workspace, "copied.txt"), "utf8"), "changed\n");
    assert.deepEqual(response.fileChanges, {
      exact: true,
      operations: [{ path: join(workspace, "copied.txt"), before: null, after: "changed\n" }],
      moves: [],
    });
  } finally {
    await chmod(sourceDir, 0o755);
  }
});

test("success preserves the official stdout, stderr and exit status without a change record", () => {
  const patch = "*** Begin Patch\n*** Add File: success.txt\n+same\n*** End Patch\n";
  const referenceBinary = process.env.PI_CODEX_APPLY_PATCH_BIN ??
    join(homedir(), "20-dev/90-third-party-repos/codex/codex-rs/target/release/apply_patch");
  const reference = spawnSync(referenceBinary, [], { cwd: workspace, input: patch, encoding: "utf8" });
  assert.ifError(reference.error);
  const response = apply(patch);
  assert.equal(response.exitCode, reference.status);
  assert.equal(response.stdout, reference.stdout);
  assert.equal(response.stderr, reference.stderr);
  assert.equal(response.changes, null);
});

test("moving onto the same path records its actual deletion rather than inventing a surviving file", async () => {
  await writeFile(join(workspace, "self-move.txt"), "original\n");
  const response = apply(
    "*** Begin Patch\n*** Update File: self-move.txt\n*** Move to: self-move.txt\n@@\n-original\n+changed\n*** End Patch\n",
  );
  assert.equal(response.exitCode, 0);
  await assert.rejects(stat(join(workspace, "self-move.txt")), { code: "ENOENT" });
  assert.deepEqual(response.fileChanges.operations, [
    { path: join(workspace, "self-move.txt"), before: "original\n", after: null },
  ]);
});

test("an already-loaded v1 adapter still receives its original strict envelope after a helper rebuild", () => {
  const env = { ...process.env };
  delete env.PI_CODEX_APPLY_PATCH_PROTOCOL;
  const result = spawnSync(binary, [], {
    cwd: workspace, encoding: "utf8", env,
    input: "*** Begin Patch\n*** Add File: legacy-session.txt\n+ready\n*** End Patch\n",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0);
  const response = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(response).sort(), ["changes", "exitCode", "stderr", "stdout", "version"]);
  assert.equal(response.version, 1);
  assert.equal(response.changes, null);
  assert.match(response.stdout, /Success/);
});

test.after(() => console.log(`Inspectable backend workspace: ${workspace}`));
