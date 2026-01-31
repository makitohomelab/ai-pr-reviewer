import { describe, it, expect } from 'vitest';
import {
  extractImports,
  isLocalImport,
  resolveImportPath,
  getCandidatePaths,
  resolveAllImports,
} from './import-resolver.js';

describe('extractImports', () => {
  it('extracts ES module imports', () => {
    const source = `
import { foo } from './foo.js';
import type { Bar } from '../lib/bar.js';
import * as baz from 'src/utils/baz.js';
    `;
    const imports = extractImports(source);
    expect(imports).toContain('./foo.js');
    expect(imports).toContain('../lib/bar.js');
    expect(imports).toContain('src/utils/baz.js');
  });

  it('extracts require calls', () => {
    const source = `const fs = require('node:fs');\nconst lib = require('./lib');`;
    const imports = extractImports(source);
    expect(imports).toContain('node:fs');
    expect(imports).toContain('./lib');
  });

  it('extracts re-exports', () => {
    const source = `export { thing } from './thing.js';`;
    expect(extractImports(source)).toContain('./thing.js');
  });

  it('extracts side-effect imports', () => {
    const source = `import './polyfill.js';`;
    expect(extractImports(source)).toContain('./polyfill.js');
  });

  it('deduplicates imports', () => {
    const source = `
import { a } from './shared.js';
import { b } from './shared.js';
    `;
    const imports = extractImports(source);
    expect(imports.filter((i) => i === './shared.js')).toHaveLength(1);
  });
});

describe('isLocalImport', () => {
  it('identifies relative imports', () => {
    expect(isLocalImport('./foo')).toBe(true);
    expect(isLocalImport('../bar')).toBe(true);
  });

  it('identifies project-local imports', () => {
    expect(isLocalImport('src/lib/utils')).toBe(true);
  });

  it('rejects external packages', () => {
    expect(isLocalImport('@octokit/rest')).toBe(false);
    expect(isLocalImport('node:fs')).toBe(false);
    expect(isLocalImport('vitest')).toBe(false);
  });
});

describe('resolveImportPath', () => {
  it('resolves relative imports', () => {
    expect(resolveImportPath('./utils.js', 'src/lib/main.ts')).toBe('src/lib/utils');
    expect(resolveImportPath('../shared.js', 'src/agents/security.ts')).toBe('src/shared');
  });

  it('passes through project-root imports', () => {
    expect(resolveImportPath('src/lib/foo.js', 'src/index.ts')).toBe('src/lib/foo');
  });

  it('returns null for external packages', () => {
    expect(resolveImportPath('@octokit/rest', 'src/index.ts')).toBeNull();
  });
});

describe('getCandidatePaths', () => {
  it('generates extension variants', () => {
    const candidates = getCandidatePaths('src/lib/utils');
    expect(candidates).toContain('src/lib/utils.ts');
    expect(candidates).toContain('src/lib/utils.tsx');
    expect(candidates).toContain('src/lib/utils/index.ts');
  });

  it('returns as-is if already has extension', () => {
    expect(getCandidatePaths('src/lib/utils.ts')).toEqual(['src/lib/utils.ts']);
  });
});

describe('resolveAllImports', () => {
  it('resolves imports across multiple files', () => {
    const files = new Map([
      ['src/index.ts', "import { foo } from './lib/foo.js';"],
      ['src/agents/security.ts', "import { bar } from '../lib/bar.js';"],
    ]);
    const groups = resolveAllImports(files);
    const allCandidates = [...groups.values()].flat();
    expect(allCandidates).toContain('src/lib/foo.ts');
    expect(allCandidates).toContain('src/lib/bar.ts');
  });

  it('excludes changed files from candidates', () => {
    const files = new Map([
      ['src/index.ts', "import { foo } from './lib/foo.js';"],
      ['src/lib/foo.ts', "export const foo = 1;"],
    ]);
    const groups = resolveAllImports(files);
    const allCandidates = [...groups.values()].flat();
    expect(allCandidates).not.toContain('src/lib/foo.ts');
  });

  it('skips non-code files', () => {
    const files = new Map([
      ['README.md', "import { foo } from './foo.js';"],
    ]);
    expect(resolveAllImports(files).size).toBe(0);
  });

  it('deduplicates across files', () => {
    const files = new Map([
      ['src/a.ts', "import { x } from './shared.js';"],
      ['src/b.ts', "import { y } from './shared.js';"],
    ]);
    const groups = resolveAllImports(files);
    // Both files import the same module — should only appear once
    const sharedGroups = [...groups.keys()].filter((k) => k.includes('shared'));
    expect(sharedGroups).toHaveLength(1);
  });
});
