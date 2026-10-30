import type { LineKind } from "./text";

export interface LineInfo {
  protected: boolean;
  kind: LineKind;
}

/** 围栏起始行：最多 3 个空格缩进 + 3 个以上反引号或波浪号 + 可选信息串 */
const FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

interface FenceState {
  char: string;
  length: number;
}

function isFenceClose(line: string, fence: FenceState): boolean {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*$/.exec(line);
  if (!match) {
    return false;
  }
  const marker = match[2];
  return marker[0] === fence.char && marker.length >= fence.length;
}

/**
 * 标记每行是否处于保护区（frontmatter / 围栏代码块 / $$ 块 / HTML 注释块）。
 *
 * 始终从索引 0 开始扫描整篇文档：选区处理也必须走这里，否则选区内无法得知
 * 它上方是否存在未闭合的围栏，会把代码内容当成正文改写。
 */
export function analyzeLines(lines: string[]): LineInfo[] {
  const infos: LineInfo[] = lines.map(() => ({ protected: false, kind: "text" as LineKind }));
  const total = lines.length;
  let index = 0;

  // frontmatter：仅当首行是 --- 且能在后续行找到闭合行
  if (total > 0 && lines[0].trim() === "---") {
    let end = -1;
    for (let i = 1; i < total; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "---" || trimmed === "...") {
        end = i;
        break;
      }
    }
    if (end !== -1) {
      for (let i = 0; i <= end; i++) {
        infos[i] = { protected: true, kind: "frontmatter" };
      }
      index = end + 1;
    }
  }

  let fence: FenceState | null = null;
  let inMath = false;
  let inComment = false;

  for (; index < total; index++) {
    const line = lines[index];

    if (fence) {
      if (isFenceClose(line, fence)) {
        infos[index] = { protected: true, kind: "fence-close" };
        fence = null;
      } else {
        infos[index] = { protected: true, kind: "fence-body" };
      }
      continue;
    }

    if (inMath) {
      infos[index] = { protected: true, kind: "math" };
      if (line.trim() === "$$") {
        inMath = false;
      }
      continue;
    }

    if (inComment) {
      infos[index] = { protected: true, kind: "comment" };
      if (line.includes("-->")) {
        inComment = false;
      }
      continue;
    }

    const open = FENCE_OPEN_RE.exec(line);
    if (open) {
      fence = { char: open[2][0], length: open[2].length };
      infos[index] = { protected: true, kind: "fence-open" };
      continue;
    }

    if (line.trim() === "$$") {
      infos[index] = { protected: true, kind: "math" };
      inMath = true;
      continue;
    }

    const commentStart = line.indexOf("<!--");
    if (commentStart !== -1 && line.indexOf("-->", commentStart) === -1) {
      infos[index] = { protected: true, kind: "comment" };
      inComment = true;
      continue;
    }

    infos[index] = { protected: false, kind: "text" };
  }

  // 未闭合的围栏 / 注释 / 数学块：其后的行已在循环里持续标记为 protected，保持保守不动
  return infos;
}
