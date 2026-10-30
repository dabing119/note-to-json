# Note to JSON

English | [简体中文](./README.md)

An Obsidian plugin that normalizes or compacts Markdown formatting, and pretty-prints or minifies JSON.

Runs entirely on your machine: no network requests, no runtime dependencies.

## Features

Four commands, all rebindable in **Settings → Hotkeys** by searching for `Note to JSON`:

| Command | What it does | Default hotkey |
| --- | --- | --- |
| `Note to JSON: Format` | Normalizes Markdown structure: headings, lists, blank lines, code blocks, tables | `Ctrl+Alt+F` |
| `Note to JSON: Simplify` | Removes redundant blank lines to make notes compact (never merges paragraphs) | `Ctrl+Alt+S` |
| `Note to JSON: Format JSON` | Re-indents JSON with 2 spaces | `Ctrl+Alt+J` |
| `Note to JSON: Compress JSON` | Removes all whitespace, producing a single line | `Ctrl+Alt+M` |

- The editor context menu also offers **Format JSON** and **Compress JSON**, with identical behaviour.
- With a selection, only the selection is processed; without one, the whole document is processed.
- Every write is a single `editor.transaction`, so `Ctrl+Z` reverts it in one step.

## Installation

Manual install:

1. Run `npm install && npm run build` to produce `main.js`.
2. Copy `manifest.json`, `main.js` and `versions.json` into `<your-vault>/.obsidian/plugins/note-to-json/`.
3. Restart Obsidian and enable **Note to JSON** in **Settings → Community plugins**.

## Markdown formatting rules (F1–F11)

| Rule | Name | Behaviour |
| --- | --- | --- |
| F1 | Heading normalization | Exactly one space between `#` and the text; `#tag` is left alone because Obsidian parses it as a tag |
| F2 | Trailing whitespace | Strips trailing spaces and tabs |
| F3 | Blank line compression | Collapses runs of blank lines into one |
| F4 | List marker unification | `*` and `+` bullets become `-` |
| F5 | Emphasis unification | `__bold__` → `**bold**`, `_italic_` → `*italic*`; skips URLs, wikilinks and snake_case |
| F6 | List indentation | Normalizes indentation to 2 spaces per level |
| F7 | Heading level progression | Heading levels may only drop one step at a time; skipped levels are inserted |
| F8 | Blank lines around headings | Exactly one blank line above and below each heading |
| F9 | Block spacing | Exactly one blank line around code blocks and tables |
| F10 | Table alignment | Pads cells so pipes line up, preserving `:---` alignment markers |
| F11 | Default code block language | Adds the configured language to unlabelled fences (disabled by default) |

## Markdown simplification rules (S1–S5)

| Rule | Name | Behaviour |
| --- | --- | --- |
| S1 | Trailing whitespace | Strips trailing spaces and tabs |
| S2 | Blank line compression | Collapses runs of blank lines into one |
| S3 | Blank lines between list items | Removes blank lines between adjacent items of the same list |
| S4 | Blank line after headings | Removes a blank line directly after a heading |
| S5 | Leading/trailing blank lines | Trims blank lines at the start and end of the document |

Simplification **never merges paragraphs**: blank lines between paragraphs are kept, so the rendered paragraph count does not change.

### Protected regions

The following content is never modified, byte for byte:

- YAML frontmatter (from a leading `---` to its closing `---`)
- Fenced code blocks (```` ``` ```` / `~~~`, matched by marker length)
- `$$` math blocks
- HTML comment blocks
- Inline code, `[[wikilinks]]`, `![[embeds]]`, `![](images)` and URLs

Content above a selection participates in analysis, so starting a selection in the middle of a code block cannot cause code to be rewritten as prose.

## JSON formatting and compression

### Fidelity

Formatting does **not** go through `JSON.stringify(JSON.parse(x), null, 2)`. Only the whitespace between tokens is rewritten, so literals are preserved verbatim:

| Input | Output |
| --- | --- |
| `1740123456789012345` | Kept as-is (`stringify` would lose precision) |
| `1e21` | Kept as-is (`stringify` would emit `1e+21`) |
| `"a\/b\u4e2d"` | Kept as-is (`stringify` would decode and re-encode it) |

Empty containers `{}` / `[]` stay on one line; CRLF documents are written back with CRLF.

### Unusual whitespace normalization

JSON copied from web pages, chat apps or Excel often carries full-width spaces (U+3000), non-breaking spaces (U+00A0), EM SPACE (U+2003), zero-width characters or a BOM inside its indentation. JSON only allows space, tab, LF and CR, so these characters break parsing while the reported snippet looks perfectly fine.

The plugin normalizes these characters to plain spaces **outside string literals only** — not a single character inside a string is touched — and the success notice reports how many unusual whitespace characters were fixed.

### Strict validation

Comments, trailing commas, single quotes and `NaN` are rejected: a notice reports the line, column and snippet, **nothing is written back**. Invisible characters inside the snippet are rendered as `⟨U+0001⟩` so they can be located.

### Known trade-offs

- The first line of pretty-printed JSON starts at column 0; JSON indented inside a list item does not get its nesting restored.
- No key sorting, no graphical tree view, no JSON5/JSONC.
- Without a selection, running this on a Markdown note fails by design — select the JSON fragment first.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Format rule toggles | F1–F10 on, F11 off | Per-rule control |
| Simplify rule toggles | S1–S5 on | Per-rule control |
| Default code block language | empty | Language added by F11; empty means no change |
| Show notices | on | Whether to display a notice after each run |
| Open hotkey settings | — | Jumps to Obsidian's hotkey page |

## Known limitations

1. CJK characters are counted as width 1, so all-Chinese tables do not align visually in a monospace font.
2. Tables inside blockquotes (`> | a | b |`) are not aligned or spaced.
3. `#tag` and `#heading` are syntactically indistinguishable, so the plugin leaves them untouched.
4. Rules insert and delete blank lines, so the cursor stays on the original line number (column preserved) and may drift by a line or two.
5. A fence indented by 4 spaces inside a list item (`    ```js`) is not recognized as a protected region.
6. Documents larger than 2 MB are skipped.

## Development

```bash
npm install     # install dependencies
npm run dev     # watch mode
npm run build   # type check + production build, emits main.js
```

`main.js` is a build artifact and is excluded by `.gitignore`; it is not committed.

### Project layout

```
manifest.json          # plugin manifest (id: note-to-json)
versions.json          # version → minimum Obsidian version
esbuild.config.mjs     # bundler config
tsconfig.json
src/
  main.ts              # entry: commands, context menu, default hotkeys
  settings.ts          # settings type and defaults
  settingsTab.ts       # settings panel
  core/
    text.ts            # line helpers and inline placeholder masking
    segment.ts         # protected-region state machine
    rules.ts           # formatting rules F1–F11
    compact.ts         # simplification rules S1–S5
    pipeline.ts        # rule pipeline
    json.ts            # JSON validation and tokenizer-based reflow
```

### Stack

- TypeScript 7 + esbuild, with `obsidian` marked external
- No runtime dependencies, no network access
- Line-level state machine plus a rule pipeline; no AST round-trip (which would rewrite wikilinks, callouts and comments)

## License

ISC
