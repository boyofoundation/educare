/**
 * Static Validation Service (Phase 1 MVP)。
 *
 * 設計目的:
 * - 寫入工具 (writeFiles/replaceInFile/modifyLinesInFile) 在落檔後,於同一回合
 *   對目標檔執行語法驗證,把診斷包成 LLM-friendly 字串放進工具回傳。
 * - 非阻塞:驗證器自身例外或編輯失敗都不影響落檔與 previewVersion 遞增。
 * - 介面 (`validateProjectFiles`) 即為未來 Web Worker / Biome WASM 的替換點
 *   (見計畫 F-1 / F-4)。
 *
 * Parser 載入策略:
 * - acorn / css-tree / csstree-validator / parse5 採動態 import() + 模組級快取,
 *   不進主 bundle (驗收 8);parser 載入時間不計入 stats.durationMs
 *   (驗收 9, Step 3 定義)。
 *
 * 行號慣例:
 * - 對外 (HtmlProjectStaticDiagnostic.line/column) 一律 1-based。
 * - acorn `loc.column` 為 0-based,輸出前 +1。
 * - inline script/style 透過 parse5 `sourceCodeLocation` 平移到 HTML 檔行號
 *   (line += startLine-1;若診斷 line === 1 額外 column += startCol-1)。
 */
import type {
  HtmlProjectStaticDiagnostic,
  HtmlProjectStaticValidationResult,
  HtmlProjectStaticValidationStats,
} from '../types';
import { classifyHtmlParseError } from './htmlParseErrorAllowlist';

// ---------------------------------------------------------------------------
// 模組級動態載入快取
// ---------------------------------------------------------------------------

interface AcornParser {
  parse: (
    source: string,
    options: { ecmaVersion: string; sourceType: string; locations: true },
  ) => unknown;
}

interface CssTreeParser {
  parse: (
    source: string,
    options: {
      positions: true;
      onParseError: (error: { message?: string; line?: number; column?: number }) => void;
    },
  ) => unknown;
  walk: (ast: unknown, options: Record<string, unknown>) => void;
}

interface CssValidator {
  validate: (css: string) => Array<{
    property?: string;
    message: string;
    line?: number;
    column?: number;
  }>;
}

interface Parse5 {
  parse: (
    source: string,
    options: {
      sourceCodeLocationInfo: true;
      onParseError: (error: {
        code: string;
        startLine?: number;
        startCol?: number;
        endLine?: number;
        endCol?: number;
      }) => void;
    },
  ) => unknown;
}

interface ParserBundle {
  acorn: AcornParser;
  cssTree: CssTreeParser;
  cssValidator: CssValidator;
  parse5: Parse5;
}

let parserBundlePromise: Promise<ParserBundle> | null = null;

const loadParsers = (): Promise<ParserBundle> => {
  if (!parserBundlePromise) {
    parserBundlePromise = (async () => {
      const [acornMod, cssTreeMod, cssValidatorMod, parse5Mod] = await Promise.all([
        import('acorn') as Promise<{ default?: AcornParser } & AcornParser>,
        import('css-tree') as Promise<{ default?: CssTreeParser } & CssTreeParser>,
        import('csstree-validator') as Promise<{ default?: CssValidator } & CssValidator>,
        import('parse5') as Promise<Parse5>,
      ]);
      return {
        acorn: (acornMod.default ?? acornMod) as AcornParser,
        cssTree: (cssTreeMod.default ?? cssTreeMod) as CssTreeParser,
        cssValidator: (cssValidatorMod.default ?? cssValidatorMod) as CssValidator,
        parse5: parse5Mod as Parse5,
      };
    })();
  }
  return parserBundlePromise;
};

/**
 * 預先載入 parser bundle (供工具 handler 暖機使用,讓 stats.durationMs 不含
 * 首次 import 開銷 — 計畫 Step 3 / 驗收 9 明訂)。
 * 已載入時為 no-op。
 */
export const preloadStaticValidationParsers = (): Promise<void> =>
  loadParsers().then(() => undefined);

// ---------------------------------------------------------------------------
// 公開型別
// ---------------------------------------------------------------------------

/** 寫入工具傳入的最小檔案描述 (避免耦合 store 完整型別) */
export interface StaticValidationFileInput {
  path: string;
  kind?: string;
  content: string;
  encoding?: string;
}

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

const SNIPPET_CONTEXT_LINES = 1;
const SNIPPET_LINE_MAX_CHARS = 120;
const MAX_LLM_DIAGNOSTIC_ENTRIES = 8;
const JS_PARSE_ACORN_OPTIONS_BASE = {
  ecmaVersion: 'latest' as const,
  sourceType: 'module' as const,
  locations: true as const,
};
const JS_PARSE_ACORN_OPTIONS_SCRIPT = {
  ecmaVersion: 'latest' as const,
  sourceType: 'script' as const,
  locations: true as const,
};

// ---------------------------------------------------------------------------
// 副檔名工具
// ---------------------------------------------------------------------------

const JS_LIKE_EXTS = new Set(['js', 'mjs', 'cjs']);
const UNSUPPORTED_JS_LIKE_EXTS = new Set(['ts', 'tsx', 'jsx']);
const CSS_LIKE_EXTS = new Set(['css']);
const UNSUPPORTED_CSS_LIKE_EXTS = new Set(['scss']);

const getExtension = (path: string): string => {
  const dot = path.lastIndexOf('.');
  if (dot === -1) {
    return '';
  }
  return path.slice(dot + 1).toLowerCase();
};

// ---------------------------------------------------------------------------
// snippet 工具
// ---------------------------------------------------------------------------

const splitLinesCrlfSafe = (content: string): string[] => content.split(/\r?\n/);

const buildSnippet = (content: string, errorLine: number): string => {
  if (errorLine < 1) {
    return '';
  }
  const lines = splitLinesCrlfSafe(content);
  const start = Math.max(1, errorLine - SNIPPET_CONTEXT_LINES);
  const end = Math.min(lines.length, errorLine + SNIPPET_CONTEXT_LINES);
  const out: string[] = [];
  for (let i = start; i <= end; i += 1) {
    const raw = lines[i - 1] ?? '';
    const truncated =
      raw.length > SNIPPET_LINE_MAX_CHARS ? `${raw.slice(0, SNIPPET_LINE_MAX_CHARS)}…` : raw;
    const prefix = i === errorLine ? '> ' : '  ';
    out.push(`${prefix}${i}: ${truncated}`);
  }
  return out.join('\n');
};

// ---------------------------------------------------------------------------
// 單檔 JS 驗證 (acorn)
// ---------------------------------------------------------------------------

interface AcornLikeError {
  name?: string;
  message?: string;
  loc?: { line?: number; column?: number };
}

const isAcornLikeError = (value: unknown): value is AcornLikeError => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const name = (value as { name?: string }).name;
  return name === 'SyntaxError' || name === 'TypeError';
};

const validateJsContent = (
  content: string,
  path: string,
  parsers: ParserBundle,
): HtmlProjectStaticDiagnostic | null => {
  let moduleError: AcornLikeError | null = null;
  try {
    parsers.acorn.parse(content, JS_PARSE_ACORN_OPTIONS_BASE);
    return null;
  } catch (rawErr) {
    if (!isAcornLikeError(rawErr)) {
      throw rawErr;
    }
    moduleError = rawErr;
  }

  // 嘗試以 script 模式重試 (見 R-2, 處理頂層 with 等 module 模式誤報)
  try {
    parsers.acorn.parse(content, JS_PARSE_ACORN_OPTIONS_SCRIPT);
    return null;
  } catch (rawErr) {
    if (!isAcornLikeError(rawErr)) {
      throw rawErr;
    }
    // 雙模式皆失敗,固定回報 module 模式的錯誤 (VFS 為 module-first, Step 3 裁決)
  }

  const loc = moduleError?.loc;
  const rawLine = typeof loc?.line === 'number' ? loc.line : 1;
  const rawColumn = typeof loc?.column === 'number' ? loc.column : 0;
  const message = moduleError?.message ?? 'JavaScript syntax error';
  return {
    source: 'syntax',
    lang: 'js',
    severity: 'error',
    message,
    path,
    line: rawLine,
    column: rawColumn + 1, // acorn column 為 0-based,轉為 1-based
    rule: 'SyntaxError',
    snippet: buildSnippet(content, rawLine),
  };
};

// ---------------------------------------------------------------------------
// 單檔 CSS 驗證 (css-tree + csstree-validator)
// ---------------------------------------------------------------------------

const validateCssContent = (
  content: string,
  path: string,
  parsers: ParserBundle,
): HtmlProjectStaticDiagnostic[] => {
  const diagnostics: HtmlProjectStaticDiagnostic[] = [];

  // 1) css-tree 結構/語法錯誤
  try {
    const onParseError = (error: { message?: string; line?: number; column?: number }) => {
      const rawLine = typeof error.line === 'number' ? error.line : 1;
      const rawColumn = typeof error.column === 'number' ? error.column : 0;
      diagnostics.push({
        source: 'syntax',
        lang: 'css',
        severity: 'error',
        message: error.message ?? 'CSS syntax error',
        path,
        line: rawLine,
        column: rawColumn + 1,
        rule: 'CssTreeParse',
        snippet: buildSnippet(content, rawLine),
      });
    };
    parsers.cssTree.parse(content, { positions: true, onParseError });
  } catch (rawErr) {
    if (rawErr instanceof Error) {
      diagnostics.push({
        source: 'syntax',
        lang: 'css',
        severity: 'error',
        message: rawErr.message,
        path,
        line: 1,
        column: 1,
        rule: 'CssTreeParse',
        snippet: buildSnippet(content, 1),
      });
    }
  }

  // 2) csstree-validator 屬性值錯誤 (`display: flexx;` 等)
  try {
    const validationErrors = parsers.cssValidator.validate(content);
    for (const ve of validationErrors) {
      const rawLine = typeof ve.line === 'number' ? ve.line : 1;
      const rawColumn = typeof ve.column === 'number' ? ve.column : 0;
      diagnostics.push({
        source: 'lint',
        lang: 'css',
        severity: 'error',
        message: ve.message,
        path,
        line: rawLine,
        column: rawColumn + 1,
        rule: ve.property ?? 'CssValidator',
        snippet: buildSnippet(content, rawLine),
      });
    }
  } catch {
    // validator 自身例外不阻斷主流程,記 warn 由外層 console 收
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// 單檔 JSON 驗證
// ---------------------------------------------------------------------------

const validateJsonContent = (content: string, path: string): HtmlProjectStaticDiagnostic | null => {
  try {
    JSON.parse(content);
    return null;
  } catch (rawErr) {
    // V8 錯誤訊息範例: `Unexpected token } in JSON at position 42`
    const message = rawErr instanceof Error ? rawErr.message : 'JSON parse error';
    const posMatch = /position\s+(\d+)/i.exec(message);
    let line = 1;
    let column = 1;
    if (posMatch) {
      const offset = Number(posMatch[1]);
      const before = content.slice(0, offset);
      const lineCount = before.split('\n').length;
      line = lineCount;
      const lastNl = before.lastIndexOf('\n');
      column = lastNl === -1 ? offset + 1 : offset - lastNl;
    }
    return {
      source: 'syntax',
      lang: 'json',
      severity: 'error',
      message,
      path,
      line,
      column,
      rule: 'JSONParse',
      snippet: buildSnippet(content, line),
    };
  }
};

// ---------------------------------------------------------------------------
// HTML 驗證 + inline script/style 抽取
// ---------------------------------------------------------------------------

interface Parse5NodeLike {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  sourceCodeLocation?: {
    startLine?: number;
    startCol?: number;
    endLine?: number;
    endCol?: number;
  };
  childNodes?: Parse5TreeLike[];
  value?: string; // text node
  parentNode?: Parse5TreeLike;
}

/** parse5 文件/片段節點 (共用同 shape,以 childNodes 為進入點) */
type Parse5TreeLike = Parse5NodeLike;

type InlineKind = 'script' | 'style';

/**
 * 走訪 parse5 AST,收集 inline <script>(限無 src 且 type 為瀏覽器可執行)
 * 與 <style> 文字節點。回呼接收片段內容與「文字內容起點」
 * (parse5 對 <script>/<style> 的子文字節點會有自己的 sourceCodeLocation,
 * 反映「真正放程式碼的那一行」,而不是標籤本身所在行)。
 */
const collectInlineFragments = (
  doc: Parse5TreeLike | null | undefined,
  kind: InlineKind,
  collect: (fragment: string, startLine: number, startCol: number) => void,
): void => {
  const walk = (node: Parse5TreeLike | undefined): void => {
    if (!node) {
      return;
    }
    if (node.nodeName === kind) {
      const attrs = node.attrs ?? [];
      // 找出「第一個文字內容子節點」的 sourceCodeLocation。
      // 若無子節點,退回用 <script>/<style> 自身的 (極少見)。
      const firstText = (node.childNodes ?? []).find(child => child.nodeName === '#text');
      const loc = firstText?.sourceCodeLocation ?? node.sourceCodeLocation;
      const startLine = loc?.startLine ?? 1;
      const startCol = loc?.startCol ?? 1;
      const text = (node.childNodes ?? [])
        .map(child => (child.nodeName === '#text' ? (child.value ?? '') : ''))
        .join('');
      if (kind === 'script') {
        // 對 <script>:只收集無 src 且 type 為 module / text/javascript / 預設
        const srcAttr = attrs.find(a => a.name === 'src');
        if (srcAttr) {
          return;
        }
        const typeAttr = attrs.find(a => a.name === 'type');
        const typeValue = typeAttr?.value.toLowerCase();
        if (
          !typeValue ||
          typeValue === 'module' ||
          typeValue === 'text/javascript' ||
          typeValue === 'application/javascript'
        ) {
          collect(text, startLine, startCol);
        }
      } else {
        // <style> 一律收集
        collect(text, startLine, startCol);
      }
    }
    if (node.childNodes) {
      for (const child of node.childNodes) {
        walk(child);
      }
    }
  };
  walk(doc ?? undefined);
};

const translateInlineDiagnostic = (
  base: HtmlProjectStaticDiagnostic,
  startLine: number,
  startCol: number,
): HtmlProjectStaticDiagnostic => {
  const lineOffset = startLine - 1;
  const translatedLine = base.line + lineOffset;
  const translatedColumn = base.line === 1 ? base.column + (startCol - 1) : base.column;
  return {
    ...base,
    line: translatedLine,
    column: translatedColumn,
  };
};

const validateHtmlContent = (
  content: string,
  path: string,
  parsers: ParserBundle,
): HtmlProjectStaticDiagnostic[] => {
  const diagnostics: HtmlProjectStaticDiagnostic[] = [];

  // 1) parse5 結構驗證
  let doc: Parse5TreeLike | null = null;
  try {
    const onParseError = (error: { code: string; startLine?: number; startCol?: number }) => {
      const severity = classifyHtmlParseError(error.code);
      if (severity === null) {
        // 未列入的錯誤碼,記 warn 供後續校準

        console.warn(
          `[staticValidation] unknown parse5 code "${error.code}" at line ${error.startLine ?? '?'}`,
        );
        return;
      }
      const line = error.startLine ?? 1;
      const col = error.startCol ?? 1;
      diagnostics.push({
        source: 'syntax',
        lang: 'html',
        severity,
        message: error.code,
        path,
        line,
        column: col,
        rule: error.code,
        snippet: severity === 'error' ? buildSnippet(content, line) : undefined,
      });
    };
    doc = parsers.parse5.parse(content, {
      sourceCodeLocationInfo: true,
      onParseError,
    }) as Parse5TreeLike;
  } catch (rawErr) {
    if (rawErr instanceof Error) {
      diagnostics.push({
        source: 'syntax',
        lang: 'html',
        severity: 'error',
        message: rawErr.message,
        path,
        line: 1,
        column: 1,
        rule: 'Parse5Crash',
        snippet: buildSnippet(content, 1),
      });
    }
    return diagnostics;
  }

  // 2) inline <script>: 委派給 JS validator
  if (doc) {
    collectInlineFragments(doc, 'script', (fragment, startLine, startCol) => {
      if (!fragment.trim()) {
        return;
      }
      const base = validateJsContent(fragment, path, parsers);
      if (base) {
        diagnostics.push(translateInlineDiagnostic(base, startLine, startCol));
      }
    });

    // 3) inline <style>: 委派給 CSS validator
    collectInlineFragments(doc, 'style', (fragment, startLine, startCol) => {
      if (!fragment.trim()) {
        return;
      }
      const cssDiagnostics = validateCssContent(fragment, path, parsers);
      for (const d of cssDiagnostics) {
        diagnostics.push(translateInlineDiagnostic(d, startLine, startCol));
      }
    });
  }

  return diagnostics;
};

// ---------------------------------------------------------------------------
// 副檔名分派
// ---------------------------------------------------------------------------

const UNSUPPORTED_JS_WARNING = (path: string): HtmlProjectStaticDiagnostic => ({
  source: 'lint',
  lang: 'js',
  severity: 'warning',
  message: 'Preview sandbox does not support TypeScript/JSX; rewrite as browser-native JavaScript.',
  path,
  line: 1,
  column: 1,
  rule: 'UnsupportedJsVariant',
});

const UNSUPPORTED_CSS_WARNING = (path: string): HtmlProjectStaticDiagnostic => ({
  source: 'lint',
  lang: 'css',
  severity: 'warning',
  message: 'Preview sandbox does not support SCSS; rewrite as browser-native CSS.',
  path,
  line: 1,
  column: 1,
  rule: 'UnsupportedCssVariant',
});

const validateSingleFile = (
  file: StaticValidationFileInput,
  parsers: ParserBundle,
): HtmlProjectStaticDiagnostic[] => {
  const path = file.path;
  const ext = getExtension(path);

  // 跳過 base64 / 二進位
  if (file.encoding === 'base64') {
    return [];
  }

  // 跳過不支援解析的副檔名(svg / md / 圖片等)
  if (!ext) {
    return [];
  }
  if (UNSUPPORTED_JS_LIKE_EXTS.has(ext)) {
    return [UNSUPPORTED_JS_WARNING(path)];
  }
  if (UNSUPPORTED_CSS_LIKE_EXTS.has(ext)) {
    return [UNSUPPORTED_CSS_WARNING(path)];
  }
  if (JS_LIKE_EXTS.has(ext)) {
    const d = validateJsContent(file.content, path, parsers);
    return d ? [d] : [];
  }
  if (CSS_LIKE_EXTS.has(ext)) {
    return validateCssContent(file.content, path, parsers);
  }
  if (ext === 'json') {
    const d = validateJsonContent(file.content, path);
    return d ? [d] : [];
  }
  if (ext === 'html' || ext === 'htm') {
    return validateHtmlContent(file.content, path, parsers);
  }
  // 其他副檔名 (svg / md / 圖片) 跳過
  return [];
};

// ---------------------------------------------------------------------------
// 公開入口
// ---------------------------------------------------------------------------

export const validateProjectFiles = async (
  files: StaticValidationFileInput[],
): Promise<HtmlProjectStaticValidationResult> => {
  // 預先 await parser 快取 — 確保 stats.durationMs 不含首次 import 開銷
  const parsers = await loadParsers();
  const start = performance.now();

  const diagnostics: HtmlProjectStaticDiagnostic[] = [];
  for (const file of files) {
    try {
      const fileDiagnostics = validateSingleFile(file, parsers);
      diagnostics.push(...fileDiagnostics);
    } catch (rawErr) {
      // 驗證器自身 throw:不阻斷寫入,記 warn 供後續校準
      const msg = rawErr instanceof Error ? rawErr.message : String(rawErr);

      console.warn(`[staticValidation] validator crashed on ${file.path}: ${msg}`);
    }
  }

  const durationMs = performance.now() - start;
  const ok = diagnostics.every(d => d.severity !== 'error');
  const stats: HtmlProjectStaticValidationStats = {
    durationMs,
    engine: 'lightweight-v1',
  };
  return { ok, diagnostics, stats };
};

// ---------------------------------------------------------------------------
// LLM 格式化器
// ---------------------------------------------------------------------------

const severityRank = (s: HtmlProjectStaticDiagnostic['severity']): number => {
  if (s === 'error') {
    return 0;
  }
  if (s === 'warning') {
    return 1;
  }
  return 2;
};

const compareDiagnostics = (
  a: HtmlProjectStaticDiagnostic,
  b: HtmlProjectStaticDiagnostic,
): number => {
  const rank = severityRank(a.severity) - severityRank(b.severity);
  if (rank !== 0) {
    return rank;
  }
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.column - b.column;
};

const dedupKey = (d: HtmlProjectStaticDiagnostic): string =>
  `${d.rule ?? ''}||${d.message}||${d.lang}`;

/**
 * 將 diagnostics 攤平為 LLM 易讀的多行字串。
 * 規則:
 * 1. 依 severity (error > warning > info) 排序
 * 2. 同 (rule, message, lang) 去重,附 ×N
 * 3. 上限 8 條,截斷時加 `…and N more (fix the above first)`
 * 4. 每條格式: `[{lang}:{severity}] L{line}:{column} {message}` + snippet 縮排
 */
export const formatStaticDiagnosticsForLlm = (
  diagnostics: HtmlProjectStaticDiagnostic[],
): string => {
  if (diagnostics.length === 0) {
    return '';
  }
  const sorted = [...diagnostics].sort(compareDiagnostics);

  // 去重:保留首見,記數
  const seen = new Map<string, { diagnostic: HtmlProjectStaticDiagnostic; count: number }>();
  for (const d of sorted) {
    const key = dedupKey(d);
    const existing = seen.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      seen.set(key, { diagnostic: d, count: 1 });
    }
  }
  const deduped = Array.from(seen.values());

  const limited = deduped.slice(0, MAX_LLM_DIAGNOSTIC_ENTRIES);
  const dropped = deduped.length - limited.length;
  const lines: string[] = [];
  for (const entry of limited) {
    const { diagnostic, count } = entry;
    const header = `[${diagnostic.lang}:${diagnostic.severity}] ${diagnostic.path} L${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`;
    lines.push(count > 1 ? `${header} ×${count}` : header);
    if (diagnostic.snippet) {
      for (const snipLine of diagnostic.snippet.split('\n')) {
        lines.push(`    ${snipLine}`);
      }
    }
  }
  if (dropped > 0) {
    lines.push(`…and ${dropped} more (fix the above first)`);
  }
  return lines.join('\n');
};
