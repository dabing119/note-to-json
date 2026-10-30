/** 行在保护区状态机中的分类 */
export type LineKind =
  | "text"
  | "frontmatter"
  | "fence-open"
  | "fence-body"
  | "fence-close"
  | "math"
  | "comment";

/** 占位符格式：\u0000<id>\u0000 */
const PLACEHOLDER_RE = /\u0000(\d+)\u0000/g;

/** 探测文本使用的换行风格，CRLF 文档必须原样写回 */
export function detectEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

export function joinLines(lines: string[], eol: string): string {
  return lines.join(eol);
}

export function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

/** 去掉行尾空格与制表符 */
export function stripTrailing(line: string): string {
  return line.replace(/[ \t]+$/, "");
}

/** 前导空白折算宽度：空格 = 1，制表符 = 4 */
export function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") {
      width += 1;
    } else if (ch === "\t") {
      width += 4;
    } else {
      break;
    }
  }
  return width;
}

/** 取行首的空白前缀 */
export function indentPrefix(line: string): string {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : "";
}

/**
 * 行内片段保护：把行内代码、wikilink、链接目标、裸 URL 替换为全局唯一占位符。
 *
 * 占位符 id 全局单调递增并与原片段双向映射，因此规则增删行之后还原不会错位。
 */
export class InlineMasker {
  private readonly store = new Map<number, string>();
  private nextId = 0;

  /** 返回被占位符替换后的行 */
  mask(line: string): string {
    let out = line;

    // 正文自带的 \u0000 先登记，避免与占位符格式混淆
    if (out.includes("\u0000")) {
      out = out.replace(/\u0000/g, () => this.push("\u0000"));
    }

    out = this.replace(out, /(?<!`)``([^`\n]+)``(?!`)/g); // 双反引号行内代码
    out = this.replace(out, /`([^`\n]+)`/g); // 单反引号行内代码
    out = this.replace(out, /!?\[\[[^\]\n]*\]\]/g); // wikilink 与嵌入
    out = this.replace(out, /\]\([^)\n]*\)/g); // 链接与图片目标
    out = this.replace(out, /https?:\/\/[^\s)>\]]+/g); // 裸 URL
    return out;
  }

  restore(line: string): string {
    let out = line;
    for (let guard = 0; guard < 16 && out.includes("\u0000"); guard++) {
      const next = out.replace(PLACEHOLDER_RE, (match, idText: string) => {
        const raw = this.store.get(Number(idText));
        return raw === undefined ? match : raw;
      });
      if (next === out) {
        break;
      }
      out = next;
    }
    return out;
  }

  restoreAll(text: string): string {
    return this.restore(text);
  }

  restoreLines(lines: string[]): string[] {
    return lines.map((line) => this.restore(line));
  }

  private replace(input: string, pattern: RegExp): string {
    return input.replace(pattern, (match) => this.push(match));
  }

  private push(raw: string): string {
    const id = this.nextId;
    this.nextId += 1;
    this.store.set(id, raw);
    return `\u0000${id}\u0000`;
  }
}
