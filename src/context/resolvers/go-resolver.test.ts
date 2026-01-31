import { describe, it, expect } from 'vitest';
import { GoResolver } from './go-resolver.js';

const resolver = new GoResolver();

describe('GoResolver', () => {
  describe('extractImports', () => {
    it('extracts single imports', () => {
      const source = `import "fmt"\nimport "myproject/utils"`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('fmt');
      expect(imports).toContain('myproject/utils');
    });

    it('extracts import blocks', () => {
      const source = `import (\n\t"fmt"\n\t"os"\n\tlog "myproject/logger"\n)`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('fmt');
      expect(imports).toContain('os');
      expect(imports).toContain('myproject/logger');
    });
  });

  describe('isLocalImport', () => {
    it('relative imports are local', () => {
      expect(resolver.isLocalImport('./utils')).toBe(true);
      expect(resolver.isLocalImport('../shared')).toBe(true);
    });

    it('stdlib is external', () => {
      expect(resolver.isLocalImport('fmt')).toBe(false);
      expect(resolver.isLocalImport('os')).toBe(false);
    });

    it('known domains are external', () => {
      expect(resolver.isLocalImport('github.com/pkg/errors')).toBe(false);
      expect(resolver.isLocalImport('golang.org/x/net')).toBe(false);
    });

    it('multi-segment unknown paths are local', () => {
      expect(resolver.isLocalImport('myproject/utils')).toBe(true);
      expect(resolver.isLocalImport('internal/config')).toBe(true);
    });
  });

  describe('resolveImportPath', () => {
    it('resolves relative imports', () => {
      expect(resolver.resolveImportPath('./utils', 'cmd/main.go')).toBe('cmd/utils');
      expect(resolver.resolveImportPath('../pkg', 'cmd/sub/main.go')).toBe('cmd/pkg');
    });

    it('passes through local absolute paths', () => {
      expect(resolver.resolveImportPath('internal/config', 'cmd/main.go')).toBe('internal/config');
    });

    it('returns null for external', () => {
      expect(resolver.resolveImportPath('fmt', 'main.go')).toBeNull();
      expect(resolver.resolveImportPath('github.com/pkg/errors', 'main.go')).toBeNull();
    });
  });

  describe('getCandidatePaths', () => {
    it('generates .go and dir candidates', () => {
      const candidates = resolver.getCandidatePaths('internal/config');
      expect(candidates).toEqual(['internal/config.go', 'internal/config']);
    });

    it('returns as-is if already has .go', () => {
      expect(resolver.getCandidatePaths('main.go')).toEqual(['main.go']);
    });
  });
});
