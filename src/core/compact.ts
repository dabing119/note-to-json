import type { LineInfo } from "./segment";
import { isBlank, stripTrailing } from "./text";

export interface CompactRule {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  apply(lines: string[], infos: LineInfo[]): string[];
}

const LIST_LINE_RE = /^\s*([-+*]|\d+\.)\s/;
const HEADING_RE = /^( {0,3})(#{1,6}) /;

const S1: CompactRule = {
  id: "S1",
  name: "行尾空白清理",
  description: "删除每行末尾的空格与制表符",
  defaultEnabled: true,
  apply(lines, infos) {
    return lines.map((line, index) => (infos[index].protected ? line : stripTrailing(line)));
  },
};

const S2: CompactRule = {
  id: "S2",
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

const S3: CompactRule = {
  id: "S3",
  name: "列表项之间空行删除",
  description: "同一列表块内相邻列表项之间的空行会被删除",
  defaultEnabled: true,
  apply(lines, infos) {
    const out: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const blank = !infos[index].protected && isBlank(line);
      if (blank) {
        let previous = out.length - 1;
        while (previous >= 0 && isBlank(out[previous])) {
          previous -= 1;
        }
        let next = index + 1;
        while (next < lines.length && !infos[next].protected && isBlank(lines[next])) {
          next += 1;
        }
        const previousIsItem = previous >= 0 && LIST_LINE_RE.test(out[previous]);
        const nextIsItem =
          next < lines.length && !infos[next].protected && LIST_LINE_RE.test(lines[next]);
        if (previousIsItem && nextIsItem) {
          continue;
        }
      }
      out.push(line);
    }
    return out;
  },
};

const S4: CompactRule = {
  id: "S4",
  name: "标题行后空行删除",
  description: "标题下一行若是空行则删除，标题与紧随内容贴紧",
  defaultEnabled: true,
  apply(lines, infos) {
    const out: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      out.push(lines[index]);
      if (infos[index].protected || !HEADING_RE.test(lines[index])) {
        continue;
      }
      while (index + 1 < lines.length && !infos[index + 1].protected && isBlank(lines[index + 1])) {
        index += 1;
      }
    }
    return out;
  },
};

const S5: CompactRule = {
  id: "S5",
  name: "文档首尾空行删除",
  description: "删除文档开头与结尾的空行",
  defaultEnabled: true,
  apply(lines, infos) {
    let start = 0;
    while (start < lines.length && !infos[start].protected && isBlank(lines[start])) {
      start += 1;
    }
    let end = lines.length - 1;
    while (end >= start && !infos[end].protected && isBlank(lines[end])) {
      end -= 1;
    }
    if (start === 0 && end === lines.length - 1) {
      return lines;
    }
    return lines.slice(start, end + 1);
  },
};

/** 顺序必须与规格一致：S1 → S5 */
export const COMPACT_RULES: CompactRule[] = [S1, S2, S3, S4, S5];
