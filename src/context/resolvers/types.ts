/**
 * ImportResolver interface
 *
 * Language-specific import resolution for smart context.
 */
export interface ImportResolver {
  readonly language: string;
  readonly extensions: string[];
  extractImports(source: string): string[];
  isLocalImport(specifier: string): boolean;
  resolveImportPath(specifier: string, fromFile: string): string | null;
  getCandidatePaths(resolvedPath: string): string[];
}
