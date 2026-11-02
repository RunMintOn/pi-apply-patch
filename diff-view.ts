import { isAbsolute, relative, sep } from "node:path";
import {
  generateDiffString,
  renderDiff,
  type Theme,
  type ThemeBg,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, sliceByColumn, visibleWidth, type Component } from "@earendil-works/pi-tui";

export type FileChangeRecord = {
  exact: boolean;
  operations: { path: string; before: string | null; after: string | null }[];
  moves: { path: string; moveTo: string }[];
};

type FileDiff = {
  path: string;
  kind: "Added" | "Deleted" | "Updated" | "Wrote";
  diff: string;
  added: number;
  removed: number;
  beforeNoNewline: boolean;
  afterNoNewline: boolean;
};

export type DiffView = {
  exact: boolean;
  files: FileDiff[];
  moves: FileChangeRecord["moves"];
};

export function buildDiffView(record: FileChangeRecord): DiffView {
  const files = new Map<string, FileChangeRecord["operations"][number]>();
  const ambiguous = new Set<string>();
  for (const operation of record.operations) {
    const previous = files.get(operation.path);
    if (previous) {
      previous.after = operation.after;
      ambiguous.add(operation.path);
    } else files.set(operation.path, { ...operation });
  }
  const movePaths = new Set<string>();
  for (const move of record.moves) {
    for (const path of [move.path, move.moveTo]) {
      if (movePaths.has(path)) ambiguous.add(path);
      movePaths.add(path);
    }
  }
  if (record.exact) {
    for (const move of record.moves) {
      if (ambiguous.has(move.path) || ambiguous.has(move.moveTo)) continue;
      const source = files.get(move.path);
      const destination = files.get(move.moveTo);
      // Only pair a single deletion with a single new destination. Overwrites,
      // repeated operations and move chains keep their full per-path diffs.
      if (source && source.before !== null && source.after === null &&
          destination && destination.before === null && destination.after !== null) {
        files.delete(move.path);
        destination.before = source.before;
      }
    }
  }
  const diffs: FileDiff[] = [];
  for (const { path, before, after } of files.values()) {
    if (before === after) continue;
    // Raw CR characters are terminal controls, not printable diff content.
    const diff = generateDiffString(before ?? "", after ?? "").diff.replace(/\r/g, "␍");
    const lines = diff.split("\n");
    diffs.push({
      path,
      kind: before === null ? (record.exact ? "Added" : "Wrote") : after === null ? "Deleted" : "Updated",
      diff,
      added: lines.filter((line) => line.startsWith("+")).length,
      removed: lines.filter((line) => line.startsWith("-")).length,
      beforeNoNewline: before !== null && before.length > 0 && !before.endsWith("\n"),
      afterNoNewline: after !== null && after.length > 0 && !after.endsWith("\n"),
    });
  }
  return { exact: record.exact, files: diffs, moves: record.moves };
}

function displayPath(path: string, cwd: string): string {
  const local = relative(cwd, path);
  const label = local === ".." || local.startsWith(".." + sep) || isAbsolute(local)
    ? path : local || path;
  return /[\x00-\x1f\x7f"]/.test(label) ? JSON.stringify(label) : label;
}

function fitPath(path: string, width: number): string {
  const length = visibleWidth(path);
  if (length <= width) return path;
  const parts = path.split(sep);
  if (parts.length > 3) {
    const root = parts[0] || sep + parts[1];
    const abbreviated = root + sep + "…" + sep + parts.slice(-2).join(sep);
    if (visibleWidth(abbreviated) <= width) return abbreviated;
  }
  const prefix = Math.min(10, Math.floor((width - 1) / 3));
  const suffix = width - prefix - 1;
  return sliceByColumn(path, 0, prefix, true) + "…" + sliceByColumn(path, length - suffix, suffix, true);
}

type PatchResult = {
  content: { type: string; text?: string }[];
  details?: { diffView?: DiffView | null; diffError?: string };
};

type DiffRow = [string, string];
type PreparedFile = {
  path: string;
  stats: string;
  file: FileDiff;
  unified?: Text;
  coloredLines?: string[];
  rows?: DiffRow[];
  notes?: Text;
};

function pairRows(diff: string, coloredLines: string[], theme: Theme): DiffRow[] {
  const lines = diff.split("\n");
  const rows: DiffRow[] = [];
  let offset = 0;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (line.startsWith("-") || line.startsWith("+")) {
      const removed: string[] = [];
      const added: string[] = [];
      while (index < lines.length && /^[+-]/.test(lines[index])) {
        if (lines[index].startsWith("-")) removed.push(coloredLines[index]);
        else added.push(coloredLines[index]);
        index++;
      }
      for (let row = 0; row < Math.max(removed.length, added.length); row++) {
        rows.push([removed[row] ?? "", added[row] ?? ""]);
      }
      offset += added.length - removed.length;
    } else {
      const context = line.match(/^ (\s*\d+) (.*)$/);
      const right = context
        ? theme.fg("toolDiffContext",
          ` ${String(Number(context[1]) + offset).padStart(context[1].length, " ")} ${context[2].replace(/\t/g, "   ")}`)
        : coloredLines[index];
      rows.push([coloredLines[index], right]);
      index++;
    }
  }
  return rows;
}

class PatchResultComponent implements Component {
  private prepared?: { header: Text; files: PreparedFile[] };
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private result: PatchResult,
    private expanded: boolean,
    private theme: Theme,
    private cwd: string,
    private isError: boolean,
    private background: ThemeBg,
  ) {}

  update(result: PatchResult, expanded: boolean, theme: Theme, cwd: string, isError: boolean, background: ThemeBg): void {
    if (this.result === result && this.expanded === expanded && this.theme === theme &&
        this.cwd === cwd && this.isError === isError && this.background === background) return;
    this.result = result;
    this.expanded = expanded;
    this.theme = theme;
    this.cwd = cwd;
    this.isError = isError;
    this.background = background;
    this.invalidate();
  }

  invalidate(): void {
    this.prepared = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private prepare(): { header: Text; files: PreparedFile[] } {
    const { result, theme, cwd } = this;
    const view = result.details?.diffView;
    const output: string[] = [];
    if (this.isError || !view) {
      output.push(result.content.filter((item) => item.type === "text")
        .map((item) => item.text).join("\n"));
    }
    if (result.details?.diffError) {
      output.push(theme.fg("warning", "Diff unavailable: " + result.details.diffError));
    }
    if (view) {
      if (!view.exact) {
        output.push(theme.fg("warning", "Confirmed changes only; the change record may be incomplete."));
      }
      for (const move of view.moves) {
        output.push(theme.fg("muted", `Moved: ${displayPath(move.path, cwd)} -> ${displayPath(move.moveTo, cwd)}`));
      }
      if (view.files.length === 0 && view.moves.length === 0) {
        output.push(theme.fg("muted", view.exact
          ? "No net text changes." : "No confirmed text diff available."));
      }
    }
    const files = (view?.files ?? []).map((file): PreparedFile => {
      const path = displayPath(file.path, cwd);
      const stats = `${theme.fg("muted", file.kind)} ` +
        `${theme.fg("toolDiffAdded", `+${file.added}`)} ${theme.fg("toolDiffRemoved", `-${file.removed}`)}`;
      if (!this.expanded) return { path, stats, file };
      const colored = renderDiff(file.diff).replace(/\x1b\[(?:7|27)m/g, "");
      const notes = [
        ...(file.beforeNoNewline ? ["\\ No newline at end of file (Before)"] : []),
        ...(file.afterNoNewline ? ["\\ No newline at end of file (After)"] : []),
      ];
      return {
        path, stats, file,
        unified: new Text(colored, 0, 0),
        coloredLines: colored.split("\n"),
        notes: notes.length > 0 ? new Text(theme.fg("muted", notes.join("\n")), 0, 0) : undefined,
      };
    });
    return { header: new Text(output.join("\n"), 0, 0), files };
  }

  private renderRow([left, right]: DiffRow, width: number): string[] {
    const leftWidth = Math.floor((width - 3) / 2);
    const rightWidth = width - 3 - leftWidth;
    // Text already wraps and pads to the requested width; no general-purpose
    // stack measurement or ANSI column compositing is needed for fixed columns.
    const leftLines = new Text(left, 0, 0).render(leftWidth);
    const rightLines = new Text(right, 0, 0).render(rightWidth);
    const height = Math.max(leftLines.length, rightLines.length);
    const divider = this.theme.fg("muted", "│");
    return Array.from({ length: height }, (_, index) =>
      (leftLines[index] ?? " ".repeat(leftWidth)) + "\x1b[0m " + divider + "\x1b[0m " +
      (rightLines[index] ?? " ".repeat(rightWidth)) + "\x1b[0m");
  }

  render(width: number): string[] {
    if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
    this.prepared ??= this.prepare();
    const lines = this.prepared.header.render(width).slice();
    for (const [index, prepared] of this.prepared.files.entries()) {
      if (this.expanded && index > 0) lines.push("");
      const pathWidth = Math.min(60, Math.max(8, width - visibleWidth(prepared.stats) - 1));
      lines.push(...new Text(`${fitPath(prepared.path, pathWidth)} ${prepared.stats}`, 0, 0).render(width));
      if (this.expanded && prepared.file.diff) {
        if (width >= 100 && prepared.file.kind === "Updated") {
          lines.push(...this.renderRow([
            this.theme.fg("muted", "Before"), this.theme.fg("muted", "After"),
          ], width));
          prepared.rows ??= pairRows(prepared.file.diff, prepared.coloredLines!, this.theme);
          for (const row of prepared.rows) lines.push(...this.renderRow(row, width));
        } else {
          lines.push(...prepared.unified!.render(width));
        }
      }
      if (prepared.notes) lines.push(...prepared.notes.render(width));
    }
    this.cachedWidth = width;
    // Column style resets must preserve the enclosing tool shell's background.
    const background = this.theme.getBgAnsi(this.background);
    this.cachedLines = lines.map((line) => line.replaceAll("\x1b[0m", "\x1b[0m" + background));
    return this.cachedLines;
  }
}

export const patchRenderers: ToolRenderers = {
  renderCall(_args, theme) {
    return new Text(theme.fg("toolTitle", theme.bold("apply_patch")), 0, 0);
  },
  renderResult(result, options, theme, context) {
    const background = options.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
    const component = context.lastComponent instanceof PatchResultComponent
      ? context.lastComponent
      : new PatchResultComponent(result, options.expanded, theme, context.cwd, context.isError, background);
    component.update(result, options.expanded, theme, context.cwd, context.isError, background);
    return component;
  },
};
