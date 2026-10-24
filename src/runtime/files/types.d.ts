export interface AnchorSpec {
  readonly kind: 'exact' | 'regex';
  readonly text: string;
}
export interface GrepHit {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}
export interface StagedMutation {
  readonly kind: 'rewrite' | 'create';
  readonly path: string;
  readonly originalText?: string;
  readonly newText?: string;
  readonly text?: string;
}
export interface VisibleEntry {
  readonly name: string;
  readonly isDir: boolean;
}
export type VisibleEntriesResult =
  | { readonly ok: true; readonly entries: readonly VisibleEntry[]; readonly value: { readonly entries: readonly VisibleEntry[] } }
  | { readonly ok: false; readonly code: string; readonly reason: string };
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly reason: string };
export interface Filesystem {
  readUtf8(path: string): Result<string>;
  readUtf8Classified(path: string): Result<string>;
  visibleEntries(root: string, path: string): VisibleEntriesResult;
  visibleEntries(path: string): VisibleEntriesResult;
  glob(pattern: string): Promise<Result<{ readonly paths: readonly string[] }>>;
  grep(needle: string | AnchorSpec, pattern: string): Promise<Result<{ readonly matches: readonly GrepHit[] }>>;
  findAnchor(text: string, declaration: AnchorSpec, occurrence: number): Result<readonly [number, number]>;
  requireUnique(text: string, declaration: AnchorSpec): Result<readonly [number, number]>;
  validateSingleIntent(mutations: readonly StagedMutation[]): Result<null>;
  validateTargets(existing: readonly string[], mutations: readonly StagedMutation[]): Result<null>;
  validateFreshness(current: Readonly<Record<string, string | null>>, mutations: readonly StagedMutation[]): Result<null>;
  preflight(
    existing: readonly string[],
    current: Readonly<Record<string, string | null>>,
    readSnapshots: readonly { path: string; text: string }[],
    mutations: readonly StagedMutation[]
  ): Result<null>;
  commitPlan(mutations: readonly StagedMutation[]): Result<readonly object[]>;
  rollbackPlan(mutations: readonly StagedMutation[]): Result<readonly object[]>;
  applyCommit(mutations: readonly StagedMutation[]): Result<null>;
  applyRollback(mutations: readonly StagedMutation[]): void;
  resolveToolPath(path: string): string;
  resolveBounded(path: string): Result<string>;
  existsPath(path: string): boolean;
  undoIfMatches(path: string, expectedCurrent: string, restoreTo: string | null): void;
  matchesPathPattern(pattern: string, path: string): Result<boolean>;
  compilePattern(pattern: string): Result<RegExp>;
  testCompiled(regex: RegExp, text: string): boolean;
}
export const Filesystem: (input: { readonly root: string }) => Filesystem;
