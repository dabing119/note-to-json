import { detectEol } from "./text";

/** JSON 缩进宽度固定 2 空格 */
const JSON_INDENT = "  ";

/** 给用户看的解析失败信息 */
export interface JsonError {
  /** 引擎给出的原始报错 */
  raw: string;
  /** 出错位置，1 基；部分 V8 版本不提供位置时缺省 */
  line?: number;
  column?: number;
  /** 出错位置附近的原文片段 */
  snippet?: string;
}

export type JsonResult =
  | { ok: true; text: string; fixedWhitespace: number }
  | { ok: false; error: JsonError };

type TokenKind = "open" | "close" | "comma" | "colon" | "value";

interface Token {
  kind: TokenKind;
  text: string;
}

/**
 * 美化 JSON：2 空格缩进、每个成员一行。
 *
 * 只重排空白，所有字面量（数字、字符串、转义）按原文输出，
 * 因此大整数不会丢精度、`1e21` 与 `\/` 也不会被改写。
 */
export function formatJson(source: string): JsonResult {
  const cleaned = normalizeStructuralWhitespace(source);
  const failure = validate(cleaned.text);
  if (failure) {
    return { ok: false, error: failure };
  }
  const formatted = buildFormatted(tokenize(cleaned.text));
  const eol = detectEol(source);
  return {
    ok: true,
    text: eol === "\n" ? formatted : formatted.replace(/\n/g, eol),
    fixedWhitespace: cleaned.fixed,
  };
}

/** 压缩 JSON：删除所有 token 之间的空白，输出单行 */
export function compressJson(source: string): JsonResult {
  const cleaned = normalizeStructuralWhitespace(source);
  const failure = validate(cleaned.text);
  if (failure) {
    return { ok: false, error: failure };
  }
  const tokens = tokenize(cleaned.text);
  return {
    ok: true,
    text: tokens.map((token) => token.text).join(""),
    fixedWhitespace: cleaned.fixed,
  };
}

/** JSON 只认半角空格、Tab、LF、CR；字符串之外的其它空白字符会被归一化 */
const UNICODE_SPACES = new Set([
  "\u00a0",
  "\u1680",
  "\u2000",
  "\u2001",
  "\u2002",
  "\u2003",
  "\u2004",
  "\u2005",
  "\u2006",
  "\u2007",
  "\u2008",
  "\u2009",
  "\u200a",
  "\u2028",
  "\u2029",
  "\u202f",
  "\u205f",
  "\u3000",
]);

const ZERO_WIDTH_CHARS = new Set(["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"]);

/**
 * 把字符串字面量之外的非常规空白归一化为半角空格，零宽字符直接删除。
 *
 * 从网页、聊天工具复制来的 JSON 常在缩进里混入全角空格（U+3000）或不换行空格（U+00A0），
 * 这会让 JSON.parse 报 "Unexpected token"，但片段看起来完全正常。
 * 字符串内部一个字符都不改，因此数据值不受影响。
 */
function normalizeStructuralWhitespace(source: string): { text: string; fixed: number } {
  let text = "";
  let fixed = 0;
  let inString = false;
  let escaped = false;

  for (const char of source) {
    if (inString) {
      text += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      text += char;
      continue;
    }

    if (ZERO_WIDTH_CHARS.has(char)) {
      fixed += 1;
      continue;
    }

    if (UNICODE_SPACES.has(char)) {
      fixed += 1;
      text += " ";
      continue;
    }

    text += char;
  }

  return { text, fixed };
}

/** 返回 null 表示合法；JSON.parse 只用来判定合法性，返回值丢弃以免影响字面量保真 */
function validate(source: string): JsonError | null {
  try {
    JSON.parse(source);
    return null;
  } catch (error) {
    return describeParseError(source, error);
  }
}

function describeParseError(source: string, error: unknown): JsonError {
  const raw = error instanceof Error && error.message ? error.message : String(error);

  // 新版 V8 形如 `... in JSON at position 12 (line 2 column 3)`
  const located = /\(line (\d+) column (\d+)\)/.exec(raw);
  if (located) {
    const line = Number(located[1]);
    const column = Number(located[2]);
    return { raw, line, column, snippet: snippetAt(source, line, column) };
  }

  // 旧版 V8 只给偏移量
  const offset = /position (\d+)/.exec(raw);
  if (offset) {
    const index = Math.min(Number(offset[1]), Math.max(0, source.length - 1));
    const position = offsetToPosition(source, index);
    return { raw, ...position, snippet: snippetAt(source, position.line, position.column) };
  }

  return { raw };
}

function offsetToPosition(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function snippetAt(source: string, line: number, column: number): string | undefined {
  const target = source.split(/\r?\n/)[line - 1];
  if (target === undefined) {
    return undefined;
  }
  const from = Math.max(0, column - 20);
  const to = Math.min(target.length, column + 20);
  // 不可见字符必须可视化，否则报错片段看起来完全正常，用户无从判断
  const snippet = visualizeInvisible(target.slice(from, to).trim());
  return snippet.length > 0 ? snippet : undefined;
}

const INVISIBLE_RE =
  /[\u0000-\u001f\u007f\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u3000\ufeff]/g;

function visualizeInvisible(text: string): string {
  return text.replace(INVISIBLE_RE, (char) => {
    const code = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
    return `⟨U+${code}⟩`;
  });
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (isWhitespace(char)) {
      index += 1;
      continue;
    }

    if (char === "{" || char === "[") {
      tokens.push({ kind: "open", text: char });
      index += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      tokens.push({ kind: "close", text: char });
      index += 1;
      continue;
    }

    if (char === ",") {
      tokens.push({ kind: "comma", text: char });
      index += 1;
      continue;
    }

    if (char === ":") {
      tokens.push({ kind: "colon", text: char });
      index += 1;
      continue;
    }

    if (char === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        const current = source[index];
        if (current === "\\") {
          index += 2;
          continue;
        }
        index += 1;
        if (current === '"') {
          break;
        }
      }
      tokens.push({ kind: "value", text: source.slice(start, index) });
      continue;
    }

    // 数字与 true / false / null：读到下一个分隔符为止
    const start = index;
    while (index < source.length && !isDelimiter(source[index])) {
      index += 1;
    }
    tokens.push({ kind: "value", text: source.slice(start, index) });
  }

  return tokens;
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function isDelimiter(char: string): boolean {
  return isWhitespace(char) || char === "{" || char === "}" || char === "[" || char === "]" || char === "," || char === ":" || char === '"';
}

function buildFormatted(tokens: Token[]): string {
  const parts: string[] = [];
  const stack: string[] = [];
  const indent = () => JSON_INDENT.repeat(stack.length);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const previous = i > 0 ? tokens[i - 1] : undefined;

    switch (token.kind) {
      case "open": {
        stack.push(token.text);
        parts.push(token.text);
        // 空容器 `{}` / `[]` 保持在一行
        if (tokens[i + 1]?.kind !== "close") {
          parts.push("\n", indent());
        }
        break;
      }
      case "close": {
        stack.pop();
        if (previous?.kind !== "open") {
          parts.push("\n", indent());
        }
        parts.push(token.text);
        break;
      }
      case "comma": {
        parts.push(",", "\n", indent());
        break;
      }
      case "colon": {
        parts.push(": ");
        break;
      }
      default: {
        parts.push(token.text);
      }
    }
  }

  return parts.join("");
}
