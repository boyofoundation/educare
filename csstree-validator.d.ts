// Local minimal type shim for csstree-validator (no upstream typings)。
// 套件提供 validate(css) 與 helpers;僅 expose 靜態驗證服務需要的最小介面。
declare module 'csstree-validator' {
  export interface ValidationIssue {
    property?: string;
    message: string;
    line?: number;
    column?: number;
  }
  export function validate(css: string): ValidationIssue[];
  // 其餘 helpers/reporter 不在 MVP 使用範圍,顯式不型別
  const _default: { validate: (css: string) => ValidationIssue[] };
  export default _default;
}
