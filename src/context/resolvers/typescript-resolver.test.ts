import { describe, it, expect } from 'vitest';
import { TypeScriptResolver } from './typescript-resolver.js';

const resolver = new TypeScriptResolver();

describe('TypeScriptResolver', () => {
  describe('extractImports', () => {
    it('extracts ES module imports', () => {
      const source = `
import { foo } from './foo.js';
import type { Bar } from '../lib/bar.js';
import * as baz from 'src/utils/baz.js';
      `;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('./foo.js');
      expect(imports).toContain('../lib/bar.js');
      expect(imports).toContain('src/utils/baz.js');
    });

    it('extracts require calls', () => {
      const source = `const fs = require('node:fs');\nconst lib = require('./lib');`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('node:fs');
      expect(imports).toContain('./lib');
    });

    it('extracts re-exports', () => {
      const source = `export { thing } from './thing.js';`;
      expect(resolver.extractImports(source)).toContain('./thing.js');
    });
  });

  describe('isLocalImport', () => {
    it('identifies relative imports as local', () => {
      expect(resolver.isLocalImport('./foo')).toBe(true);
      expect(resolver.isLocalImport('../bar')).toBe(true);
    });

    it('rejects external packages', () => {
      expect(resolver.isLocalImport('@octokit/rest')).toBe(false);
      expect(resolver.isLocalImport('vitest')).toBe(false);
    });
  });

  describe('resolveImportPath', () => {
    it('resolves relative imports', () => {
      expect(resolver.resolveImportPath('./utils.js', 'src/lib/main.ts')).toBe('src/lib/utils');
    });

    it('returns null for external', () => {
      expect(resolver.resolveImportPath('@octokit/rest', 'src/index.ts')).toBeNull();
    });
  });

  describe('getCandidatePaths', () => {
    it('generates extension variants', () => {
      const candidates = resolver.getCandidatePaths('src/lib/utils');
      expect(candidates).toContain('src/lib/utils.ts');
      expect(candidates).toContain('src/lib/utils/index.ts');
    });

    it('returns as-is if already has extension', () => {
      expect(resolver.getCandidatePaths('src/lib/utils.ts')).toEqual(['src/lib/utils.ts']);
    });
  });
});
