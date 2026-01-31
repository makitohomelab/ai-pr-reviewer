/**
 * TypeScript/JavaScript Import Resolver
 */
import type { ImportResolver } from './types.js';

const IMPORT_PATTERNS = [
  /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
];

const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

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

export class TypeScriptResolver implements ImportResolver {
  readonly language = 'typescript';
  readonly extensions = CODE_EXTENSIONS;

  extractImports(source: string): string[] {
    const imports = new Set<string>();
    for (const pattern of IMPORT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(source)) !== null) {
        imports.add(match[1]);
      }
    }
    return [...imports];
  }

  isLocalImport(specifier: string): boolean {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      return true;
    }
    if (specifier.startsWith('src/') || specifier.startsWith('lib/')) {
      return true;
    }
    return false;
  }

  resolveImportPath(specifier: string, fromFile: string): string | null {
    if (!this.isLocalImport(specifier)) {
      return null;
    }

    let resolved: string;
    if (specifier.startsWith('.')) {
      const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
      resolved = normalizePath(`${dir}/${specifier}`);
    } else {
      resolved = specifier;
    }

    resolved = resolved.replace(/\.js$/, '');
    return resolved;
  }

  getCandidatePaths(resolvedPath: string): string[] {
    if (CODE_EXTENSIONS.some((ext) => resolvedPath.endsWith(ext))) {
      return [resolvedPath];
    }
    return [
      `${resolvedPath}.ts`,
      `${resolvedPath}.tsx`,
      `${resolvedPath}.js`,
      `${resolvedPath}.jsx`,
      `${resolvedPath}/index.ts`,
      `${resolvedPath}/index.tsx`,
      `${resolvedPath}/index.js`,
      `${resolvedPath}/index.jsx`,
    ];
  }
}
