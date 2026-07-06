import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  formatStaticDiagnosticsForLlm,
  preloadStaticValidationParsers,
  validateProjectFiles,
  type StaticValidationFileInput,
} from './staticValidationService';

// Suppress noisy console.warn from validator-self-throw tests
vi.spyOn(console, 'warn').mockImplementation(() => {});

beforeAll(async () => {
  // 預熱 parser bundle 一次,後續 durationMs 比較不受首次 import 影響
  await preloadStaticValidationParsers();
}, 30000);

describe('staticValidationService: validateProjectFiles', () => {
  // 驗收 1:writeFiles 寫入含語法錯 JS → [js:error] 1-based 座標
  it('returns [js:error] with 1-based line/column for JS syntax error', async () => {
    const result = await validateProjectFiles([
      { path: '/foo.js', content: 'items.forEach(item => {}));' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    const d = result.diagnostics[0];
    expect(d.lang).toBe('js');
    expect(d.severity).toBe('error');
    expect(d.source).toBe('syntax');
    expect(d.path).toBe('/foo.js');
    // acorn 報 (1:25) — line 1, 0-based column 25 → 1-based 26
    expect(d.line).toBe(1);
    expect(d.column).toBe(26);
    expect(d.rule).toBe('SyntaxError');
    expect(d.snippet).toContain('> 1: items.forEach');
  });

  it('passes valid JS with no diagnostics', async () => {
    const result = await validateProjectFiles([
      { path: '/foo.js', content: 'export const x = 1;\n' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  // 驗收 2:CSS property value error (lint diagnostic)
  it('returns [css:error] lint diagnostic for invalid CSS property value', async () => {
    const result = await validateProjectFiles([
      { path: '/styles.css', content: 'body { display: flexx; }' },
    ]);
    expect(result.ok).toBe(false);
    const d = result.diagnostics.find((x) => x.lang === 'css');
    expect(d).toBeDefined();
    expect(d!.source).toBe('lint');
    expect(d!.rule).toBe('display');
    expect(d!.message).toContain('display');
  });

  it('returns [css:error] syntax diagnostic for malformed CSS', async () => {
    const result = await validateProjectFiles([
      { path: '/styles.css', content: 'body { color: ;\n' },
    ]);
    // css-tree 與 csstree-validator 至少一個會抓到;寬鬆斷言「有 error」
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.lang === 'css')).toBe(true);
  });

  // 驗收 3:HTML allowlist — missing-doctype 降級或丟棄
  it('HTML missing-doctype is downgraded to info (not error)', async () => {
    const result = await validateProjectFiles([
      { path: '/index.html', content: '<div><span>hi</span></div>' },
    ]);
    const md = result.diagnostics.find((d) => d.rule === 'missing-doctype');
    expect(md).toBeDefined();
    expect(md!.severity).toBe('info');
    // ok 仍為 true (info 不算 error)
    expect(result.ok).toBe(true);
  });

  it('HTML structural error is reported at allowlist error level', async () => {
    // 構造可預期觸發 parse5 結構錯誤的輸入:未閉合的 <div> 與重複屬性
    // parse5 對簡單的 <div><span></div> 可能寬容解析,改用具體會 emit error 的輸入
    const result = await validateProjectFiles([
      { path: '/index.html', content: '<div class="a" class="b"></div>' },
    ]);
    // duplicate-attribute 在 allowlist 內,應為 error
    expect(result.diagnostics.some((d) => d.rule === 'duplicate-attribute' && d.severity === 'error')).toBe(true);
  });

  // 驗收 4:inline <script> 行號平移
  it('inline <script> syntax error is translated to HTML line coordinates', async () => {
    // <script> 開在第 10 行,內容第 2 行(因 parse5 含 leading \n)= 第 11 行
    // 預期 diagnostic.line ≈ 11
    const html = [
      '<!doctype html>', // 1
      '<html><head><title>x</title></head><body>', // 2
      '', // 3
      '', // 4
      '', // 5
      '', // 6
      '', // 7
      '', // 8
      '', // 9
      '<script>', // 10
      'items.forEach(item => {}));', // 11
      '</script>', // 12
      '</body></html>', // 13
    ].join('\n');
    const result = await validateProjectFiles([{ path: '/index.html', content: html }]);
    expect(result.ok).toBe(false);
    const d = result.diagnostics.find((x) => x.lang === 'js');
    expect(d).toBeDefined();
    // 開 script 在第 10 行,acorn 報 (2:25) → 10 + 2 - 1 = 11
    expect(d!.line).toBe(11);
  });

  it('inline <script type="module"> is also validated', async () => {
    const html = [
      '<!doctype html>',
      '<html><body>',
      '<script type="module">',
      'items.forEach(item => {}));',
      '</script>',
      '</body></html>',
    ].join('\n');
    const result = await validateProjectFiles([{ path: '/index.html', content: html }]);
    expect(result.diagnostics.some((d) => d.lang === 'js' && d.severity === 'error')).toBe(true);
  });

  it('inline <script type="application/json"> is skipped (not browser-executable)', async () => {
    const html = [
      '<!doctype html>',
      '<html><body>',
      '<script type="application/json">{ "a": }</script>',
      '</body></html>',
    ].join('\n');
    const result = await validateProjectFiles([{ path: '/index.html', content: html }]);
    // 沒有 JS 診斷
    expect(result.diagnostics.filter((d) => d.lang === 'js')).toHaveLength(0);
  });

  it('inline <script src="..."> is skipped (external)', async () => {
    const html = [
      '<!doctype html>',
      '<html><body>',
      '<script src="/main.js"></script>', // 故意指向不存在檔,不應觸發 JS 驗證
      '</body></html>',
    ].join('\n');
    const result = await validateProjectFiles([{ path: '/index.html', content: html }]);
    expect(result.diagnostics.filter((d) => d.lang === 'js')).toHaveLength(0);
  });

  it('inline <style> CSS error is also translated to HTML line coordinates', async () => {
    const html = [
      '<!doctype html>', // 1
      '<html><head>', // 2
      '<style>', // 3
      'body { display: flexx; }', // 4
      '</style>', // 5
      '</head></html>', // 6
    ].join('\n');
    const result = await validateProjectFiles([{ path: '/index.html', content: html }]);
    const d = result.diagnostics.find((x) => x.lang === 'css');
    expect(d).toBeDefined();
    // parse5 對 <style> 文字節點的 startLine 通常是 <style> 標籤所在行 (3)
    // 加上 acorn/css-tree 報的 acorn 1-based line,反映實際位置
    // 接受 3 或 4 (容差:parse5 leading newline 處理)
    expect([3, 4]).toContain(d!.line);
  });

  // 驗收 4b:.tsx / .scss 走 warning 警告,不跑 parser
  it('returns sandbox-unsupported warning for .tsx (no SyntaxError)', async () => {
    const result = await validateProjectFiles([
      { path: '/app.tsx', content: 'const x: number = 1;' },
    ]);
    expect(result.ok).toBe(true); // warning 不算 error
    const d = result.diagnostics.find((x) => x.rule === 'UnsupportedJsVariant');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
    expect(d!.lang).toBe('js');
  });

  it('returns sandbox-unsupported warning for .scss', async () => {
    const result = await validateProjectFiles([
      { path: '/styles.scss', content: '$primary: #333; body { color: $primary; }' },
    ]);
    const d = result.diagnostics.find((x) => x.rule === 'UnsupportedCssVariant');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('warning');
  });

  // base64/asset skip
  it('skips base64-encoded files', async () => {
    const result = await validateProjectFiles([
      { path: '/img.png', content: 'iVBORw0...', encoding: 'base64' },
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('skips asset extensions (svg/md)', async () => {
    const result = await validateProjectFiles([
      { path: '/logo.svg', content: '<svg><bad></svg>' },
      { path: '/readme.md', content: '# title\n```broken' },
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // JSON 驗證
  it('returns [json:error] for malformed JSON', async () => {
    const result = await validateProjectFiles([
      { path: '/data.json', content: '{"a": 1, "b":}' },
    ]);
    expect(result.ok).toBe(false);
    const d = result.diagnostics.find((x) => x.lang === 'json');
    expect(d).toBeDefined();
    expect(d!.severity).toBe('error');
  });

  // 驗收 7:驗證器 self-throw 不可阻斷 — 用空字串與二進位雜訊
  it('returns empty diagnostics for empty/whitespace input (no crash)', async () => {
    const result = await validateProjectFiles([
      { path: '/empty.js', content: '' },
      { path: '/ws.js', content: '   \n\n  ' },
    ]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('handles binary noise (control chars) without throwing', async () => {
    const noise = ' '.repeat(100);
    const result = await validateProjectFiles([{ path: '/noise.js', content: noise }]);
    // 不 throw + 回傳 result
    expect(result).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

describe('staticValidationService: formatStaticDiagnosticsForLlm', () => {
  // 驗收 5:12 → ≤8;dedup ×N;truncation suffix
  it('caps at 8 entries with dedup ×N and truncation suffix', () => {
    const diagnostics: StaticValidationFileInput[] = [
      { path: '/a.js', content: 'x' }, // dummy, formatStaticDiagnosticsForLlm 不會讀 content
    ] as StaticValidationFileInput[];
    void diagnostics;

    // 建 12 個 diagnostic,其中 3 個重複
    const items = Array.from({ length: 12 }, (_, i) => ({
      source: 'syntax' as const,
      lang: 'js' as const,
      severity: 'error' as const,
      message: i < 3 ? 'Same error' : `Error ${i}`,
      path: `/f${i}.js`,
      line: i + 1,
      column: 1,
      rule: 'SyntaxError',
    }));
    const formatted = formatStaticDiagnosticsForLlm(items);
    const lines = formatted.split('\n');
    // 開頭 8 條資料列(可能有 snippet 行,但每條 header 一行)
    const headerLines = lines.filter((l) => l.startsWith('['));
    expect(headerLines.length).toBeLessThanOrEqual(8);
    // ×3 計數
    expect(formatted).toContain('×3');
    // 截斷提示
    expect(formatted).toMatch(/and \d+ more \(fix the above first\)/);
  });

  it('returns empty string for no diagnostics', () => {
    expect(formatStaticDiagnosticsForLlm([])).toBe('');
  });

  it('orders errors before warnings before info', () => {
    const formatted = formatStaticDiagnosticsForLlm([
      {
        source: 'lint',
        lang: 'js',
        severity: 'info',
        message: 'info first',
        path: '/a.js',
        line: 1,
        column: 1,
        rule: 'r',
      },
      {
        source: 'syntax',
        lang: 'js',
        severity: 'error',
        message: 'error second',
        path: '/a.js',
        line: 1,
        column: 1,
        rule: 'r',
      },
      {
        source: 'lint',
        lang: 'js',
        severity: 'warning',
        message: 'warn third',
        path: '/a.js',
        line: 1,
        column: 1,
        rule: 'r',
      },
    ]);
    const errIdx = formatted.indexOf('error second');
    const warnIdx = formatted.indexOf('warn third');
    const infoIdx = formatted.indexOf('info first');
    expect(errIdx).toBeLessThan(warnIdx);
    expect(warnIdx).toBeLessThan(infoIdx);
  });
});

describe('staticValidationService: stats', () => {
  // 驗收 9:100KB JS < 200ms (warm-up 後)
  it('validates 100KB JS in under 200ms after warm-up', async () => {
    // 構造 ≈ 100KB 的有效 JS (註解填充,語法正確)
    const filler = '// ' + 'a'.repeat(120) + '\n';
    const lines = Math.ceil(100_000 / filler.length) + 10;
    const big = (filler.repeat(lines)).trim() + '\nexport const x = 1;';
    expect(big.length).toBeGreaterThan(100_000);
    const result = await validateProjectFiles([{ path: '/big.js', content: big }]);
    expect(result.stats.engine).toBe('lightweight-v1');
    expect(result.stats.durationMs).toBeLessThan(200);
    // valid JS
    expect(result.ok).toBe(true);
  });
});
