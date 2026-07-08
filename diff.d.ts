// Local minimal type shim for jsdiff `diff` package (5.x ships no bundled typings,
// and @types/diff@8 is a deprecated stub that resolves no symbols for diff 5.x).
// Mirrors the csstree-validator.d.ts pattern. Exposes only the surface used by
// htmlProjectGitService (unified diff generation for the git diff tool).
declare module 'diff' {
  export interface DiffChange {
    count?: number;
    value: string;
    added?: boolean;
    removed?: boolean;
  }

  export interface DiffOptions {
    maxEditLength?: number;
    ignoreCase?: boolean;
    newlineIsToken?: boolean;
    stripTrailingCr?: boolean;
  }

  export interface PatchOptions extends DiffOptions {
    /** Number of context lines surrounding each hunk (default 4). */
    context?: number;
  }

  export function diffLines(oldStr: string, newStr: string, options?: DiffOptions): DiffChange[];
  export function diffWords(oldStr: string, newStr: string, options?: DiffOptions): DiffChange[];
  export function diffChars(oldStr: string, newStr: string, options?: DiffOptions): DiffChange[];

  /**
   * Produces a unified diff patch string. Used by the git diff tool to render
   * per-file changes between two refs (or working tree vs HEAD).
   */
  export function createPatch(
    fileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: PatchOptions,
  ): string;

  const _default: {
    diffLines: typeof diffLines;
    diffWords: typeof diffWords;
    diffChars: typeof diffChars;
    createPatch: typeof createPatch;
  };
  export default _default;
}
