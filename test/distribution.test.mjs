import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { model, sdk } from "./runtime.mjs";

async function loadPlugin(plugin, cwd) {
  const loader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, "agent"),
    settingsManager: sdk.SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: [join(plugin, "index.ts")],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  return loader;
}

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "pi-patch-distribution-"));
  const plugin = join(cwd, "plugin");
  await mkdir(join(plugin, "bin"), { recursive: true });
  await mkdir(join(plugin, ".build/bin"), { recursive: true });
  for (const name of ["index.ts", "diff-view.ts", "package.json"]) {
    await copyFile(new URL(`../${name}`, import.meta.url), join(plugin, name));
  }
  return { cwd, plugin };
}

test("relocated packages prefer the bundled helper, retain development fallback and honor overrides", async () => {
  const { cwd, plugin } = await fixture();
  const bundled = join(plugin, "bin/pi-apply-patch");
  const override = join(cwd, "override.mjs");
  await copyFile(new URL("./fixtures/helper.mjs", import.meta.url), bundled);
  await copyFile(new URL("../.build/bin/pi-apply-patch", import.meta.url), override);
  await chmod(bundled, 0o755);
  await chmod(override, 0o755);
  await copyFile(new URL("../.build/bin/pi-apply-patch", import.meta.url),
    join(plugin, ".build/bin/pi-apply-patch"));
  const previous = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  const previousMode = process.env.PI_PATCH_TEST_MODE;
  delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  process.env.PI_PATCH_TEST_MODE = "echo";
  try {
    const loader = await loadPlugin(plugin, cwd);
    const entry = loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.values()])
      .find((tool) => (tool.definition ?? tool).name === "apply_patch");
    const tool = entry.definition ?? entry;
    let patch = "*** Begin Patch\n*** Add File: selected.txt\n+development\n*** End Patch\n";
    const execute = () => tool.execute("distribution", { patch }, undefined, undefined, { cwd, model });
    assert.equal((await execute()).content[0].text, patch, "bundled helper wins over .build");
    await assert.rejects(readFile(join(cwd, "selected.txt")), { code: "ENOENT" });
    await rename(bundled, bundled + ".disabled");
    assert.equal((await execute()).isError, false);
    assert.equal(await readFile(join(cwd, "selected.txt"), "utf8"), "development\n");
    await rename(bundled + ".disabled", bundled);
    process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = override;
    patch = "*** Begin Patch\n*** Add File: selected.txt\n+override\n*** End Patch\n";
    assert.equal((await execute()).isError, false);
    assert.equal(await readFile(join(cwd, "selected.txt"), "utf8"), "override\n",
      "explicit helper wins even when bundled and development helpers exist");
  } finally {
    if (previous === undefined) delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
    else process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = previous;
    if (previousMode === undefined) delete process.env.PI_PATCH_TEST_MODE;
    else process.env.PI_PATCH_TEST_MODE = previousMode;
  }
});

test("unsupported hosts leave apply_patch inactive even with an executable override", async () => {
  const { cwd, plugin } = await fixture();
  const previous = process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
  process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN =
    new URL("./fixtures/helper.mjs", import.meta.url).pathname;
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const arch = Object.getOwnPropertyDescriptor(process, "arch");
  try {
    for (const [os, cpu] of [["linux", "arm64"], ["darwin", "x64"]]) {
      Object.defineProperty(process, "platform", { value: os });
      Object.defineProperty(process, "arch", { value: cpu });
      const loader = await loadPlugin(plugin, cwd);
      const { session } = await sdk.createAgentSession({
        cwd,
        agentDir: join(cwd, "agent"),
        model,
        resourceLoader: loader,
        settingsManager: sdk.SettingsManager.inMemory(),
        sessionManager: sdk.SessionManager.inMemory(cwd),
      });
      const notices = [];
      try {
        await session.bindExtensions({ uiContext: { notify: (message) => notices.push(message) } });
        const active = session.getActiveToolNames();
        assert.equal(active.includes("apply_patch"), false);
        assert.equal(active.includes("write"), false);
        assert.equal(active.includes("edit"), false);
        assert.equal(active.includes("read"), true);
        assert.ok(notices.some((message) => message.includes("macOS arm64")));
      } finally {
        session.dispose();
      }
    }
  } finally {
    Object.defineProperty(process, "platform", platform);
    Object.defineProperty(process, "arch", arch);
    if (previous === undefined) delete process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN;
    else process.env.PI_CODEX_APPLY_PATCH_HELPER_BIN = previous;
  }
});
