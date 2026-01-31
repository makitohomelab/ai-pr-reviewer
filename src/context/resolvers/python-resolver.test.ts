import { describe, it, expect } from 'vitest';
import { PythonResolver } from './python-resolver.js';

const resolver = new PythonResolver();

describe('PythonResolver', () => {
  describe('extractImports', () => {
    it('extracts from-imports', () => {
      const source = `from myapp.utils import helper\nfrom os.path import join`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('myapp.utils');
      expect(imports).toContain('os.path');
    });

    it('extracts relative imports', () => {
      const source = `from . import sibling\nfrom ..utils import thing\nfrom ...deep import val`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('.');
      expect(imports).toContain('..utils');
      expect(imports).toContain('...deep');
    });

    it('extracts plain imports', () => {
      const source = `import os\nimport sys, json\nimport myapp.models`;
      const imports = resolver.extractImports(source);
      expect(imports).toContain('os');
      expect(imports).toContain('sys');
      expect(imports).toContain('json');
      expect(imports).toContain('myapp.models');
    });
  });

  describe('isLocalImport', () => {
    it('relative imports are local', () => {
      expect(resolver.isLocalImport('.')).toBe(true);
      expect(resolver.isLocalImport('.foo')).toBe(true);
      expect(resolver.isLocalImport('..utils')).toBe(true);
    });

    it('single-word imports are external', () => {
      expect(resolver.isLocalImport('os')).toBe(false);
      expect(resolver.isLocalImport('requests')).toBe(false);
    });

    it('dotted imports are local', () => {
      expect(resolver.isLocalImport('myapp.utils')).toBe(true);
      expect(resolver.isLocalImport('myapp.models.user')).toBe(true);
    });
  });

  describe('resolveImportPath', () => {
    it('resolves relative single-dot import', () => {
      expect(resolver.resolveImportPath('.utils', 'myapp/views.py')).toBe('myapp/utils');
    });

    it('resolves relative double-dot import', () => {
      expect(resolver.resolveImportPath('..utils', 'myapp/sub/views.py')).toBe('myapp/utils');
    });

    it('resolves bare dot import to package dir', () => {
      expect(resolver.resolveImportPath('.', 'myapp/sub/views.py')).toBe('myapp/sub');
    });

    it('resolves absolute dotted import', () => {
      expect(resolver.resolveImportPath('myapp.utils', 'any/file.py')).toBe('myapp/utils');
    });

    it('returns null for external', () => {
      expect(resolver.resolveImportPath('os', 'myapp/views.py')).toBeNull();
    });
  });

  describe('getCandidatePaths', () => {
    it('generates .py and __init__.py candidates', () => {
      const candidates = resolver.getCandidatePaths('myapp/utils');
      expect(candidates).toEqual(['myapp/utils.py', 'myapp/utils/__init__.py']);
    });

    it('returns as-is if already has .py', () => {
      expect(resolver.getCandidatePaths('myapp/utils.py')).toEqual(['myapp/utils.py']);
    });
  });
});
