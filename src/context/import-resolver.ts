/**
 * Import Resolver
 *
 * Parses import/require statements from TypeScript/JavaScript files
 * and resolves them to local file paths. External packages are skipped.
 */

const IMPORT_PATTERNS = [
  // import ... from '...'
  /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  // import '...'
  /import\s+['"]([^'"]+)['"]/g,
  // require('...')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // export ... from '...'
  /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
];

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Extract import specifiers from source code.
 */
export function extractImports(source: string): string[] {
  const imports = new Set<string>();

  for (const pattern of IMPORT_PATTERNS) {
    // Reset lastIndex for each use
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(source)) !== null) {
      imports.add(match[1]);
    }
  }

  return [...imports];
}

/**
 * Check if an import specifier is a local/relative import (not an external package).
 */
export function isLocalImport(specifier: string): boolean {
  // Relative paths
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return true;
  }
  // Project-local paths (e.g. src/lib/foo)
  if (specifier.startsWith('src/') || specifier.startsWith('lib/')) {
    return true;
  }
  return false;
}

/**
 * Resolve an import specifier to a project-relative file path.
 *
 * @param specifier - The import specifier (e.g. './foo', '../lib/bar')
 * @param fromFile - The file containing the import (project-relative path)
 * @returns Resolved project-relative path, or null if external
 */
export function resolveImportPath(
  specifier: string,
  fromFile: string
): string | null {
  if (!isLocalImport(specifier)) {
    return null;
  }

  let resolved: string;

  if (specifier.startsWith('.')) {
    // Relative import — resolve against the importing file's directory
    const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
    resolved = normalizePath(`${dir}/${specifier}`);
  } else {
    // Project-root import (src/lib/foo)
    resolved = specifier;
  }

  // Strip .js extension (TypeScript emits .js but source is .ts)
  resolved = resolved.replace(/\.js$/, '');

  return resolved;
}

/**
 * Given a resolved path (without extension), return candidate file paths to try.
 */
export function getCandidatePaths(resolvedPath: string): string[] {
  // If it already has a code extension, return as-is
  if (CODE_EXTENSIONS.some((ext) => resolvedPath.endsWith(ext))) {
    return [resolvedPath];
  }

  // Order by likelihood: .ts first, then .tsx, then .js/.jsx, then index files
  const candidates: string[] = [
    `${resolvedPath}.ts`,
    `${resolvedPath}.tsx`,
    `${resolvedPath}.js`,
    `${resolvedPath}.jsx`,
    `${resolvedPath}/index.ts`,
    `${resolvedPath}/index.tsx`,
    `${resolvedPath}/index.js`,
    `${resolvedPath}/index.jsx`,
  ];
  return candidates;
}

/**
 * Normalize a path by resolving . and .. segments.
 */
function normalizePath(path: string): string {
  const parts = path.split('/');
  const normalized: string[] = [];

  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      normalized.pop();
    } else {
      normalized.push(part);
    }
  }

  return normalized.join('/');
}

/**
 * Resolve all local imports from a set of changed files.
 * Returns a map of base path → candidate file paths (ordered by likelihood).
 *
 * @param fileContents - Map of filepath → full file content for changed files
 * @returns Map of base path → candidate paths to try
 */
export function resolveAllImports(
  fileContents: Map<string, string>
): Map<string, string[]> {
  const importGroups = new Map<string, string[]>();
  const changedFiles = new Set(fileContents.keys());

  for (const [filepath, content] of fileContents) {
    // Only process code files
    if (!CODE_EXTENSIONS.some((ext) => filepath.endsWith(ext))) {
      continue;
    }

    const imports = extractImports(content);

    for (const specifier of imports) {
      const resolved = resolveImportPath(specifier, filepath);
      if (!resolved) continue;

      // Skip if already grouped
      if (importGroups.has(resolved)) continue;

      const candidates = getCandidatePaths(resolved).filter(
        (c) => !changedFiles.has(c)
      );
      if (candidates.length > 0) {
        importGroups.set(resolved, candidates);
      }
    }
  }

  return importGroups;
}
