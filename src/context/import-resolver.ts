/**
 * Import Resolver
 *
 * Parses import/require statements from source files
 * and resolves them to local file paths. External packages are skipped.
 *
 * Delegates to language-specific resolvers for multi-language support.
 */

import { TypeScriptResolver } from './resolvers/typescript-resolver.js';
import { getResolverForFile, getSupportedExtensions } from './resolvers/index.js';

// Default resolver for backward-compatible standalone functions
const tsResolver = new TypeScriptResolver();

/**
 * Extract import specifiers from source code.
 * Uses TypeScript resolver for backward compatibility.
 */
export function extractImports(source: string): string[] {
  return tsResolver.extractImports(source);
}

/**
 * Check if an import specifier is a local/relative import (not an external package).
 * Uses TypeScript resolver for backward compatibility.
 */
export function isLocalImport(specifier: string): boolean {
  return tsResolver.isLocalImport(specifier);
}

/**
 * Resolve an import specifier to a project-relative file path.
 * Uses TypeScript resolver for backward compatibility.
 */
export function resolveImportPath(
  specifier: string,
  fromFile: string
): string | null {
  return tsResolver.resolveImportPath(specifier, fromFile);
}

/**
 * Given a resolved path (without extension), return candidate file paths to try.
 * Uses TypeScript resolver for backward compatibility.
 */
export function getCandidatePaths(resolvedPath: string): string[] {
  return tsResolver.getCandidatePaths(resolvedPath);
}

/**
 * Resolve all local imports from a set of changed files.
 * Supports all registered languages (TypeScript, Python, Go).
 *
 * @param fileContents - Map of filepath → full file content for changed files
 * @returns Map of base path → candidate paths to try
 */
export function resolveAllImports(
  fileContents: Map<string, string>
): Map<string, string[]> {
  const importGroups = new Map<string, string[]>();
  const changedFiles = new Set(fileContents.keys());
  const supportedExtensions = getSupportedExtensions();

  for (const [filepath, content] of fileContents) {
    const resolver = getResolverForFile(filepath);
    if (!resolver) continue;

    const imports = resolver.extractImports(content);

    for (const specifier of imports) {
      const resolved = resolver.resolveImportPath(specifier, filepath);
      if (!resolved) continue;

      if (importGroups.has(resolved)) continue;

      const candidates = resolver.getCandidatePaths(resolved).filter(
        (c) => !changedFiles.has(c)
      );
      if (candidates.length > 0) {
        importGroups.set(resolved, candidates);
      }
    }
  }

  return importGroups;
}
