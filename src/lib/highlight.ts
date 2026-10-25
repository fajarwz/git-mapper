/**
 * Lazy syntax highlighting for diff lines, on top of highlight.js.
 *
 * The core is a dynamic import, and each grammar is a dynamic import of its own, so nothing
 * is in the initial bundle: the first diff that opens a TypeScript file fetches the core plus
 * that one grammar, and a file in a language never seen costs one small chunk. Language comes
 * from the file path (per-line auto-detection would guess wrong), and the schemes themselves
 * are CSS in index.css scoped to `data-syntax` — not highlight.js theme files, so they stay on
 * the app's tokens.
 */
import type { LanguageFn } from "highlight.js";

export type SyntaxScheme = "app" | "github" | "neon";

/** hljs core, loaded once on the first highlighted diff. */
type Core = {
  registerLanguage: (name: string, grammar: LanguageFn) => void;
  highlight: (code: string, options: { language: string; ignoreIllegals?: boolean }) => { value: string };
};
let core: Core | null = null;
const loaded = new Set<string>();

/** File extension → grammar name.highlight.js; basename fallbacks for extension-less files. */
const EXTENSIONS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", jsonc: "json",
  css: "css", scss: "scss", less: "less",
  html: "xml", htm: "xml", svg: "xml", xml: "xml", vue: "xml", svelte: "xml",
  php: "php", phtml: "php",
  py: "python", rb: "ruby", go: "go", rs: "rust",
  java: "java", kt: "kotlin", kts: "kotlin", cs: "csharp",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hxx: "cpp",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psd1: "powershell", psm1: "powershell",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", env: "ini", properties: "ini",
  md: "markdown", markdown: "markdown",
  sql: "sql", lua: "lua",
};

/** Extension-less names that still map ("Dockerfile", "Makefile", ".env"). */
const BASENAMES: Record<string, string> = {
  dockerfile: "dockerfile", makefile: "makefile", cmakelists: "cmake",
  ".env": "ini", ".env.local": "ini", ".env.example": "ini",
};

/** Grammar for a repo path, or null when the diff should stay plain. */
export function languageForPath(path: string): string | null {
  const base = path.split(/[\\/]/).pop() ?? path;
  if (BASENAMES[base.toLowerCase()] !== undefined) return BASENAMES[base.toLowerCase()];
  if (base.toLowerCase().startsWith(".env")) return "ini";
  const dot = base.lastIndexOf(".");
  if (dot === -1) return null;
  const extension = base.slice(dot + 1).toLowerCase();
  return EXTENSIONS[extension] ?? null;
}

/** One lazy import per grammar: a language costs nothing until a file of that type opens. */
const GRAMMARS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  json: () => import("highlight.js/lib/languages/json"),
  xml: () => import("highlight.js/lib/languages/xml"),
  css: () => import("highlight.js/lib/languages/css"),
  scss: () => import("highlight.js/lib/languages/scss"),
  less: () => import("highlight.js/lib/languages/less"),
  bash: () => import("highlight.js/lib/languages/bash"),
  php: () => import("highlight.js/lib/languages/php"),
  python: () => import("highlight.js/lib/languages/python"),
  ruby: () => import("highlight.js/lib/languages/ruby"),
  go: () => import("highlight.js/lib/languages/go"),
  rust: () => import("highlight.js/lib/languages/rust"),
  java: () => import("highlight.js/lib/languages/java"),
  kotlin: () => import("highlight.js/lib/languages/kotlin"),
  csharp: () => import("highlight.js/lib/languages/csharp"),
  c: () => import("highlight.js/lib/languages/c"),
  cpp: () => import("highlight.js/lib/languages/cpp"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  sql: () => import("highlight.js/lib/languages/sql"),
  lua: () => import("highlight.js/lib/languages/lua"),
  dockerfile: () => import("highlight.js/lib/languages/dockerfile"),
  makefile: () => import("highlight.js/lib/languages/makefile"),
  powershell: () => import("highlight.js/lib/languages/powershell"),
};

/**
 * Loads the core plus one grammar. False for a grammar we do not ship (the diff stays plain);
 * safe to call repeatedly — the second call is a registry lookup.
 */
export async function loadHighlighter(language: string): Promise<boolean> {
  if (core !== null && loaded.has(language)) return true;
  const grammar = GRAMMARS[language];
  if (grammar === undefined) return false;
  if (core === null) {
    core = (await import("highlight.js/lib/core")).default as unknown as Core;
  }
  core.registerLanguage(language, (await grammar()).default);
  loaded.add(language);
  return true;
}

/**
 * Synchronous highlight, usable once `loadHighlighter` resolved for that language. Returns the
 * HTML string (already escaped — highlight.js escapes code before wrapping tokens) or null
 * when the highlighter is not ready, the language is unknown, or nothing was recognized.
 */
export function highlightSync(text: string, language: string): string | null {
  if (core === null || !loaded.has(language)) return null;
  try {
    return core.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
