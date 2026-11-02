import { accessSync, constants } from "node:fs";

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("Pack the macOS arm64 helper on a supported host.");
}
accessSync(new URL("../bin/pi-apply-patch", import.meta.url), constants.X_OK);
