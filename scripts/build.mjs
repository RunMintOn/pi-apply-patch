import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "c22a06c18070c3e33bd2648c7210a00a2a9f6f80";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = process.env.PI_CODEX_SOURCE ?? join(homedir(), "20-dev/90-third-party-repos/codex");
const snapshot = join(root, ".build", revision);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This package builds and distributes a macOS arm64 helper only.");
}

mkdirSync(snapshot, { recursive: true });
const archive = join(root, ".build", `${revision}.tar`);
run("git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, revision]);
run("tar", ["-xf", archive, "-C", snapshot]);
const crate = join(snapshot, "codex-rs/apply-patch");
copyFileSync(join(root, "backend/standalone_executable.rs"), join(crate, "src/standalone_executable.rs"));
const manifest = join(crate, "Cargo.toml");
writeFileSync(manifest, readFileSync(manifest, "utf8")
  .replace("[dependencies]\n", "[dependencies]\nserde_json = { workspace = true }\n"));
// serde_json is already locked upstream; add only our direct dependency edge.
const lockfile = join(snapshot, "codex-rs/Cargo.lock");
const originalLock = readFileSync(lockfile, "utf8");
const locked = originalLock.replace(
  /(\[\[package\]\]\nname = "codex-apply-patch"[\s\S]*?)(?=\n\[\[package\]\])/,
  (entry) => entry.replace(' "similar",\n', ' "serde_json",\n "similar",\n'),
);
if (locked === originalLock) throw new Error("Could not extend the pinned upstream lockfile.");
writeFileSync(lockfile, locked);
const target = join(root, ".build/target");
run("cargo", [
  "build", "--locked", "--offline", "--release", "-p", "codex-apply-patch", "--bin", "apply_patch",
  "--target-dir", target,
], { cwd: join(snapshot, "codex-rs") });
mkdirSync(join(root, ".build/bin"), { recursive: true });
copyFileSync(join(target, "release/apply_patch"), join(root, ".build/bin/pi-apply-patch"));
mkdirSync(join(root, "bin"), { recursive: true });
const bundled = join(root, "bin/pi-apply-patch");
copyFileSync(join(root, ".build/bin/pi-apply-patch"), bundled);
run("strip", ["-x", bundled]);
console.log(`Built pinned helper: ${join(root, ".build/bin/pi-apply-patch")}`);
console.log(`Stripped distribution helper: ${bundled}`);
