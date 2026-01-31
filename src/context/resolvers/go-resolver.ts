/**
 * Go Import Resolver
 */
import type { ImportResolver } from './types.js';

const EXTERNAL_DOMAINS = [
  'github.com/',
  'gitlab.com/',
  'bitbucket.org/',
  'golang.org/',
  'google.golang.org/',
  'gopkg.in/',
  'go.uber.org/',
  'cloud.google.com/',
  'k8s.io/',
];

export class GoResolver implements ImportResolver {
  readonly language = 'go';
  readonly extensions = ['.go'];

  extractImports(source: string): string[] {
    const imports = new Set<string>();

    // Single import: import "path"
    for (const match of source.matchAll(/^import\s+"([^"]+)"/gm)) {
      imports.add(match[1]);
    }

    // Import block: import ( "path" \n "path2" )
    for (const match of source.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
      const block = match[1];
      for (const line of block.matchAll(/\s*(?:\w+\s+)?"([^"]+)"/g)) {
        imports.add(line[1]);
      }
    }

    return [...imports];
  }

  isLocalImport(specifier: string): boolean {
    // Relative imports
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      return true;
    }
    // Known external domains
    if (EXTERNAL_DOMAINS.some((d) => specifier.startsWith(d))) {
      return false;
    }
    // Standard library: single segment (fmt, os, net) or known prefixes
    if (!specifier.includes('/')) {
      return false;
    }
    // Multi-segment without known domain — assume local package
    return true;
  }

  resolveImportPath(specifier: string, fromFile: string): string | null {
    if (!this.isLocalImport(specifier)) {
      return null;
    }

    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const dir = fromFile.substring(0, fromFile.lastIndexOf('/'));
      const parts = `${dir}/${specifier}`.split('/');
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

    // Absolute local import path — use as-is
    return specifier;
  }

  getCandidatePaths(resolvedPath: string): string[] {
    if (resolvedPath.endsWith('.go')) {
      return [resolvedPath];
    }
    // Go imports are package-level (directories), try both file and dir
    return [
      `${resolvedPath}.go`,
      resolvedPath,
    ];
  }
}
