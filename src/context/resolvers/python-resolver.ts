/**
 * Python Import Resolver
 */
import type { ImportResolver } from './types.js';

const IMPORT_PATTERNS = [
  // from x.y.z import a, b
  /^from\s+([\w.]+)\s+import\s/gm,
  // from . import x  /  from .. import x  /  from .foo import x
  /^from\s+(\.+[\w.]*)\s+import\s/gm,
  // import x.y.z
  /^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm,
];

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

export class PythonResolver implements ImportResolver {
  readonly language = 'python';
  readonly extensions = ['.py'];

  extractImports(source: string): string[] {
    const imports = new Set<string>();

    // from x import y  /  from .x import y
    for (const match of source.matchAll(/^from\s+(\.+[\w.]*|[\w.]+)\s+import\s/gm)) {
      imports.add(match[1]);
    }

    // import x, y, z (each is a separate module)
    for (const match of source.matchAll(/^import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
      for (const mod of match[1].split(',')) {
        imports.add(mod.trim());
      }
    }

    return [...imports];
  }

  isLocalImport(specifier: string): boolean {
    // Relative imports are always local
    if (specifier.startsWith('.')) {
      return true;
    }
    // Single-word imports are likely stdlib/external (os, sys, requests)
    if (!specifier.includes('.')) {
      return false;
    }
    // Multi-segment dotted imports assumed local (myapp.utils)
    return true;
  }

  resolveImportPath(specifier: string, fromFile: string): string | null {
    if (!this.isLocalImport(specifier)) {
      return null;
    }

    const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));

    if (specifier.startsWith('.')) {
      // Count leading dots for relative level
      const dotMatch = specifier.match(/^(\.+)(.*)/);
      if (!dotMatch) return null;

      const dots = dotMatch[1].length;
      const rest = dotMatch[2];

      // Go up (dots - 1) directories from current dir
      let base = dir;
      for (let i = 1; i < dots; i++) {
        const slash = base.lastIndexOf('/');
        base = slash >= 0 ? base.substring(0, slash) : '';
      }

      if (rest) {
        // .foo.bar → foo/bar
        const segments = rest.replace(/^\./, '').split('.');
        return normalizePath(`${base}/${segments.join('/')}`);
      }
      // bare relative (from . import x) — points to package dir
      return base || null;
    }

    // Absolute dotted import: myapp.utils → myapp/utils
    return specifier.split('.').join('/');
  }

  getCandidatePaths(resolvedPath: string): string[] {
    if (resolvedPath.endsWith('.py')) {
      return [resolvedPath];
    }
    return [
      `${resolvedPath}.py`,
      `${resolvedPath}/__init__.py`,
    ];
  }
}
