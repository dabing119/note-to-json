import { Notice, Plugin } from "obsidian";
import type { Editor } from "obsidian";
import { formatMarkdown, simplifyMarkdown } from "./core/pipeline";
import type { PipelineOptions } from "./core/pipeline";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";
import type { TidySettings } from "./settings";
import { TidySettingTab } from "./settingsTab";
import { compressJson, formatJson } from "./core/json";
import type { JsonError } from "./core/json";

type Mode = "format" | "simplify";
type JsonMode = "format" | "compress";

/** 超过 2 MB 的文档直接跳过，避免主线程长时间阻塞 */
const MAX_TEXT_LENGTH = 2 * 1024 * 1024;

export default class MarkdownTidyPlugin extends Plugin {
  settings: TidySettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TidySettingTab(this.app, this));

    this.addCommand({
      id: "tidy-format",
      name: "格式化",
      editorCallback: (editor) => this.run(editor, "format"),
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "f" }],
    });

    this.addCommand({
      id: "tidy-simplify",
      name: "简化",
      editorCallback: (editor) => this.run(editor, "simplify"),
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "s" }],
    });

    this.addCommand({
      id: "tidy-json-format",
      name: "格式化 JSON",
      editorCallback: (editor) => this.runJson(editor, "format"),
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "j" }],
    });

    this.addCommand({
      id: "tidy-json-compress",
      name: "压缩 JSON",
      editorCallback: (editor) => this.runJson(editor, "compress"),
      hotkeys: [{ modifiers: ["Mod", "Alt"], key: "m" }],
    });

    // 右键菜单与命令共用同一个处理函数
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("格式化 JSON")
            .setIcon("braces")
            .onClick(() => this.runJson(editor, "format")),
        );
        menu.addItem((item) =>
          item
            .setTitle("压缩 JSON")
            .setIcon("minimize")
            .onClick(() => this.runJson(editor, "compress")),
        );
      }),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private run(editor: Editor, mode: Mode): void {
    const { start, end, prefix } = resolveRange(editor);
    const source = editor.getRange(start, end);

    if (source.length > MAX_TEXT_LENGTH) {
      new Notice("文件过大，已跳过");
      return;
    }

    const options: PipelineOptions = {
      enabled: mode === "format" ? this.settings.formatRules : this.settings.simplifyRules,
      codeBlockDefaultLang: this.settings.codeBlockDefaultLang,
      prefix,
      documentText: editor.getValue(),
    };

    let output: string;
    try {
      output = mode === "format" ? formatMarkdown(source, options) : simplifyMarkdown(source, options);
    } catch (error) {
      console.error("[note-to-json] 处理失败", error);
      new Notice("格式化失败，详见控制台");
      return;
    }

    if (output === source) {
      this.notify("已是规范格式");
      return;
    }

    const cursor = editor.getCursor("from");
    editor.transaction({ changes: [{ from: start, to: end, text: output }] });

    // 规则会插入/删除空行，行号无法精确映射：保持在原行号并收敛到合法范围，列位置尽量保留
    const targetLine = Math.max(0, Math.min(cursor.line, editor.lineCount() - 1));
    const targetCh = Math.min(cursor.ch, editor.getLine(targetLine).length);
    editor.setCursor({ line: targetLine, ch: targetCh });

    this.notify(mode === "format" ? "已格式化" : "已简化");
  }

  private runJson(editor: Editor, mode: JsonMode): void {
    const { start, end, hasSelection } = resolveJsonRange(editor);
    const source = editor.getRange(start, end);

    if (source.trim().length === 0) {
      new Notice("没有可处理的 JSON 内容");
      return;
    }

    if (source.length > MAX_TEXT_LENGTH) {
      new Notice("文件过大，已跳过");
      return;
    }

    const result = mode === "format" ? formatJson(source) : compressJson(source);
    if (!result.ok) {
      console.error("[note-to-json] JSON 处理失败", result.error.raw);
      new Notice(jsonErrorMessage(result.error, hasSelection), 8000);
      return;
    }

    if (result.text === source) {
      this.notify("JSON 已是规范格式");
      return;
    }

    const cursor = editor.getCursor("from");
    editor.transaction({ changes: [{ from: start, to: end, text: result.text }] });

    const targetLine = Math.max(0, Math.min(cursor.line, editor.lineCount() - 1));
    const targetCh = Math.min(cursor.ch, editor.getLine(targetLine).length);
    editor.setCursor({ line: targetLine, ch: targetCh });

    const fixedHint =
      result.fixedWhitespace > 0 ? `（已修正 ${result.fixedWhitespace} 处全角/特殊空白）` : "";
    this.notify((mode === "format" ? "JSON 已格式化" : "JSON 已压缩") + fixedHint);
  }

  private notify(message: string): void {
    if (this.settings.showNotice) {
      new Notice(message);
    }
  }
}

interface EditorRange {
  start: { line: number; ch: number };
  end: { line: number; ch: number };
  /** 选区上方的文档内容，传入 pipeline 做保护区预热 */
  prefix: string;
}

/**
 * 把选区扩展成整行区间；无选区时处理全文。
 *
 * 终点落在行首时退到上一行行尾，避免把下一行整行纳入处理范围。
 */
function resolveRange(editor: Editor): EditorRange {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const lastLine = Math.max(0, editor.lineCount() - 1);
  const hasSelection = from.line !== to.line || from.ch !== to.ch;

  if (!hasSelection) {
    return {
      start: { line: 0, ch: 0 },
      end: { line: lastLine, ch: editor.getLine(lastLine).length },
      prefix: "",
    };
  }

  const start = { line: from.line, ch: 0 };
  const prefix =
    start.line > 0 ? editor.getRange({ line: 0, ch: 0 }, { line: start.line, ch: 0 }) : "";

  if (to.ch === 0 && to.line > 0) {
    const previous = to.line - 1;
    return { start, end: { line: previous, ch: editor.getLine(previous).length }, prefix };
  }
  return { start, end: { line: to.line, ch: editor.getLine(to.line).length }, prefix };
}

/**
 * JSON 命令不把选区扩展到整行：选区原文按原样解析，
 * 否则 `- {"a":1}` 这类列表项会把列表符号一起喂给 JSON.parse。
 */
function resolveJsonRange(editor: Editor): {
  start: { line: number; ch: number };
  end: { line: number; ch: number };
  hasSelection: boolean;
} {
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  if (from.line !== to.line || from.ch !== to.ch) {
    return { start: from, end: to, hasSelection: true };
  }
  const lastLine = Math.max(0, editor.lineCount() - 1);
  return {
    start: { line: 0, ch: 0 },
    end: { line: lastLine, ch: editor.getLine(lastLine).length },
    hasSelection: false,
  };
}

function jsonErrorMessage(error: JsonError, hasSelection: boolean): string {
  const position =
    error.line !== undefined && error.column !== undefined
      ? `第 ${error.line} 行第 ${error.column} 列`
      : "位置未知";
  const snippet = error.snippet ? `：${error.snippet}` : "";
  const hint = hasSelection ? "" : "；若只想处理其中一段 JSON，请先选中它";
  return `JSON 语法错误（${position}${snippet}），已保持原样${hint}`;
}
