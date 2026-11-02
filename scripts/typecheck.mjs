import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { piDir } from "../test/runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const modules = dirname(dirname(piDir));
const config = join(root, ".build/tsconfig.json");
mkdirSync(dirname(config), { recursive: true });
writeFileSync(config, JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    skipLibCheck: true,
    types: ["node"],
    typeRoots: [join(modules, "@types")],
    paths: {
      "@earendil-works/pi-coding-agent": [join(piDir, "dist/index.d.ts")],
      "@earendil-works/pi-tui": [join(modules, "@earendil-works/pi-tui/dist/index.d.ts")],
      "typebox": [join(modules, "typebox/build/index.d.mts")],
      "typebox/value": [join(modules, "typebox/build/value/index.d.mts")],
    },
  },
  files: [join(root, "index.ts")],
}, null, 2));
execFileSync(process.env.PI_TSC ?? "tsc", ["--project", config], { stdio: "inherit" });
