import { COMPACT_RULES } from "./compact";
import { FORMAT_RULES, computeListUnit } from "./rules";
import type { RuleContext } from "./rules";
import { analyzeLines } from "./segment";
import type { LineInfo } from "./segment";
import { InlineMasker, detectEol, joinLines, splitLines } from "./text";

export interface PipelineOptions {
  /** 规则 id → 是否启用 */
  enabled: Record<string, boolean>;
  codeBlockDefaultLang: string;
  /** 选区上方的文档内容（文档开头到选区首行行首），用于保护区预热 */
  prefix?: string;
  /** 整篇文档内容，用于列表缩进单位等全局统计；缺省时用待处理文本 */
  documentText?: string;
}

/** 需要看到「行内片段已还原」的真实字符的规则：表格宽度计算 */
const PLAIN_TEXT_RULES = new Set(["F10", "F11"]);

function isEnabled(options: PipelineOptions, id: string): boolean {
  return options.enabled[id] === true;
}

/** 把选区上方的文本切成行；末尾的空串是切分产生的，需丢弃 */
function warmupLines(prefix: string | undefined): string[] {
  if (!prefix) {
    return [];
  }
  const lines = splitLines(prefix);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function documentListUnit(options: PipelineOptions, text: string): number {
  const source = options.documentText ?? text;
  const lines = splitLines(source);
  return computeListUnit(lines, analyzeLines(lines));
}

/**
 * 构造分析器：把选区上方的行拼在待处理行前面再做保护区分析，最后切回待处理部分。
 *
 * 这是「选区预热」的实现——不预热就无法知道选区上方是否存在未闭合的围栏，
 * 会把代码内容当成正文改写。
 */
function createAnalyzer(warm: string[]): (lines: string[]) => LineInfo[] {
  if (warm.length === 0) {
    return (lines) => analyzeLines(lines);
  }
  return (lines) => analyzeLines(warm.concat(lines)).slice(warm.length);
}

function maskLines(lines: string[], infos: LineInfo[], masker: InlineMasker): string[] {
  return lines.map((line, index) => (infos[index].protected ? line : masker.mask(line)));
}

/**
 * 格式化：F1–F9 在行内保护态执行，F10–F11 在还原后执行。
 *
 * 每条规则执行前都重新分析：规则可能增删行，且分析必须带上选区上方的上下文。
 */
export function formatMarkdown(text: string, options: PipelineOptions): string {
  const eol = detectEol(text);
  let lines = splitLines(text);
  const analyze = createAnalyzer(warmupLines(options.prefix));
  const ctx: RuleContext = {
    codeBlockDefaultLang: options.codeBlockDefaultLang,
    listUnit: documentListUnit(options, text),
  };
  const masker = new InlineMasker();

  lines = maskLines(lines, analyze(lines), masker);

  for (const rule of FORMAT_RULES) {
    if (!isEnabled(options, rule.id) || PLAIN_TEXT_RULES.has(rule.id)) {
      continue;
    }
    lines = rule.apply(lines, analyze(lines), ctx);
  }

  lines = lines.map((line) => masker.restore(line));

  for (const rule of FORMAT_RULES) {
    if (!isEnabled(options, rule.id) || !PLAIN_TEXT_RULES.has(rule.id)) {
      continue;
    }
    lines = rule.apply(lines, analyze(lines), ctx);
  }

  return joinLines(lines, eol);
}

/** 简化：S1–S5 全部在行内保护态执行，结束后还原并保持原换行风格 */
export function simplifyMarkdown(text: string, options: PipelineOptions): string {
  const eol = detectEol(text);
  let lines = splitLines(text);
  const analyze = createAnalyzer(warmupLines(options.prefix));
  const masker = new InlineMasker();

  lines = maskLines(lines, analyze(lines), masker);

  for (const rule of COMPACT_RULES) {
    if (!isEnabled(options, rule.id)) {
      continue;
    }
    lines = rule.apply(lines, analyze(lines));
  }

  lines = lines.map((line) => masker.restore(line));
  return joinLines(lines, eol);
}
