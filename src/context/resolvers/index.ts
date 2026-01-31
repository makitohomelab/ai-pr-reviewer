/**
 * Resolver Registry
 *
 * Maps file extensions to language-specific import resolvers.
 */
import type { ImportResolver } from './types.js';
import { TypeScriptResolver } from './typescript-resolver.js';
import { PythonResolver } from './python-resolver.js';
import { GoResolver } from './go-resolver.js';

export type { ImportResolver } from './types.js';
export { TypeScriptResolver } from './typescript-resolver.js';
export { PythonResolver } from './python-resolver.js';
export { GoResolver } from './go-resolver.js';

const resolvers: ImportResolver[] = [
  new TypeScriptResolver(),
  new PythonResolver(),
  new GoResolver(),
];

const extensionMap = new Map<string, ImportResolver>();
for (const resolver of resolvers) {
  for (const ext of resolver.extensions) {
    extensionMap.set(ext, resolver);
  }
}

/**
 * Get the appropriate resolver for a file based on its extension.
 */
export function getResolverForFile(filepath: string): ImportResolver | null {
  for (const [ext, resolver] of extensionMap) {
    if (filepath.endsWith(ext)) {
      return resolver;
    }
  }
  return null;
}

/**
 * Get all file extensions supported by registered resolvers.
 */
export function getSupportedExtensions(): string[] {
  return [...extensionMap.keys()];
}
