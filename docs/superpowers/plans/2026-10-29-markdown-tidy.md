# Note to JSON 实现计划

> 文档与规格文件名沿用历史命名 `2026-10-29-markdown-tidy*`；正文中的插件标识已统一为 `note-to-json` / `Note to JSON`。

> **面向 AI 代理的工作者：** 必需子技能：使用 executing-plans 逐任务实现此计划（本项目不使用子代理审查流程）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 构建一个 Obsidian 插件，提供「格式化」与「简化」两条命令，纯本地规范化 Markdown 排版，快捷键可在 Obsidian 原生设置中自定义。

**架构：** TypeScript + esbuild 打包成单个 `main.js`。核心是「保护区分析（`analyzeLines`）→ 行内占位符保护 → 声明式规则数组逐条管线执行 → `editor.transaction` 单次写回」四段式，规则与 UI 解耦，设置页由规则元数据自动渲染。

**技术栈：** TypeScript（strict，target ES2018）、esbuild、Obsidian Plugin API（`obsidian` 仅作 devDependency，构建时 external）。

**规格：** [docs/superpowers/specs/2026-10-29-markdown-tidy-design.md](../specs/2026-10-29-markdown-tidy-design.md)

## 全局约束

- `minAppVersion` = `1.4.0`；插件 id = `note-to-json`；显示名 = `Note to JSON`。
- 运行时零依赖、零网络请求；`obsidian` 必须留在 `devDependencies`。
- 所有规则只改空白与标记符，**不改变正文语义**；frontmatter / 围栏代码块 / `$$` 块 / HTML 注释块整行跳过。
- 按用户要求：**不编写任何自动化测试文件、不写测试计划、不执行任何 git 操作**（不 commit、不建 worktree）。
- 验证口径：`npm run build` 零错误 + 每个任务末尾的检查点 + 任务 9 的 vault 手工验收。
- UI 文案中文；命令行名固定为 `Note to JSON: 格式化` / `Note to JSON: 简化`。
- 文件读写一律保留原换行风格（CRLF 文档必须仍是 CRLF）。

## 审查重点（Review Focus）

以下是规格隐含、但最容易被实现疏忽而伤到用户的输入，每个任务实现时必须显式处理，并在对应任务的检查点核对：

1. **CRLF 文档**：必须先用 `detectEol` 记录换行风格再 `splitLines`，写回时用同一风格 `joinLines`，否则整篇文件每一行都会变成 diff。
2. **选区起点位于代码块内部**：`analyzeLines` 必须从数组索引 0 开始扫描到文档末尾，禁止只分析选区片段，否则会把代码内容当标题改写。
3. **未闭合 / 长度不等的围栏**：```` ```` ```` 开的块只能被长度 ≥ 4 的反引号闭合，`~~~` 与反引号互不闭合；未闭合时必须把后续内容当作代码（保守不动），不能当正文格式化。
4. **表格单元格内含行内代码、`\|` 转义、含宽字符**：对齐阶段必须在「占位符已还原」的纯文本上计算宽度（见任务 7 的相位设计），且拆分单元格时 `\|` 不参与切分。
5. **空文档、仅 frontmatter 的文档、纯空白文档**：处理结果与原文相同即不写回，只按 `showNotice` 提示，绝不能插入内容或抛异常。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 插件元数据（id / name / version / minAppVersion） |
| `versions.json` | 版本兼容表 |
| `tsconfig.json` | TS 编译配置（strict，仅类型检查，不产出） |
| `esbuild.config.mjs` | 打包脚本（bundle → `main.js`，external obsidian） |
| `package.json` | 改 `main`、`scripts`，`obsidian` 移到 devDependencies |
| `src/main.ts` | 插件入口：命令注册、默认热键、设置装载、选区计算、事务写回、光标恢复 |
| `src/settings.ts` | `TidySettings` 类型、`DEFAULT_SETTINGS` 生成 |
| `src/settingsTab.ts` | 设置面板（规则开关自动渲染 + 语言输入 + 提示开关 + 快捷键跳转） |
| `src/core/text.ts` | 行切分/合并、换行风格、缩进宽度、行内占位符保护与还原 |
| `src/core/segment.ts` | 保护区状态机 `analyzeLines` |
| `src/core/rules.ts` | 格式化规则 F1–F11（声明式 `FORMAT_RULES`） |
| `src/core/compact.ts` | 简化规则 S1–S5（声明式 `COMPACT_RULES`） |
| `src/core/pipeline.ts` | `formatMarkdown` / `simplifyMarkdown` 组装与相位编排 |

任务依赖顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9（严格串行，后面的任务引用前面任务的导出）。

---

### 任务 1：工程骨架与最小可加载插件

**文件：**
- 创建：`manifest.json`、`versions.json`、`tsconfig.json`、`esbuild.config.mjs`、`src/main.ts`
- 修改：`package.json`

- [ ] **步骤 1：写 `manifest.json`**

```json
{
  "id": "note-to-json",
  "name": "Note to JSON",
  "version": "0.0.5",
  "minAppVersion": "1.4.0",
  "description": "格式化与简化 Markdown 排版，纯本地、零网络请求。",
  "author": "",
  "authorUrl": "",
  "isDesktopOnly": false
}
```

- [ ] **步骤 2：写 `versions.json`**

```json
{
  "0.0.5": "1.4.0"
}
```

- [ ] **步骤 3：写 `tsconfig.json`**

`target: ES2018`、`module: ESNext`、`moduleResolution: node`、`lib: ["DOM","ES2018"]`、`strict: true`、`noImplicitAny: true`、`isolatedModules: true`、`noEmit: true`、`skipLibCheck: true`、`include: ["src/**/*.ts"]`。

- [ ] **步骤 4：写 `esbuild.config.mjs`**

```js
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); process.exit(0); }
await ctx.watch();
```

- [ ] **步骤 5：改 `package.json`**

`main` 改为 `"main.js"`；`scripts` 改为 `{ "dev": "node esbuild.config.mjs", "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production" }`；把 `obsidian` 从 `dependencies` 移到 `devDependencies`（版本保持 `^1.14.4`）。

- [ ] **步骤 6：写最小 `src/main.ts`**

`export default class MarkdownTidyPlugin extends Plugin {}`（`import { Plugin } from "obsidian"`），`onload` 内暂为空。

- [ ] **步骤 7：构建验证**

运行：`npm run build`
预期：`tsc` 无错误，产出 `main.js`（> 0 字节）。

- [ ] **步骤 8：检查点**

- `main.js` 中不包含 `require("obsidian")` 以外被内联的 obsidian 源码（`obsidian` 为 external）。
- 临时把 `manifest.json` + `main.js` 拷进 `<vault>/.obsidian/plugins/note-to-json/`，Obsidian 能列出并启用该插件且控制台无报错（验证完可移出）。

---

### 任务 2：`src/core/text.ts`（行工具与行内占位符）

**文件：**
- 创建：`src/core/text.ts`

- [ ] **步骤 1：实现以下导出（签名固定）**

```ts
export type LineKind = "text" | "frontmatter" | "fence-open" | "fence-body" | "fence-close" | "math" | "comment";

export function detectEol(text: string): string;              // 含 "\r\n" → "\r\n"，否则 "\n"
export function splitLines(text: string): string[];           // 按 /\r?\n/ 切分，不保留 \n
export function joinLines(lines: string[], eol: string): string; // lines.join(eol)
export function isBlank(line: string): boolean;               // /^[ \t]*$/
export function stripTrailing(line: string): string;          // 去掉行尾空格与制表符
export function indentWidth(line: string): number;            // 空格=1、tab=4 折算

export class InlineMasker {
  mask(line: string): string;      // 返回替换为占位符的行
  restore(line: string): string;   // 还原单行
  restoreAll(text: string): string;
}
```

**为什么用类而不是「每行一个数组」**：占位符 id 必须全局唯一且与原片段双向映射，否则 F8/F9 插入空行、F3 删除空行后，行与 store 的下标关系会错位，还原阶段会把代码片段贴到别的行上。

- [ ] **步骤 2：`InlineMasker.mask` 的匹配范围与顺序（固定）**

按以下顺序用 `\u0000<全局自增 id>\u0000` 逐个替换，`Map<number, string>` 保存原片段：

1. 双反引号行内代码：`` ``...`` ``
2. 单反引号行内代码：`` `...` ``（不跨行）
3. wikilink 与嵌入：`!?\[\[[^\]\n]*\]\]`
4. markdown 链接/图片目标：`\]\([^)\n]*\)`
5. 裸 URL：`https?:\/\/[^\s)>\]]+`

- [ ] **步骤 3：`InlineMasker.restore` / `restoreAll`**

用 `/\u0000(\d+)\u0000/g` 全局循环替换回 `map.get(id)`（**循环替换直到无占位符**，因为原片段可能自身含占位符形态）。

- [ ] **步骤 4：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 5：检查点（用一次性 `node -e` 手测，不落盘为测试文件）**

- `detectEol("a\r\nb") === "\r\n"`，`splitLines("a\r\nb")` 长度为 2 且元素为 `["a","b"]`。
- `masker.mask("`code` 和 [[wikilink]]")` 的结果不含反引号与 `[[`，`restore` 后与原始字符串完全相等。
- 无占位符的行 `mask` 结果与原行相同；两行分别 mask 后再 `restoreAll(两行拼接)`，两行内容各自正确还原（验证 id 全局唯一）。

---

### 任务 3：`src/core/segment.ts`（保护区分析）

**文件：**
- 创建：`src/core/segment.ts`

- [ ] **步骤 1：实现导出（签名固定）**

```ts
import type { LineKind } from "./text";

export interface LineInfo { protected: boolean; kind: LineKind }
export function analyzeLines(lines: string[]): LineInfo[]; // 长度与 lines 一致
```

- [ ] **步骤 2：状态机规则（按此实现）**

- frontmatter：仅当 `lines[0].trim() === "---"` 时启动，直到下一个 `trim()` 为 `---` 或 `...` 的行（含首尾边界行），全部 `protected: true, kind: "frontmatter"`。
- 围栏：非保护态下匹配 `/^( {0,3})(`{3,}|~{3,})(.*)$/`；记录字符与长度；起始行 `kind: "fence-open"`，其后各行 `"fence-body"`，直到同字符且长度 ≥ 起始长度的行（其后仅允许空白）记为 `"fence-close"`。
- `$$` 块：非保护态下 `trim() === "$$"` 开启，直到下一个 `trim() === "$$"`，`kind: "math"`。`$$x$$` 单行内联不开启。
- HTML 注释：非保护态下出现 `<!--` 且同行无 `-->` 时开启，直到含 `-->` 的行，`kind: "comment"`。
- 未闭合的围栏/注释一律延续到文档末尾，全部 `protected: true`（保守不动）。
- 所有 `protected: true` 的行 `kind` 不为 `"text"`；普通正文行为 `{ protected: false, kind: "text" }`。

- [ ] **步骤 3：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 4：检查点（一次性 `node -e` 手测）**

- 文档首行 `---` 的 frontmatter 块全部 `protected === true`。
- ` ``` ` 开、` ```` ` 闭不成立（`` ``` `` 起始的块应被下一行 ` ``` ` 闭合，而 ` ```` ` 起始的块不被 ` ``` ` 关闭）。
- 未闭合的 ` ``` ` 之后的所有行 `protected === true`。
- 代码块内出现的 `# 标题` 行 `protected === true`。

---

### 任务 4：`src/core/rules.ts` 的 F1–F4

**文件：**
- 创建：`src/core/rules.ts`

- [ ] **步骤 1：定义规则契约（签名固定）**

```ts
export interface RuleContext { codeBlockDefaultLang: string }
export interface FormatRule {
  id: string;                 // "F1"
  name: string;               // 中文名，用于设置页
  description: string;        // 一行中文说明
  defaultEnabled: boolean;
  apply(lines: string[], infos: LineInfo[], ctx: RuleContext): string[];
}
export const FORMAT_RULES: FormatRule[];  // 顺序必须是 F1→F11
export function buildDefaultRuleMap(rules: { id: string; defaultEnabled: boolean }[]): Record<string, boolean>;
```

- [ ] **步骤 2：实现 F1 标题规范化**

仅处理 `infos[i].protected === false` 的行；匹配 `/^( {0,3})(#{1,6})([ \t]*)(.*)$/`，输出 `前缀 + 井号 + " " + 标题文本（stripTrailing 后）`；`#` 数超过 6 的不处理；`#######` 非标题。

- [ ] **步骤 3：实现 F2 行尾空白**

所有非 protected 行 `stripTrailing`；空行也处理（变成真正的空串）。

- [ ] **步骤 4：实现 F3 连续空行压缩**

相邻连续空行（非 protected）只保留 1 行；遇到 protected 行即中断当前连段。

- [ ] **步骤 5：实现 F4 无序列表符号统一**

匹配 `/^(\s*)([*+])(\s+)/` → 替换为 `$1- $3`；`-` 不动；`*text*`（`*` 后无空白）不匹配。

- [ ] **步骤 6：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 7：检查点**

- `#标题` → `# 标题`；`##   标题  ` → `## 标题`。
- 3 个连续空行 → 1 个。
- `* 项`、`+ 项`、`* [ ] 任务` → `- 项`、`- 项`、`- [ ] 任务`。

---

### 任务 5：`src/core/rules.ts` 追加 F5–F9

**文件：**
- 修改：`src/core/rules.ts`（在 `FORMAT_RULES` 中按序追加）

- [ ] **步骤 1：F5 强调符统一**

在已 `protectInline` 的行上执行：`__x__` → `**x**`、`_x_` → `*x*`。要求前后为词边界，正则用 `(?<![\w])__([^_\n]+)__(?![\w])` 与 `(?<![\w])_([^_\n]+)_(?![\w])`，内容允许包含 `\u0000` 占位符。`snake_case` 不动。

- [ ] **步骤 2：F6 列表缩进统一为 2 空格/级**

仅处理匹配 `/^([ \t]*)([-*+]|\d+\.)(\s+)/` 的非 protected 行。先扫描全文同类行的 `indentWidth`，取**最小正值**为 `U`（全篇无列表行则本规则直接返回原数组）；每行 `level = Math.floor(indentWidth(prefix) / U)`，新前缀 `" ".repeat(2 * level)`。

- [ ] **步骤 3：F7 标题层级递进**

匹配 `/^( {0,3})(#{1,6}) /` 的非 protected 行；`prev` 初始 0，首个别保护标题不做抬升；若 `cur > prev + 1` 则输出 `prev + 1` 个 `#`，并以新值更新 `prev`。

- [ ] **步骤 4：F8 标题前后空行（幂等）**

对每个标题行：确保其前一行是空行（文档首行除外）、后一行是空行（文档末行除外）。实现为辅助函数 `ensureSingleBlankBefore/After(lines, infos, index)`：若相邻行已是空行就**不插入**，若插入了需对 `infos` 同步插入 `{ protected: false, kind: "text" }` 以保持下标对齐。相邻标题之间只保留 1 个空行。

**遍历方向固定为从末行往前**（`for (let i = lines.length - 1; i >= 0; i--)`），这样插入空行不会使尚未处理的标题下标偏移。`apply` 仍只返回 `string[]`，`infos` 由 `pipeline` 在下一规则前重算。

- [ ] **步骤 5：F9 块级元素间隔（幂等）**

对 `infos[i].kind === "fence-open"` 与表格块首行：确保前一行空行；对 `kind === "fence-close"` 与表格块末行：确保后一行空行。同样用幂等辅助函数。表格块识别：自非 protected 行起，连续行 `trim()` 以 `|` 开头且至少 2 行、第 2 行匹配 `/^\|?[\s:-]+\|/`。

- [ ] **步骤 6：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 7：检查点**

- `__粗__` → `**粗**`、`_斜_` → `*斜*`、`snake_case_name` 不变。
- 4 空格缩进的二级列表 → 2 空格，且整篇幂等（连跑两次结果一致）。
- `# A` 后紧跟 `### B` → `## B`。
- 标题紧贴正文时上下各出现且仅出现 1 个空行；连跑两次结果不变。

---

### 任务 6：F10–F11 与 `src/core/compact.ts`

**文件：**
- 修改：`src/core/rules.ts`（追加 F10、F11）
- 创建：`src/core/compact.ts`

- [ ] **步骤 1：F10 表格列对齐**

仅在**占位符已还原**的纯文本上执行（由任务 7 的相位保证）。对每个表格块：

1. 去掉行首缩进与首尾 `|`，按未转义的 `|`（即 `\|` 不切）拆分单元格并 `trim`。
2. 列宽 = 各列所有单元格的**码点数**（`Array.from(cell).length`）最大值，CJK 按 1 计（已知局限，不做双宽）。
3. 输出 `| ` + `cell.padEnd(width)` + ` |` 连接。
4. 分隔行：保留原有的 `:` 对齐标记，连字符数 = `max(3, width)`。
5. 只处理行首为可选空格 + `|` 的表格（不支持引用块内表格）。

- [ ] **步骤 2：F11 补代码块语言**

遍历 `kind === "fence-open"` 的行，取其标记后的信息串；若信息串 `trim()` 为空且 `ctx.codeBlockDefaultLang` 非空，则在标记后补 `ctx.codeBlockDefaultLang`（保留原缩进与标记字符）。`defaultEnabled: false`。

- [ ] **步骤 3：`src/core/compact.ts` 定义简化规则契约与 S1–S5**

```ts
export interface CompactRule {
  id: string;                 // "S1"
  name: string;
  description: string;
  defaultEnabled: boolean;
  apply(lines: string[], infos: LineInfo[]): string[];
}
export const COMPACT_RULES: CompactRule[];
```

- S1：非 protected 行 `stripTrailing`。
- S2：连续空行压缩为 1（与 F3 同算法）。
- S3：删除列表项之间的空行——空行上下最近的非空行同时匹配 `/^\s*([-+*]|\d+\.)\s/` 时删除该空行。
- S4：标题行之后若是空行则删除（连续删到非空或文件末尾），标题行由 `/^( {0,3})(#{1,6}) /` 判定。
- S5：删除文档首部与尾部的所有空行（保护区行不计入首尾）。

- [ ] **步骤 4：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 5：检查点**

- 未对齐表格格式化后各列 `|` 垂直对齐；含 `` `code` `` 与 `a\|b` 的单元格内容不被改动。
- 纯空格分隔的表格行不被误识别为表格。
- 简化后段落之间的单个空行仍在，列表项之间空行被删，标题后无空行，文件首尾无空行。

---

### 任务 7：`src/core/pipeline.ts`（组装与相位编排）

**文件：**
- 创建：`src/core/pipeline.ts`

- [ ] **步骤 1：实现导出（签名固定）**

```ts
export interface PipelineOptions {
  enabled: Record<string, boolean>;  // 规则 id → 是否启用
  codeBlockDefaultLang: string;
}
export function formatMarkdown(text: string, options: PipelineOptions): string;
export function simplifyMarkdown(text: string, options: PipelineOptions): string;
```

- [ ] **步骤 2：`formatMarkdown` 相位编排（按此实现）**

1. `const eol = detectEol(text); let lines = splitLines(text);`
2. 相位 A（行内保护开启）：创建**一个** `InlineMasker` 实例，对非 protected 行逐行 `mask`；然后按 `FORMAT_RULES` 顺序执行 F1–F9：**每条规则前重新 `analyzeLines(lines)`**（规则可能增删行，必须重算，且同时满足「从文档首行预热」），只执行 `options.enabled[rule.id] === true` 的规则。
3. 相位 B（保护还原后）：先对每行 `masker.restore`，再执行 F10、F11（同样每条前重新分析）。
4. `return joinLines(lines, eol);`

- [ ] **步骤 3：`simplifyMarkdown` 相位编排**

同上，但只按 `COMPACT_RULES` 顺序执行 S1–S5，全部在相位 A（保护态）内完成，结束时 `masker.restore` 全部行并 `joinLines(lines, eol)`。

- [ ] **步骤 4：构建验证**

运行：`npm run build`，预期零错误。

- [ ] **步骤 5：检查点**

- `formatMarkdown` 对同一文本连跑两次结果完全一致（幂等）。
- 关闭 `F4` 后 `* 项` 保持原样，其余规则照常生效。
- CRLF 输入输出的 `\r\n` 数量与输入一致。
- frontmatter、围栏代码块、`$$` 块、HTML 注释块内容逐字节不变。

---

### 任务 8：插件集成（设置、命令、写回、快捷键）

**文件：**
- 创建：`src/settings.ts`、`src/settingsTab.ts`
- 修改：`src/main.ts`

- [ ] **步骤 1：`src/settings.ts`**

```ts
export interface TidySettings {
  formatRules: Record<string, boolean>;
  simplifyRules: Record<string, boolean>;
  codeBlockDefaultLang: string;
  showNotice: boolean;
}
export const DEFAULT_SETTINGS: TidySettings;   // 规则开关由 buildDefaultRuleMap 生成（F11 默认 false，S1-S5 默认 true）
```

- [ ] **步骤 2：`src/main.ts` 命令注册与默认热键**

```ts
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
```

- [ ] **步骤 3：选区→整行区间换算（固定实现）**

```ts
const from = editor.getCursor("from");
const to = editor.getCursor("to");
const lastLine = editor.lineCount() - 1;
const hasSelection = from.line !== to.line || from.ch !== to.ch;
const start = hasSelection ? { line: from.line, ch: 0 } : { line: 0, ch: 0 };
const end = hasSelection
  ? (to.ch === 0 && to.line > 0
      ? { line: to.line - 1, ch: editor.getLine(to.line - 1).length }
      : { line: to.line, ch: editor.getLine(to.line).length })
  : { line: lastLine, ch: editor.getLine(lastLine).length };
```

- [ ] **步骤 4：`run(editor, mode)` 主流程（固定顺序）**

1. `const text = editor.getRange(start, end);`
2. `text.length > 2 * 1024 * 1024` → `new Notice("文件过大，已跳过")` 并返回。
3. `try { const out = mode === "format" ? formatMarkdown(text, opts) : simplifyMarkdown(text, opts); } catch (e) { console.error(e); new Notice("格式化失败，详见控制台"); return; }`（异常绝不写回）。
4. `out === text` → 若 `settings.showNotice` 则 `new Notice("已是规范格式")`，返回。
5. 写回：`editor.transaction({ changes: [{ from: start, to: end, text: out }] })`。
6. 光标恢复：按原光标行相对 `start.line` 的偏移，在新文本中重算并 `editor.setCursor`，若新行数更少则 clamp 到末行。
7. 若 `settings.showNotice`：`new Notice(mode === "format" ? "已格式化" : "已简化")`。

- [ ] **步骤 5：`src/settingsTab.ts`**

`class TidySettingTab extends PluginSettingTab`，`display()` 中：

1. 「格式化规则」小节：遍历 `FORMAT_RULES`，每个规则一个 `Setting`（`setName(rule.name)`、`setDesc(rule.description)`、`addToggle` 绑定 `settings.formatRules[rule.id]`，变更后 `saveSettings()`）。
2. 「简化规则」小节：遍历 `COMPACT_RULES`（键存于 `settings.simplifyRules`）。
3. 「代码块默认语言」文本输入（`addText`，空串表示不补）。
4. 「显示操作提示」toggle。
5. 「快捷键设置」按钮：`(this.app as any).setting.open()` 后 `openTabById("hotkeys")`，说明文字写明「搜索 Note to JSON 即可自定义快捷键」。

- [ ] **步骤 6：`onload` 装载**

`await this.loadSettings()`（`Object.assign({}, DEFAULT_SETTINGS, await this.loadData())`，并对两个规则 map 与默认值做合并补齐）；`this.addSettingTab(new TidySettingTab(this.app, this));`

- [ ] **步骤 7：构建验证**

运行：`npm run build`，预期零错误、产出 `main.js`。

- [ ] **步骤 8：检查点**

- 命令面板可见「Note to JSON: 格式化 / 简化」。
- 「设置 → 快捷键」中可搜到两条命令，默认键位 `Ctrl+Alt+F` / `Ctrl+Alt+S`，可改键。
- 关掉「行尾空白」开关后该规则不生效。

---

### 任务 9：打包与 vault 手工验收

**文件：**
- 无新增源码

- [ ] **步骤 1：最终构建**

运行：`npm run build`，预期零错误，`main.js` 生成。

- [ ] **步骤 2：部署到 vault**

把 `manifest.json`、`main.js`、`versions.json` 复制到 `<vault>/.obsidian/plugins/note-to-json/`，Obsidian 设置中重新加载并启用插件。

- [ ] **步骤 3：手工验收（对照规格第 10 节逐条勾）**

- [ ] 含 frontmatter / 围栏代码块 / `$$` 公式 / HTML 注释 / 表格 / wikilink / 行内代码的笔记，跑「格式化」后保护区内容逐字节不变。
- [ ] 表格四列对齐；标题与列表规范生效。
- [ ] 「简化」后段落之间仍保留 1 个空行，渲染出的段落数与简化前一致。
- [ ] 两条命令各执行一次后 `Ctrl+Z` 能**一步**完整回滚。
- [ ] 选中代码块内的几行执行格式化，选区外内容与代码内容均未被改写。
- [ ] 仅含 frontmatter 的文档、空文档执行命令：只提示「已是规范格式」，文件无变化、无报错。
- [ ] CRLF 换行的笔记格式化后仍是 CRLF（用编辑器状态栏或 VSCode 右下角确认）。
- [ ] 关闭任一条规则开关后，只有该规则失效。

- [ ] **步骤 4：记录遗留**

若发现不符合规格的行为，记录到规格文档末尾的「已知局限」小节（例如中文宽字符表格未做双宽对齐），不在本计划外自行加功能。
