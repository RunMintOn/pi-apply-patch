import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { model, modelOutput, piDir, sdk } from "./runtime.mjs";

const workspace = await realpath(await mkdtemp(join(tmpdir(), "pi-patch-rendering-")));
const loader = new sdk.DefaultResourceLoader({
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
await loader.reload();
assert.deepEqual(loader.getExtensions().errors, []);
const registered = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()]);
const tool = registered.find((entry) => (entry.definition ?? entry).name === "apply_patch");
const definition = tool.definition ?? tool;
const { theme, initTheme } = await import(pathToFileURL(join(piDir, "dist/modes/interactive/theme/theme.js")));
const { visibleWidth } = await import(pathToFileURL(join(piDir, "../pi-tui/dist/index.js")));
const { ansiToHtml, ansiLinesToHtml } = await import(pathToFileURL(join(piDir, "dist/core/export-html/ansi-to-html.js")));
const { default: chalk } = await import(pathToFileURL(join(piDir, "../../chalk/source/index.js")));
const previousColorLevel = chalk.level;
// Exercise the same text attributes as an interactive color terminal.
chalk.level = 3;
initTheme("dark", false);

const previousBinary = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
test.after(() => {
  chalk.level = previousColorLevel;
  if (previousBinary !== undefined) process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = previousBinary;
  console.log(`Inspectable rendering workspace: ${workspace}`);
});

async function execute(patch) {
  return definition.execute("render-test", { patch }, undefined, undefined, { cwd: workspace, model });
}

function renderer(result, expanded = false, lastComponent) {
  assert.equal(typeof definition.renderResult, "function");
  return definition.renderResult(result, { expanded, isPartial: false }, theme, {
    args: {},
    toolCallId: "render-test",
    state: {},
    lastComponent,
    cwd: workspace,
    expanded,
    isError: result.isError,
    outputPad: 0,
    invalidate() {},
  });
}

function display(component, width = 80) {
  const lines = component.render(width);
  assert.ok(lines.every((line) => visibleWidth(line) <= width), `overflow at ${width}`);
  return lines.map(stripVTControlCharacters).join("\n");
}

function toolComponent(result, cwd = workspace, isPartial = false) {
  const component = new sdk.ToolExecutionComponent(
    "apply_patch", "visual-call", {}, { outputPad: 1 },
    definition, { requestRender() {} }, cwd,
  );
  component.updateResult(result, isPartial);
  component.setExpanded(true);
  return component;
}

function withoutLinks(line) {
  return line.replace(/\x1b\]8;;[^\x07]*\x07/g, "");
}

function assertBackground(lines, token) {
  const expected = ansiToHtml(theme.bg(token, "sample")).match(/background-color:([^;"]+)/)[1];
  for (const line of lines) {
    const html = ansiToHtml(withoutLinks(line));
    const unstyled = html.replace(/<span style="([^"]*)">([\s\S]*?)<\/span>/g, (_match, style, text) => {
      if (text.trim()) assert.ok(style.includes(`background-color:${expected}`),
        `wrong background for ${text}: ${style}`);
      return "";
    });
    assert.equal(unstyled.trim(), "", `unstyled content: ${unstyled}`);
  }
}

test("one call shows a collapsed path summary and expands to the net actual diff without storing snapshots", async () => {
  await writeFile(join(workspace, "net.txt"), "ORIGINAL\nunchanged-secret-marker\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: net.txt\n@@\n-ORIGINAL\n+INTERMEDIATE\n" +
    "*** Update File: net.txt\n@@\n-INTERMEDIATE\n+FINAL\n*** End Patch\n",
  );
  assert.equal(result.isError, false);
  assert.equal(await readFile(join(workspace, "net.txt"), "utf8"), "FINAL\nunchanged-secret-marker\n");
  const collapsed = display(renderer(result));
  assert.match(collapsed, /net\.txt.*\+1.*-1/);
  assert.doesNotMatch(collapsed, /ORIGINAL|INTERMEDIATE|FINAL|unchanged-secret-marker/);
  const expanded = display(renderer(result, true));
  assert.match(expanded, /-1 ORIGINAL/);
  assert.match(expanded, /\+1 FINAL/);
  assert.doesNotMatch(expanded, /INTERMEDIATE/);
  assert.equal((expanded.match(/net\.txt/g) ?? []).length, 1);
  assert.match(modelOutput(result), /Success/);
  assert.doesNotMatch(modelOutput(result), /ORIGINAL|FINAL/);
  assert.equal(result.details.fileChanges, undefined);
  assert.equal(result.details.diffView.files[0].before, undefined);
  assert.equal(result.details.diffView.files[0].after, undefined);
});

test("moves show source deletion and the destination overwrite, even when a later operation fails", async () => {
  await writeFile(join(workspace, "source.txt"), "SOURCE\n");
  await writeFile(join(workspace, "destination.txt"), "DESTINATION\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: source.txt\n*** Move to: destination.txt\n@@\n-SOURCE\n+MOVED\n" +
    "*** Update File: never-ran.txt\n@@\n-missing\n+SHOULD_NOT_APPEAR\n*** End Patch\n",
  );
  assert.equal(result.isError, true);
  const shown = display(renderer(result, true));
  assert.match(shown, /Moved:/);
  assert.match(shown, /source\.txt Deleted \+0 -1/);
  assert.match(shown, /destination\.txt Updated \+1 -1/);
  assert.match(shown, /-1 SOURCE/);
  assert.match(shown, /-1 DESTINATION/);
  assert.match(shown, /\+1 MOVED/);
  assert.doesNotMatch(shown, /SHOULD_NOT_APPEAR/);
  assert.deepEqual(result.details.diffView.files.map((file) => file.path), [
    join(workspace, "source.txt"), join(workspace, "destination.txt"),
  ]);
});

test("a pure move shows its paths without replaying the complete file contents", async () => {
  const content = Array.from({ length: 2000 }, (_, index) => `unchanged-move-${index}`).join("\n") + "\n";
  await writeFile(join(workspace, "pure-move.txt"), content);
  const result = await execute(
    "*** Begin Patch\n*** Update File: pure-move.txt\n*** Move to: pure-moved.txt\n@@\n unchanged-move-0\n*** End Patch\n",
  );
  assert.equal(result.isError, false);
  assert.equal(await readFile(join(workspace, "pure-moved.txt"), "utf8"), content);
  for (const expanded of [false, true]) {
    const shown = display(renderer(result, expanded), 120);
    assert.match(shown, /Moved: pure-move\.txt -> pure-moved\.txt/);
    assert.doesNotMatch(shown, /unchanged-move-|Added|Deleted|No net text changes/);
    assert.ok(shown.split("\n").length < 5);
  }
  assert.deepEqual(result.details.diffView.files, []);
});

test("a move with edits shows only its real content diff, including after session restore", async () => {
  const lines = Array.from({ length: 2000 }, (_, index) => `unchanged-edit-move-${index}`);
  lines[1000] = "BEFORE_MOVE";
  await writeFile(join(workspace, "edited-move.txt"), lines.join("\n") + "\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: edited-move.txt\n*** Move to: edited-moved.txt\n@@\n-BEFORE_MOVE\n+AFTER_MOVE\n*** End Patch\n",
  );
  assert.equal(result.isError, false);
  assert.equal(result.details.diffView.files.length, 1);
  assert.equal(result.details.diffView.files[0].added, 1);
  assert.equal(result.details.diffView.files[0].removed, 1);
  assert.ok(JSON.stringify(result.details).length < 3000);
  await writeFile(join(workspace, "edited-moved.txt"), "LATER_EXTERNAL_CONTENT\n");
  const restored = toolComponent(JSON.parse(JSON.stringify(result)));
  for (const width of [60, 120]) {
    const shown = display(restored, width);
    assert.match(shown, /Moved: edited-move\.txt -> edited-moved\.txt/);
    assert.match(shown, /-1001 BEFORE_MOVE/);
    assert.match(shown, /\+1001 AFTER_MOVE/);
    assert.doesNotMatch(shown, /unchanged-edit-move-0\b|unchanged-edit-move-1999|LATER_EXTERNAL_CONTENT|Deleted/);
  }
});

test("move chains and reused source paths keep their complete per-path changes", async () => {
  await writeFile(join(workspace, "chain-source.txt"), "CHAIN_ORIGINAL\n");
  const chain = await execute(
    "*** Begin Patch\n*** Update File: chain-source.txt\n*** Move to: chain-middle.txt\n@@\n-CHAIN_ORIGINAL\n+CHAIN_INTERMEDIATE\n" +
    "*** Update File: chain-middle.txt\n*** Move to: chain-final.txt\n@@\n-CHAIN_INTERMEDIATE\n+CHAIN_FINAL\n*** End Patch\n",
  );
  assert.equal(chain.isError, false);
  const chained = display(renderer(chain, true), 120);
  assert.match(chained, /chain-source\.txt Deleted \+0 -1/);
  assert.match(chained, /chain-final\.txt Added \+1 -0/);
  assert.match(chained, /-1 CHAIN_ORIGINAL/);
  assert.match(chained, /\+1 CHAIN_FINAL/);
  assert.doesNotMatch(chained, /CHAIN_INTERMEDIATE/);

  await writeFile(join(workspace, "reused-source.txt"), "SOURCE_ORIGINAL\n");
  const reused = await execute(
    "*** Begin Patch\n*** Update File: reused-source.txt\n*** Move to: reused-target.txt\n@@\n-SOURCE_ORIGINAL\n+TARGET_CONTENT\n" +
    "*** Add File: reused-source.txt\n+RECREATED_SOURCE\n*** End Patch\n",
  );
  assert.equal(reused.isError, false);
  const shown = display(renderer(reused, true), 120);
  assert.match(shown, /reused-source\.txt Updated \+1 -1/);
  assert.match(shown, /reused-target\.txt Added \+1 -0/);
  assert.match(shown, /\+1 RECREATED_SOURCE/);
  assert.match(shown, /\+1 TARGET_CONTENT/);
});

test("an add that overwrites a file compares its actual old text, while a reverted path has no net diff", async () => {
  await writeFile(join(workspace, "overwrite.txt"), "OLD\n");
  const overwritten = await execute(
    "*** Begin Patch\n*** Add File: overwrite.txt\n+NEW\n*** End Patch\n",
  );
  const shown = display(renderer(overwritten, true));
  assert.match(shown, /Updated \+1 -1/);
  assert.match(shown, /-1 OLD/);
  assert.match(shown, /\+1 NEW/);
  const reverted = await execute(
    "*** Begin Patch\n*** Add File: ephemeral.txt\n+temporary\n" +
    "*** Delete File: ephemeral.txt\n*** End Patch\n",
  );
  assert.equal(reverted.isError, false);
  assert.match(display(renderer(reverted, true)), /No net text changes/);
  assert.deepEqual(reverted.details.diffView.files, []);
});

test("empty files and final-newline-only changes remain visible", async () => {
  await writeFile(join(workspace, "empty.txt"), "");
  const deleted = await execute("*** Begin Patch\n*** Delete File: empty.txt\n*** End Patch\n");
  assert.match(display(renderer(deleted)), /empty\.txt Deleted \+0 -0/);
  await writeFile(join(workspace, "newline.txt"), "text");
  const updated = await execute(
    "*** Begin Patch\n*** Update File: newline.txt\n@@\n-text\n+text\n*** End Patch\n",
  );
  assert.equal(await readFile(join(workspace, "newline.txt"), "utf8"), "text\n");
  const shown = display(renderer(updated, true));
  assert.match(shown, /No newline at end of file \(Before\)/);
  assert.doesNotMatch(shown, /No newline at end of file \(After\)/);
});

test("large unchanged file regions are not persisted in tool details", async () => {
  const lines = Array.from({ length: 10_000 }, (_, index) => `unchanged-${index}`);
  lines[5000] = "BEFORE";
  await writeFile(join(workspace, "large.txt"), lines.join("\n") + "\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: large.txt\n@@\n-BEFORE\n+AFTER\n*** End Patch\n",
  );
  assert.equal(result.isError, false);
  assert.ok(JSON.stringify(result.details).length < 2000);
  assert.doesNotMatch(JSON.stringify(result.details), /unchanged-0\\n|unchanged-9999/);
  assert.match(display(renderer(result)), /large\.txt.*\+1.*-1/);
});

test("incomplete records show only confirmed diffs and keep their uncertainty visible", async () => {
  const result = await execute(
    "*** Begin Patch\n*** Add File: confirmed.txt\n+COMMITTED\n" +
    "*** Delete File: nonexistent.txt\n*** Add File: skipped.txt\n+SKIPPED\n*** End Patch\n",
  );
  assert.equal(result.isError, true);
  const shown = display(renderer(result, true));
  assert.match(shown, /change record may be incomplete/);
  assert.match(shown, /\+1 COMMITTED/);
  assert.doesNotMatch(shown, /SKIPPED/);
});

test("the expanded result switches between aligned side-by-side and unified layouts on resize", async () => {
  await writeFile(join(workspace, "columns.txt"), "OLD_ROW\nCONTEXT\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: columns.txt\n@@\n-OLD_ROW\n+NEW_ROW\n+INSERTED\n CONTEXT\n*** End Patch\n",
  );
  const component = renderer(result, true);
  const wide = display(component, 120).split("\n");
  assert.ok(wide.some((line) => line.includes("Before") && line.includes("After")));
  assert.ok(wide.some((line) => line.includes("-1 OLD_ROW") && line.includes("+1 NEW_ROW")));
  const addedRow = wide.find((line) => line.includes("+2 INSERTED"));
  assert.match(addedRow, /^\s+│/);
  assert.ok(wide.some((line) => line.includes("2 CONTEXT") && line.includes("3 CONTEXT")));
  const narrow = display(component, 60);
  assert.doesNotMatch(narrow, /Before|After|│/);
  assert.match(narrow, /-1 OLD_ROW/);
  assert.match(narrow, /\+1 NEW_ROW/);
  assert.equal(display(component, 120), wide.join("\n"));
});

test("unequal long lines wrap completely without shifting later rows, including Chinese, emoji and tabs", async () => {
  const oldWords = Array.from({ length: 30 }, (_, index) => `left${index}`);
  const old = oldWords.join(" ") + "\t中文🙂 LEFT_END";
  const replacement = "right0 中文🙂\tRIGHT_END";
  await writeFile(join(workspace, "wrap.txt"), old + "\nALIGNED_CONTEXT\n");
  const result = await execute(
    `*** Begin Patch\n*** Update File: wrap.txt\n@@\n-${old}\n+${replacement}\n` +
    "+INSERTED_ROW\n ALIGNED_CONTEXT\n*** End Patch\n",
  );
  const component = renderer(result, true);
  for (const width of [100, 121]) {
    const rows = display(component, width).split("\n");
    const leftColumn = rows.filter((row) => row.includes("│")).map((row) => row.split("│")[0]).join(" ");
    const rightColumn = rows.filter((row) => row.includes("│")).map((row) => row.split("│")[1]).join(" ");
    for (const word of oldWords) assert.match(leftColumn, new RegExp(`\\b${word}\\b`));
    assert.match(leftColumn, /中文🙂 LEFT_END/);
    assert.match(rightColumn, /right0 中文🙂\s+RIGHT_END/);
    assert.ok(rows.some((row) => row.includes("2 ALIGNED_CONTEXT") && row.includes("3 ALIGNED_CONTEXT")));
    assert.ok(rows.findIndex((row) => row.includes("LEFT_END")) <
      rows.findIndex((row) => row.includes("INSERTED_ROW")));
  }
  for (const width of [12, 60, 99]) {
    const shown = display(component, width);
    assert.match(shown, /LEFT_END/);
    assert.match(shown, /RIGHT_END/);
  }
});

test("Pi's real tool component expands, collapses and restores persisted diffs without file reads", async () => {
  await writeFile(join(workspace, "restored.txt"), "BEFORE_RESTORE\n");
  const patch = "*** Begin Patch\n*** Update File: restored.txt\n@@\n-BEFORE_RESTORE\n+VISIBLE_DIFF\n*** End Patch\n";
  const result = await execute(patch);
  const restored = JSON.parse(JSON.stringify(result));
  await writeFile(join(workspace, "restored.txt"), "CHANGED_OUTSIDE_THIS_CALL\n");
  const component = new sdk.ToolExecutionComponent(
    "apply_patch", "restored-call", { patch }, { outputPad: 1 },
    definition, { requestRender() {} }, workspace,
  );
  component.updateResult(restored);
  const collapsed = display(component, 120);
  assert.match(collapsed, /restored\.txt Updated \+1 -1/);
  assert.doesNotMatch(collapsed, /VISIBLE_DIFF|Begin Patch/);
  component.setExpanded(true);
  const wide = display(component, 120);
  assert.match(wide, /Before.*After/);
  assert.match(wide, /VISIBLE_DIFF/);
  assert.doesNotMatch(wide, /CHANGED_OUTSIDE_THIS_CALL|Begin Patch/);
  const narrow = display(component, 60);
  assert.doesNotMatch(narrow, /Before.*After/);
  assert.match(narrow, /\+1 VISIBLE_DIFF/);
  await writeFile(join(workspace, "expanded-wide.txt"), wide + "\n");
  await writeFile(join(workspace, "expanded-narrow.txt"), narrow + "\n");
  await writeFile(join(workspace, "expanded-wide.ansi"), component.render(120).join("\n") + "\n");
  component.setExpanded(false);
  assert.equal(display(component, 120), collapsed);
});

test("theme invalidation rebuilds diff colors while preserving the displayed content", async () => {
  const result = await execute("*** Begin Patch\n*** Add File: themed.txt\n+THEME_CONTENT\n*** End Patch\n");
  const component = renderer(result, true);
  const dark = component.render(120).join("\n");
  try {
    initTheme("light", false);
    component.invalidate();
    const light = component.render(120).join("\n");
    assert.notEqual(dark, light);
    assert.equal(stripVTControlCharacters(dark), stripVTControlCharacters(light));
  } finally {
    initTheme("dark", false);
  }
});

test("CRLF files keep carriage returns visible instead of corrupting terminal rows", async () => {
  await writeFile(join(workspace, "crlf.txt"), "OLD\r\nCONTEXT\r\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: crlf.txt\n@@\n-OLD\n+NEW\n*** End Patch\n",
  );
  assert.equal(result.isError, false);
  assert.equal(await readFile(join(workspace, "crlf.txt"), "utf8"), "NEW\r\nCONTEXT\r\n");
  const component = renderer(result, true);
  for (const width of [60, 120]) {
    const shown = display(component, width);
    assert.doesNotMatch(shown, /\r/);
    assert.match(shown, /OLD␍/);
    assert.match(shown, /CONTEXT␍/);
    assert.match(shown, /NEW/);
  }
});

test("a large expanded diff remains complete and repeated renders reuse the current layout", async () => {
  const before = Array.from({ length: 500 }, (_, index) => `old-${index}`);
  const after = Array.from({ length: 500 }, (_, index) => `new-${index}`);
  await writeFile(join(workspace, "many-lines.txt"), before.join("\n") + "\n");
  const started = performance.now();
  const result = await execute(
    "*** Begin Patch\n*** Update File: many-lines.txt\n@@\n" +
    before.map((line) => "-" + line + "\n").join("") +
    after.map((line) => "+" + line + "\n").join("") + "*** End Patch\n",
  );
  const executionMs = performance.now() - started;
  assert.equal(result.isError, false);
  assert.match(display(renderer(result)), /many-lines\.txt.*\+500.*-500/);
  const component = renderer(result, true);
  const layoutStarted = performance.now();
  const wide = display(component, 120);
  const firstLayoutMs = performance.now() - layoutStarted;
  assert.equal((wide.match(/old-\d+/g) ?? []).length, 500);
  assert.equal((wide.match(/new-\d+/g) ?? []).length, 500);
  const repeatStarted = performance.now();
  const lines = component.render(120);
  for (let index = 0; index < 100; index++) {
    assert.deepEqual(component.render(120), lines);
  }
  const repeatedRenderMs = performance.now() - repeatStarted;
  const narrow = display(component, 60);
  assert.equal((narrow.match(/old-\d+/g) ?? []).length, 500);
  assert.equal((narrow.match(/new-\d+/g) ?? []).length, 500);
  await writeFile(join(workspace, "performance.json"), JSON.stringify({
    changedLinesPerSide: 500, executionMs, firstLayoutMs,
    repeatedRenders: 100, repeatedRenderMs,
    detailsBytes: Buffer.byteLength(JSON.stringify(result.details)),
  }, null, 2) + "\n");
});

test("a 2000-line replacement expands completely within the initial layout budget", async () => {
  const before = Array.from({ length: 2000 }, (_, index) => `const old_${index} = "previous content ${index}";`);
  const after = Array.from({ length: 2000 }, (_, index) => `const new_${index} = "updated content ${index}";`);
  await writeFile(join(workspace, "layout-budget.ts"), before.join("\n") + "\n");
  const result = await execute("*** Begin Patch\n*** Update File: layout-budget.ts\n@@\n" +
    before.map(line => "-" + line + "\n").join("") +
    after.map(line => "+" + line + "\n").join("") + "*** End Patch\n");
  assert.equal(result.isError, false);
  const component = renderer(result, true);
  const started = performance.now();
  const lines = component.render(140);
  const firstLayoutMs = performance.now() - started;
  const shown = lines.map(stripVTControlCharacters).join("\n");
  assert.equal((shown.match(/old_\d+/g) ?? []).length, 2000);
  assert.equal((shown.match(/new_\d+/g) ?? []).length, 2000);
  await writeFile(join(workspace, "layout-budget.json"), JSON.stringify({ firstLayoutMs }, null, 2));
  assert.ok(firstLayoutMs < 250, `initial wide layout took ${firstLayoutMs.toFixed(1)}ms`);
});

test("the real tool shell keeps its background across both columns and wrapped rows", async () => {
  await writeFile(join(workspace, "background.txt"), "OLD_CONTENT\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: background.txt\n@@\n-OLD_CONTENT\n+" +
    "NEW_CONTENT ".repeat(12).trimEnd() + "\n*** End Patch\n",
  );
  const failed = await execute(
    "*** Begin Patch\n*** Update File: background.txt\n@@\n-" +
    "NEW_CONTENT ".repeat(12).trimEnd() +
    "\n+COMMITTED_BEFORE_FAILURE\n*** Delete File: missing-background.txt\n*** End Patch\n",
  );
  assert.equal(failed.isError, true);
  try {
    for (const name of ["dark", "light"]) {
      initTheme(name, false);
      for (const [component, token] of [
        [toolComponent(result), "toolSuccessBg"],
        [toolComponent(result, workspace, true), "toolPendingBg"],
        [toolComponent(failed), "toolErrorBg"],
      ]) {
        for (const width of [60, 120, 121]) assertBackground(component.render(width), token);
      }
    }
  } finally {
    initTheme("dark", false);
  }
});

test("both columns share a stable center in the real padded tool shell", async () => {
  await writeFile(join(workspace, "center.txt"), "OLD\nCONTEXT\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: center.txt\n@@\n-OLD\n+NEW\n+INSERTED\n CONTEXT\n*** End Patch\n",
  );
  const component = toolComponent(result);
  for (const width of [102, 120, 121, 160]) {
    const rows = component.render(width).map(stripVTControlCharacters);
    const positions = rows.filter((row) => row.includes("│")).map((row) => visibleWidth(row.split("│")[0]));
    assert.ok(positions.length > 2);
    assert.equal(new Set(positions).size, 1);
    assert.ok(Math.abs(positions[0] - (width - 1) / 2) <= 0.5);
  }
});

test("added and deleted files use the full width without an empty comparison column", async () => {
  const added = await execute(
    "*** Begin Patch\n*** Add File: single-column.txt\n+ADDED_TEXT\n*** End Patch\n",
  );
  const deleted = await execute("*** Begin Patch\n*** Delete File: single-column.txt\n*** End Patch\n");
  for (const [result, expected] of [[added, "+1 ADDED_TEXT"], [deleted, "-1 ADDED_TEXT"]]) {
    const shown = display(toolComponent(result), 120);
    assert.match(shown, new RegExp(expected.replace(/[+]/g, "\\+")));
    assert.doesNotMatch(shown, /Before|After|│/);
  }
});

test("outside-workspace paths do not climb through parent directories or push counts onto another line", async () => {
  const result = await execute(
    "*** Begin Patch\n*** Add File: outside-caption.txt\n+content\n*** End Patch\n",
  );
  const component = toolComponent(result, process.cwd());
  component.setExpanded(false);
  for (const width of [80, 120]) {
    const shown = display(component, width);
    assert.doesNotMatch(shown, /(?:\.\.\/){2}|"/);
    const caption = shown.split("\n").find((line) => line.includes("outside-caption.txt"));
    assert.match(caption, /^\s*\//);
    assert.match(caption, /Added \+1 -0/);
  }
});

test("the screenshot journey can be inspected from the actual tool component's ANSI output", async () => {
  const added = await execute(
    "*** Begin Patch\n*** Add File: visual-keep.md\n+# Apply-patch test\n+\n+Original content.\n" +
    "*** Add File: visual-remove.md\n+This file is here to test deletion.\n*** End Patch\n",
  );
  const updated = await execute(
    "*** Begin Patch\n*** Update File: visual-keep.md\n@@\n-Original content.\n" +
    "+Modified content — apply-patch update succeeded.\n*** Delete File: visual-remove.md\n*** End Patch\n",
  );
  const components = [toolComponent(added, process.cwd()), toolComponent(updated, process.cwd())];
  for (const [width, filename] of [[140, "visual.html"], [80, "visual-narrow.html"]]) {
    const sections = components.map((component) =>
      `<section>${ansiLinesToHtml(component.render(width).map(withoutLinks))}</section>`);
    await writeFile(join(workspace, filename), `<!doctype html><meta charset="utf-8">
<title>Actual apply_patch tool output</title>
<style>body{margin:20px;background:#1f1f1f;color:#d4d4d4;font:15px/1.5 Menlo,monospace}
section{margin-bottom:20px}.ansi-line{white-space:pre;height:1.5em}
.ansi-line span{display:inline-block;vertical-align:top;height:100%}</style>${sections.join("\n")}`);
    for (const component of components) display(component, width);
  }
});

test("a modified line keeps red/green text without inverse word blocks in either layout", async () => {
  await writeFile(join(workspace, "plain-highlight.txt"), "Original content.\n");
  const result = await execute(
    "*** Begin Patch\n*** Update File: plain-highlight.txt\n@@\n-Original content.\n+Modified content.\n*** End Patch\n",
  );
  const component = toolComponent(result);
  for (const width of [60, 120]) {
    const ansi = component.render(width).join("\n");
    assert.doesNotMatch(ansi, /\x1b\[(?:7|27)m/);
    const shown = stripVTControlCharacters(ansi);
    assert.match(shown, /Original content/);
    assert.match(shown, /Modified content/);
  }
});
