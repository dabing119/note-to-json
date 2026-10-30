import type { LineInfo } from "./segment";
import { indentPrefix, indentWidth, isBlank, stripTrailing } from "./text";

export interface RuleContext {
  codeBlockDefaultLang: string;
  /** 文档级列表缩进单位（全文列表行的最小正缩进），0 表示无缩进列表 */
  listUnit: number;
}

export interface FormatRule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  apply(lines: string[], infos: LineInfo[], ctx: RuleContext): string[];
}

/** 由规则声明生成「规则 id → 是否启用」的默认映射 */
export function buildDefaultRuleMap(
  rules: { id: string; defaultEnabled: boolean }[]
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const rule of rules) {
    map[rule.id] = rule.defaultEnabled;
  }
  return map;
}

const F1: FormatRule = {
  id: "F1",
  name: "标题规范化",
  description: "标题 # 与文字之间只保留一个空格（# 后无空格视为 Obsidian 标签，不处理）",
  defaultEnabled: true,
  apply(lines, infos) {
    return lines.map((line, index) => {
      if (infos[index].protected) {
        return line;
      }
      // 仅在 # 后已有空白时压缩为一个空格；#{1,6} 后跟 # 不算标题
      const match = /^( {0,3})(#{1,6})(?!#)[ \t]+(.*)$/.exec(line);
      if (!match) {
        return line;
      }
      return `${match[1]}${match[2]} ${stripTrailing(match[3])}`;
    });
  },
};

const F2: FormatRule = {
  id: "F2",
  name: "行尾空白清理",
  description: "删除每行末尾的空格与制表符",
  defaultEnabled: true,
  apply(lines, infos) {
    return lines.map((line, index) => (infos[index].protected ? line : stripTrailing(line)));
  },
};

const F3: FormatRule = {
  id: "F3",
  name: "连续空行压缩",
  description: "连续多个空行压缩为一个空行",
  defaultEnabled: true,
  apply(lines, infos) {
    const out: string[] = [];
    let previousBlank = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const blank = !infos[index].protected && isBlank(line);
      if (blank) {
        if (previousBlank) {
          continue;
        }
        previousBlank = true;
        out.push("");
        continue;
      }
      previousBlank = false;
      out.push(line);
    }
    return out;
  },
};

const F4: FormatRule = {
  id: "F4",
  name: "无序列表符号统一",
  description: "把 * 与 + 开头的无序列表项统一为 -",
  defaultEnabled: true,
  apply(lines, infos) {
    return lines.map((line, index) => {
      if (infos[index].protected || THEMATIC_BREAK_RE.test(line)) {
        return line;
      }
      return line.replace(/^([ \t]*)([*+])([ \t]+)/, "$1-$3");
    });
  },
};

/** 标题行：# 后必须已有空格，避免把 Obsidian 标签（#tag）当标题 */
const HEADING_RE = /^( {0,3})(#{1,6}) /;

/** 列表项：可缩进前缀 + 标记 + 空白 */
const LIST_ITEM_RE = /^([ \t]*)([-*+]|\d+\.)([ \t]+)/;

const BLANK_INFO: LineInfo = { protected: false, kind: "text" };

/** 水平分隔线（* * *、_ _ _、- - -）：重写标记会把它变成列表，安全跳过 */
const THEMATIC_BREAK_RE = /^[ \t]*([*_-])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * 全文列表缩进单位：所有列表行前导宽度的最小值。
 * 必须用整篇文档计算，否则局部格式化时单位被放大，深层列表会被降级。
 */
export function computeListUnit(lines: string[], infos: LineInfo[]): number {
  let unit = 0;
  for (let index = 0; index < lines.length; index++) {
    if (infos[index].protected) {
      continue;
    }
    const match = LIST_ITEM_RE.exec(lines[index]);
    if (!match) {
      continue;
    }
    const width = indentWidth(match[1]);
    if (width > 0 && (unit === 0 || width < unit)) {
      unit = width;
    }
  }
  return unit;
}

const F5: FormatRule = {
  id: "F5",
  name: "强调符统一",
  description: "__粗体__ 与 _斜体_ 统一为 ** 与 *，不碰 URL、wikilink 与 snake_case",
  defaultEnabled: true,
  apply(lines, infos) {
    return lines.map((line, index) => {
      if (infos[index].protected || THEMATIC_BREAK_RE.test(line)) {
        return line;
      }
      const strong = line.replace(/(?<![\w])__([^_\n]+)__(?![\w])/g, "**$1**");
      return strong.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, "*$1*");
    });
  },
};

const F6: FormatRule = {
  id: "F6",
  name: "列表缩进统一",
  description: "列表缩进统一为每级 2 个空格",
  defaultEnabled: true,
  apply(lines, infos, ctx) {
    const unit = ctx.listUnit;
    if (unit <= 0) {
      return lines;
    }
    return lines.map((line, index) => {
      if (infos[index].protected) {
        return line;
      }
      const match = LIST_ITEM_RE.exec(line);
      if (!match) {
        return line;
      }
      const width = indentWidth(match[1]);
      if (width === 0) {
        return line;
      }
      const level = Math.max(1, Math.floor(width / unit));
      return " ".repeat(2 * level) + line.slice(match[1].length);
    });
  },
};

const F7: FormatRule = {
  id: "F7",
  name: "标题层级递进",
  description: "标题层级一次只能下降一级，跨级（# 直接跟 ###）会补齐中间层级",
  defaultEnabled: true,
  apply(lines, infos) {
    let previous = 0;
    return lines.map((line, index) => {
      if (infos[index].protected) {
        return line;
      }
      const match = HEADING_RE.exec(line);
      if (!match) {
        return line;
      }
      const current = match[2].length;
      if (previous > 0 && current > previous + 1) {
        const level = previous + 1;
        previous = level;
        return `${match[1]}${"#".repeat(level)}${line.slice(match[1].length + current)}`;
      }
      previous = current;
      return line;
    });
  },
};

const F8: FormatRule = {
  id: "F8",
  name: "标题前后空行",
  description: "标题上下各保留恰好一个空行（已有空行不重复插入）",
  defaultEnabled: true,
  apply(lines, infos) {
    const out = lines.slice();
    const flags = infos.slice();
    // 从末行往前遍历，插入/删除空行不会使未处理的标题下标偏移
    for (let index = out.length - 1; index >= 0; index--) {
      if (flags[index].protected || !HEADING_RE.test(out[index])) {
        continue;
      }

      // 后侧：非空则补一个空行；已有多个空行则只保留一个
      const next = index + 1;
      if (next < out.length) {
        if (!isBlank(out[next])) {
          out.splice(next, 0, "");
          flags.splice(next, 0, BLANK_INFO);
        } else {
          let end = next;
          while (end + 1 < out.length && isBlank(out[end + 1])) {
            end += 1;
          }
          if (end > next) {
            out.splice(next + 1, end - next);
            flags.splice(next + 1, end - next);
          }
        }
      }

      // 前侧：同理
      const previous = index - 1;
      if (previous >= 0) {
        if (!isBlank(out[previous])) {
          out.splice(index, 0, "");
          flags.splice(index, 0, BLANK_INFO);
        } else {
          let start = previous;
          while (start - 1 >= 0 && isBlank(out[start - 1])) {
            start -= 1;
          }
          if (start < previous) {
            out.splice(start, previous - start);
            flags.splice(start, previous - start);
          }
        }
      }
    }
    return out;
  },
};

interface TableBlock {
  start: number;
  end: number;
}

/** 识别表格块：连续 | 开头行、至少两行、第二行是分隔行 */
export function findTableBlocks(lines: string[], infos: LineInfo[]): TableBlock[] {
  const blocks: TableBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    if (!infos[index].protected && lines[index].trim().startsWith("|")) {
      let end = index;
      while (
        end + 1 < lines.length &&
        !infos[end + 1].protected &&
        lines[end + 1].trim().startsWith("|")
      ) {
        end += 1;
      }
      if (end > index && /^\|?[\s:-]+\|/.test((lines[index + 1] || "").trim())) {
        blocks.push({ start: index, end });
      }
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return blocks;
}

const F9: FormatRule = {
  id: "F9",
  name: "块级元素间隔",
  description: "代码块与表格前后各保留一个空行",
  defaultEnabled: true,
  apply(lines, infos) {
    const before = new Set<number>();
    const after = new Set<number>();
    for (let index = 0; index < lines.length; index++) {
      if (infos[index].kind === "fence-open") {
        before.add(index);
      }
      if (infos[index].kind === "fence-close") {
        after.add(index);
      }
    }
    for (const block of findTableBlocks(lines, infos)) {
      before.add(block.start);
      after.add(block.end);
    }

    const out = lines.slice();
    const positions = Array.from(new Set([...before, ...after])).sort((a, b) => b - a);
    for (const index of positions) {
      if (after.has(index) && index + 1 < out.length && !isBlank(out[index + 1])) {
        out.splice(index + 1, 0, "");
      }
      if (before.has(index) && index > 0 && !isBlank(out[index - 1])) {
        out.splice(index, 0, "");
      }
    }
    return out;
  },
};

/** 单元格显示宽度：\| 按 1 个字符计，CJK 按 1 个字符计 */
function cellWidth(cell: string): number {
  return Array.from(cell.replace(/\\\|/g, "|")).length;
}

/** 按未转义的竖线拆分单元格，\| 不参与切分 */
function splitUnescaped(text: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && text[index + 1] === "|") {
      current += "\\|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

interface ParsedRow {
  leading: string;
  cells: string[];
}

function parseRow(line: string): ParsedRow | null {
  const leading = indentPrefix(line);
  const body = line.slice(leading.length).replace(/[ \t]+$/, "");
  if (!body.startsWith("|")) {
    return null;
  }
  let inner = body.slice(1);
  if (inner.endsWith("|")) {
    inner = inner.slice(0, -1);
  }
  return { leading, cells: splitUnescaped(inner).map((cell) => cell.trim()) };
}

function formatRow(cells: string[], widths: number[], isDelimiter: boolean): string {
  const parts = widths.map((width, index) => {
    const raw = cells[index] ?? "";
    if (!isDelimiter) {
      return ` ${raw}${" ".repeat(Math.max(0, width - cellWidth(raw)))} `;
    }
    const hasLeft = raw.startsWith(":");
    const hasRight = raw.endsWith(":") && raw.length > 1;
    const dashes = Math.max(3, width - (hasLeft ? 1 : 0) - (hasRight ? 1 : 0));
    const separator = `${hasLeft ? ":" : ""}${"-".repeat(dashes)}${hasRight ? ":" : ""}`;
    return ` ${separator.padEnd(width)} `;
  });
  return `|${parts.join("|")}|`;
}

const F10: FormatRule = {
  id: "F10",
  name: "表格列对齐",
  description: "按列内最长单元格补齐表格竖线，保留 :--- 对齐标记",
  defaultEnabled: true,
  apply(lines, infos) {
    const blocks = findTableBlocks(lines, infos);
    if (blocks.length === 0) {
      return lines;
    }
    const out = lines.slice();
    for (const block of blocks) {
      const rows: ParsedRow[] = [];
      for (let index = block.start; index <= block.end; index++) {
        const parsed = parseRow(out[index]);
        if (!parsed) {
          rows.length = 0;
          break;
        }
        rows.push(parsed);
      }
      if (rows.length < 2) {
        continue;
      }
      let columnCount = 0;
      for (const row of rows) {
        columnCount = Math.max(columnCount, row.cells.length);
      }
      const widths: number[] = new Array(columnCount).fill(3);
      // 分隔行的冒号会额外占位，列宽必须包住「冒号 + 至少 3 个连字符」，否则竖线错位
      const delimiter = rows[1] ? rows[1].cells : [];
      for (let column = 0; column < columnCount; column++) {
        const raw = (delimiter[column] ?? "").trim();
        const colons =
          (raw.startsWith(":") ? 1 : 0) + (raw.endsWith(":") && raw.length > 1 ? 1 : 0);
        widths[column] = 3 + colons;
      }
      for (const row of rows) {
        for (let column = 0; column < columnCount; column++) {
          widths[column] = Math.max(widths[column], cellWidth(row.cells[column] ?? ""));
        }
      }
      for (let offset = 0; offset < rows.length; offset++) {
        const row = rows[offset];
        out[block.start + offset] = row.leading + formatRow(row.cells, widths, offset === 1);
      }
    }
    return out;
  },
};

const F11: FormatRule = {
  id: "F11",
  name: "补代码块语言",
  description: "围栏代码块未写语言时补上设置中的默认语言（默认关闭）",
  defaultEnabled: false,
  apply(lines, infos, ctx) {
    const lang = ctx.codeBlockDefaultLang.trim();
    if (lang === "") {
      return lines;
    }
    return lines.map((line, index) => {
      if (infos[index].kind !== "fence-open") {
        return line;
      }
      const match = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
      if (!match || match[3].trim() !== "") {
        return line;
      }
      return `${match[1]}${match[2]}${lang}`;
    });
  },
};

/** 顺序必须与规格一致：F1 → F11 */
export const FORMAT_RULES: FormatRule[] = [F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11];
