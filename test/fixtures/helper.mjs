#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const patch = readFileSync(0);
function respond(stdout, stderr, exitCode, changes = null, fileChanges = null) {
  process.stdout.write(JSON.stringify({ version: 2, stdout, stderr, exitCode, changes, fileChanges }));
  process.exitCode = exitCode;
}
switch (process.env.PI_PATCH_TEST_MODE) {
  case "echo":
    respond(patch.toString("utf8"), "", 0);
    break;
  case "both":
    respond("out\n", "err\n", 1, { exact: true, operations: [] });
    break;
  case "ordered-changes":
    respond("", "match failed\n", 1, {
      exact: true,
      operations: [
        { operation: "add", path: "/a.txt" },
        { operation: "update", path: "/a.txt" },
        { operation: "delete", path: "/removed.txt" },
        { operation: "move", path: "/old.txt", moveTo: "/new.txt" },
        { operation: "add", path: '/line\n"quoted".txt' },
      ],
    });
    break;
  case "inexact":
    respond("", "write failed\n", 1, {
      exact: false,
      operations: [{ operation: "update", path: "/confirmed.txt" }],
    });
    break;
  case "terminated":
    writeFileSync("terminated.txt", "already written\n");
    process.kill(process.pid, "SIGTERM");
    break;
  case "malformed":
    process.stdout.write('{"version":2');
    break;
  case "invalid-record":
    respond("", "error\n", 1, {
      exact: true,
      operations: [{ operation: "invented", path: "/not-confirmed.txt" }],
    });
    break;
  case "invalid-file-changes":
    respond("", "", 0, null, {
      exact: true,
      operations: [{ path: "/bad.txt", before: 42, after: "not trusted" }],
      moves: [],
    });
    break;
  case "inexact-move":
    respond("", "later write failed\n", 1, {
      exact: false,
      operations: [{ operation: "move", path: "/source.txt", moveTo: "/destination.txt" }],
    }, {
      exact: false,
      operations: [
        { path: "/source.txt", before: "SOURCE\n", after: null },
        { path: "/destination.txt", before: null, after: "MOVED\n" },
      ],
      moves: [{ path: "/source.txt", moveTo: "/destination.txt" }],
    });
    break;
  case "inconsistent":
    respond("", "", 0, { exact: true, operations: [] });
    process.exitCode = 1;
    break;
  default:
    throw new Error("Unknown fixture mode");
}
