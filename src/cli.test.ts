import { describe, it, expect } from 'vitest';
import { parseArgs, parseDiffToFileChanges } from './cli.js';

describe('parseArgs', () => {
  // Helper: simulate process.argv with first two entries
  const argv = (...args: string[]) => ['node', 'cli.js', ...args];

  it('--diff sets diff: true', () => {
    expect(parseArgs(argv('--diff'))).toMatchObject({ diff: true });
  });

  it('-d short form works', () => {
    expect(parseArgs(argv('-d'))).toMatchObject({ diff: true });
  });

  it('--diff --title sets both fields', () => {
    const result = parseArgs(argv('--diff', '--title', 'my changes'));
    expect(result).toMatchObject({ diff: true, title: 'my changes' });
  });

  it('-t short form works', () => {
    expect(parseArgs(argv('-t', 'foo'))).toMatchObject({ title: 'foo' });
  });

  it('--diff with --output json combines correctly', () => {
    const result = parseArgs(argv('--diff', '--output', 'json'));
    expect(result).toMatchObject({ diff: true, output: 'json' });
  });

  it('--diff without --pr/--repo is valid', () => {
    const result = parseArgs(argv('--diff'));
    expect(result.pr).toBeUndefined();
    expect(result.repo).toBeUndefined();
    expect(result.diff).toBe(true);
  });

  it('existing PR mode args still work', () => {
    const result = parseArgs(argv('--pr', '42', '--repo', 'owner/repo', '--output', 'markdown'));
    expect(result).toMatchObject({ pr: 42, repo: 'owner/repo', output: 'markdown' });
  });

  it('--help sets help: true', () => {
    expect(parseArgs(argv('--help'))).toMatchObject({ help: true });
  });

  it('-h short form works', () => {
    expect(parseArgs(argv('-h'))).toMatchObject({ help: true });
  });

  it('-p short form works for PR number', () => {
    expect(parseArgs(argv('-p', '10'))).toMatchObject({ pr: 10 });
  });

  it('-r short form works for repo', () => {
    expect(parseArgs(argv('-r', 'a/b'))).toMatchObject({ repo: 'a/b' });
  });
});

describe('parseDiffToFileChanges', () => {
  it('single modified file', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts
index 1234567..abcdefg 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
-const c = 3;
 const d = 4;
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('src/app.ts');
    expect(files[0].status).toBe('modified');
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  it('new file → status: added', () => {
    const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abcdefg
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+const x = 1;
+const y = 2;
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('added');
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(0);
  });

  it('deleted file → status: removed', () => {
    const diff = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abcdefg..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-const y = 2;
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('removed');
    expect(files[0].deletions).toBe(2);
    expect(files[0].additions).toBe(0);
  });

  it('renamed file → status: renamed', () => {
    const diff = `diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
index 1234567..abcdefg 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1,2 +1,2 @@
 const x = 1;
-const y = 2;
+const y = 3;
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe('renamed');
    expect(files[0].filename).toBe('src/new.ts');
  });

  it('multiple files in one diff', () => {
    const diff = `diff --git a/a.ts b/a.ts
index 1234..5678 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1,2 @@
 line1
+line2
diff --git a/b.ts b/b.ts
index abcd..efgh 100644
--- a/b.ts
+++ b/b.ts
@@ -1 +1,2 @@
 line1
+line2
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(2);
    expect(files[0].filename).toBe('a.ts');
    expect(files[1].filename).toBe('b.ts');
  });

  it('empty string → returns []', () => {
    expect(parseDiffToFileChanges('')).toEqual([]);
  });

  it('malformed diff (no diff --git header) → returns []', () => {
    expect(parseDiffToFileChanges('just some random text\nwith lines\n')).toEqual([]);
  });

  it('+++/--- lines not counted as additions/deletions', () => {
    const diff = `diff --git a/f.ts b/f.ts
index 1234..5678 100644
--- a/f.ts
+++ b/f.ts
@@ -1,2 +1,2 @@
-old line
+new line
`;
    const files = parseDiffToFileChanges(diff);
    expect(files[0].additions).toBe(1);
    expect(files[0].deletions).toBe(1);
  });

  it('binary file (no hunk content) → 0 additions, 0 deletions', () => {
    const diff = `diff --git a/image.png b/image.png
index 1234..5678 100644
Binary files a/image.png and b/image.png differ
`;
    const files = parseDiffToFileChanges(diff);
    expect(files).toHaveLength(1);
    expect(files[0].additions).toBe(0);
    expect(files[0].deletions).toBe(0);
  });

  it('multi-hunk diff → correct totals', () => {
    const diff = `diff --git a/f.ts b/f.ts
index 1234..5678 100644
--- a/f.ts
+++ b/f.ts
@@ -1,3 +1,4 @@
 line1
+added1
 line2
 line3
@@ -10,3 +11,4 @@
 line10
+added2
+added3
-removed1
 line11
`;
    const files = parseDiffToFileChanges(diff);
    expect(files[0].additions).toBe(3);
    expect(files[0].deletions).toBe(1);
  });

  it('extracts filename from b/ path', () => {
    const diff = `diff --git a/path/to/file.ts b/path/to/file.ts
index 1234..5678 100644
--- a/path/to/file.ts
+++ b/path/to/file.ts
@@ -1 +1,2 @@
 x
+y
`;
    const files = parseDiffToFileChanges(diff);
    expect(files[0].filename).toBe('path/to/file.ts');
  });
});
