/**
 * parse5 錯誤碼分流表 (Phase 1 靜態驗證 MVP)。
 *
 * 設計目標：
 * - 讓 LLM 在收到 diagnostic 時只看到「真的會壞」的問題（error 級）
 * - 雜訊碼（missing-doctype、`<div/>` 結尾斜線）降到 info 級或直接丟棄
 * - 集中單檔方便上線後以真實 agent 輸出校準（見計畫 R-1）
 *
 * 分流原則：
 * - 「error」級：影響瀏覽器解析、可能導致 silent render 出錯、agent 重寫時必須知道的
 * - 「info」級：規格違規但主流瀏覽器仍寬容解析、且 LLM 重寫會被誤導的
 * - 未列入：丟棄（dump 到 console.warn 供後續校準收集）
 */

// ---------------------------------------------------------------------------
// 'error' 級：放行給 LLM
// 這些錯誤碼代表結構性損壞,影響 script/style 抽取與渲染,
// 對 agent 修正迴圈有實質價值。
// ---------------------------------------------------------------------------
export const HTML_PARSE_ERROR_CODES = [
  // 屬性語法
  'duplicate-attribute',
  'missing-attribute-value',
  'missing-whitespace-between-attributes',
  'unexpected-character-in-attribute-name',
  'unexpected-equals-sign-before-attribute-name',

  // 標籤邊界
  'end-tag-with-attributes',
  'end-tag-without-matching-open-element',
  'closing-of-element-with-open-child-elements',
  'invalid-first-character-of-tag-name',
  'missing-end-tag-name',
  'open-elements-left-after-eof',

  // EOF 相關(模板/字串截斷常見)
  'eof-in-tag',
  'eof-in-comment',
  'eof-in-cdata',
  'eof-in-doctype',
  'eof-in-element-that-can-contain-only-text',
  'eof-in-script-html-comment-like-text',

  // 註解/CDATA
  'incorrectly-closed-comment',
  'nested-comment',
  'cdata-in-html-content',
] as const;

// ---------------------------------------------------------------------------
// 'info' 級:雜訊但允許保留,降級不阻塞
// ---------------------------------------------------------------------------
export const HTML_PARSE_INFO_CODES = [
  'missing-doctype',
  'non-conforming-doctype',
  'misplaced-doctype',
  'non-void-html-element-start-tag-with-trailing-solidus',
  'incorrectly-opened-comment',
] as const;

export type HtmlParseErrorSeverity = 'error' | 'info' | null;

/**
 * 將 parse5 錯誤碼分流為 schema severity。
 * 未列入兩表的碼統一丟棄（保留 return null 讓呼叫端 console.warn 收集校準信號）。
 */
export const classifyHtmlParseError = (code: string): HtmlParseErrorSeverity => {
  if ((HTML_PARSE_ERROR_CODES as readonly string[]).includes(code)) {
    return 'error';
  }
  if ((HTML_PARSE_INFO_CODES as readonly string[]).includes(code)) {
    return 'info';
  }
  return null;
};

/**
 * 內建已知錯誤碼集合(給格式化器/測試使用,避免動態拼字)。
 * 結構: { errorCodes: Set, infoCodes: Set }
 */
export const HTML_PARSE_KNOWN_CODES = {
  error: new Set<string>(HTML_PARSE_ERROR_CODES),
  info: new Set<string>(HTML_PARSE_INFO_CODES),
} as const;
