/**
 * Static Analyzer
 *
 * Performs whole-codebase static analysis to generate metrics for
 * the CodebaseQualityAgent. Uses lightweight regex-based analysis
 * to stay within token budgets.
 *
 * Metrics generated:
 * - Complexity hotspots (cyclomatic complexity, nesting depth)
 * - Unused exports (exports with no importers)
 * - Duplicate candidates (similar function signatures)
 * - File metrics (size, avg complexity)
 */

import { readFile } from 'fs/promises';
import { basename, dirname, relative } from 'path';

/**
 * Complexity metrics for a function/method.
 */
export interface ComplexityHotspot {
  file: string;
  function: string;
  cyclomatic: number;
  nestingDepth: number;
  line: number;
}

/**
 * An export that may be unused.
 */
export interface UnusedExport {
  file: string;
  export: string;
  line: number;
}

/**
 * Potential code duplication.
 */
export interface DuplicateCandidate {
  files: string[];
  signature: string;
  similarity: number;
}

/**
 * Overall file metrics.
 */
export interface FileMetrics {
  totalFiles: number;
  totalLines: number;
  avgComplexity: number;
  largestFiles: Array<{ file: string; lines: number }>;
}

/**
 * Complete static analysis result.
 */
export interface StaticAnalysis {
  complexityHotspots: ComplexityHotspot[];
  unusedExports: UnusedExport[];
  duplicateCandidates: DuplicateCandidate[];
  fileMetrics: FileMetrics;
  analyzedAt: string;
}

/**
 * Import tracking for dependency analysis.
 */
interface ImportInfo {
  file: string;
  imports: string[];
  importedFrom: string[];
}

/**
 * Export tracking for dead code detection.
 */
interface ExportInfo {
  file: string;
  name: string;
  line: number;
}

/**
 * Function signature for duplication detection.
 */
interface FunctionSignature {
  file: string;
  name: string;
  params: string;
  bodyHash: string;
  line: number;
}

/**
 * Calculate cyclomatic complexity from code.
 * Counts decision points: if, else, for, while, case, catch, &&, ||, ?:
 */
function calculateCyclomaticComplexity(code: string): number {
  // Start with 1 for the function itself
  let complexity = 1;

  // Count decision points
  const patterns = [
    /\bif\s*\(/g,
    /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g,
    /\bwhile\s*\(/g,
    /\bcase\s+/g,
    /\bcatch\s*\(/g,
    /\?\s*[^:]/g,  // Ternary operator
    /&&/g,
    /\|\|/g,
    /\?\?/g,  // Nullish coalescing
  ];

  for (const pattern of patterns) {
    const matches = code.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

/**
 * Calculate maximum nesting depth in code.
 */
function calculateNestingDepth(code: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of code) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

/**
 * Extract function definitions from TypeScript/JavaScript code.
 */
function extractFunctions(
  code: string,
  filePath: string
): Array<{ name: string; body: string; line: number }> {
  const functions: Array<{ name: string; body: string; line: number }> = [];
  const lines = code.split('\n');

  // Patterns for function definitions
  const patterns = [
    // function name(...)
    /function\s+(\w+)\s*\([^)]*\)/,
    // const/let/var name = function
    /(?:const|let|var)\s+(\w+)\s*=\s*function/,
    // const/let/var name = (...) =>
    /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    // method name(...) in class
    /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        // Find the function body by tracking braces
        let body = '';
        let braceCount = 0;
        let started = false;

        for (let j = i; j < lines.length && j < i + 100; j++) {
          const currentLine = lines[j];
          body += currentLine + '\n';

          for (const char of currentLine) {
            if (char === '{') {
              braceCount++;
              started = true;
            } else if (char === '}') {
              braceCount--;
            }
          }

          if (started && braceCount === 0) {
            break;
          }
        }

        // Skip small functions (getters, simple returns)
        if (body.split('\n').length > 3) {
          functions.push({
            name: match[1],
            body,
            line: i + 1,
          });
        }
        break;
      }
    }
  }

  return functions;
}

/**
 * Extract exports from TypeScript/JavaScript code.
 */
function extractExports(code: string, filePath: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = code.split('\n');

  const patterns = [
    // export function name
    /export\s+(?:async\s+)?function\s+(\w+)/,
    // export const/let/var name
    /export\s+(?:const|let|var)\s+(\w+)/,
    // export class name
    /export\s+class\s+(\w+)/,
    // export interface name
    /export\s+interface\s+(\w+)/,
    // export type name
    /export\s+type\s+(\w+)/,
    // export { name }
    /export\s*\{\s*(\w+)/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip re-exports (export { x } from 'y')
    if (line.includes(' from ')) continue;

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        exports.push({
          file: filePath,
          name: match[1],
          line: i + 1,
        });
      }
    }
  }

  return exports;
}

/**
 * Extract imports from TypeScript/JavaScript code.
 */
function extractImports(code: string): string[] {
  const imports: string[] = [];

  // import { a, b } from '...'
  const namedImports = code.matchAll(/import\s*\{([^}]+)\}\s*from/g);
  for (const match of namedImports) {
    const names = match[1].split(',').map((n) => n.trim().split(' as ')[0].trim());
    imports.push(...names.filter(Boolean));
  }

  // import Default from '...'
  const defaultImports = code.matchAll(/import\s+(\w+)\s+from/g);
  for (const match of defaultImports) {
    if (match[1] !== 'type') {
      imports.push(match[1]);
    }
  }

  return imports;
}

/**
 * Generate a simple hash for function body comparison.
 */
function hashFunctionBody(body: string): string {
  // Normalize: remove whitespace, comments, string literals
  const normalized = body
    .replace(/\/\/.*$/gm, '')           // Remove line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')   // Remove block comments
    .replace(/'[^']*'/g, "'str'")       // Normalize strings
    .replace(/"[^"]*"/g, '"str"')       // Normalize strings
    .replace(/`[^`]*`/g, '`str`')       // Normalize template literals
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim();

  // Simple hash: length + first/last chars + structure
  const structureHash = normalized
    .replace(/[a-zA-Z_$][a-zA-Z0-9_$]*/g, 'id')
    .replace(/\d+/g, 'n');

  return `${normalized.length}:${structureHash.slice(0, 50)}`;
}

/**
 * Analyze a single file.
 */
async function analyzeFile(
  filePath: string,
  content: string,
  repoRoot: string
): Promise<{
  functions: FunctionSignature[];
  exports: ExportInfo[];
  imports: string[];
  lines: number;
  complexity: number;
}> {
  const relativePath = relative(repoRoot, filePath);
  const functions = extractFunctions(content, relativePath);
  const exports = extractExports(content, relativePath);
  const imports = extractImports(content);
  const lines = content.split('\n').length;

  const functionSignatures: FunctionSignature[] = functions.map((fn) => ({
    file: relativePath,
    name: fn.name,
    params: '', // Could extract params if needed
    bodyHash: hashFunctionBody(fn.body),
    line: fn.line,
  }));

  // Calculate average complexity for this file
  const complexities = functions.map((fn) => calculateCyclomaticComplexity(fn.body));
  const avgComplexity = complexities.length > 0
    ? complexities.reduce((a, b) => a + b, 0) / complexities.length
    : 0;

  return {
    functions: functionSignatures,
    exports,
    imports,
    lines,
    complexity: avgComplexity,
  };
}

/**
 * Find complexity hotspots from analyzed functions.
 */
function findComplexityHotspots(
  files: Map<string, { functions: FunctionSignature[]; content: string }>,
  limit: number = 5
): ComplexityHotspot[] {
  const hotspots: ComplexityHotspot[] = [];

  for (const [filePath, data] of files) {
    for (const fn of data.functions) {
      // Re-extract the function body to calculate metrics
      const functions = extractFunctions(data.content, filePath);
      const match = functions.find((f) => f.name === fn.name && f.line === fn.line);

      if (match) {
        const cyclomatic = calculateCyclomaticComplexity(match.body);
        const nestingDepth = calculateNestingDepth(match.body);

        // Only track if complexity is notable
        if (cyclomatic >= 5 || nestingDepth >= 3) {
          hotspots.push({
            file: filePath,
            function: fn.name,
            cyclomatic,
            nestingDepth,
            line: fn.line,
          });
        }
      }
    }
  }

  // Sort by complexity and return top N
  return hotspots
    .sort((a, b) => b.cyclomatic - a.cyclomatic || b.nestingDepth - a.nestingDepth)
    .slice(0, limit);
}

/**
 * Find unused exports by checking import usage across files.
 */
function findUnusedExports(
  allExports: ExportInfo[],
  allImports: Set<string>,
  indexFiles: Set<string>
): UnusedExport[] {
  const unused: UnusedExport[] = [];

  for (const exp of allExports) {
    // Skip index files (re-exports are expected)
    if (indexFiles.has(exp.file)) continue;

    // Skip common patterns that are often used externally
    if (['default', 'main', 'index'].includes(exp.name.toLowerCase())) continue;

    // Check if this export is imported anywhere
    if (!allImports.has(exp.name)) {
      unused.push({
        file: exp.file,
        export: exp.name,
        line: exp.line,
      });
    }
  }

  return unused.slice(0, 10); // Limit to avoid noise
}

/**
 * Find duplicate function candidates by comparing hashes.
 */
function findDuplicateCandidates(
  allFunctions: FunctionSignature[],
  limit: number = 5
): DuplicateCandidate[] {
  const hashGroups = new Map<string, FunctionSignature[]>();

  // Group functions by hash
  for (const fn of allFunctions) {
    const existing = hashGroups.get(fn.bodyHash) || [];
    existing.push(fn);
    hashGroups.set(fn.bodyHash, existing);
  }

  const duplicates: DuplicateCandidate[] = [];

  for (const [hash, fns] of hashGroups) {
    if (fns.length >= 2) {
      // Check they're in different files
      const uniqueFiles = new Set(fns.map((f) => f.file));
      if (uniqueFiles.size >= 2) {
        duplicates.push({
          files: Array.from(uniqueFiles),
          signature: `${fns[0].name}() [${fns.length} occurrences]`,
          similarity: 1.0,
        });
      }
    }
  }

  return duplicates
    .sort((a, b) => b.files.length - a.files.length)
    .slice(0, limit);
}

/**
 * Analyze a codebase and generate static analysis metrics.
 *
 * @param repoPath - Path to repository root
 * @param files - List of file paths to analyze (relative or absolute)
 * @param fileContents - Map of file path to content (optional, will read if not provided)
 */
export async function analyzeCodebase(
  repoPath: string,
  files: string[],
  fileContents?: Map<string, string>
): Promise<StaticAnalysis> {
  const analyzedFiles = new Map<
    string,
    { functions: FunctionSignature[]; content: string }
  >();
  const allExports: ExportInfo[] = [];
  const allImports = new Set<string>();
  const indexFiles = new Set<string>();
  const allFunctions: FunctionSignature[] = [];
  const fileSizes: Array<{ file: string; lines: number }> = [];
  let totalComplexity = 0;
  let fileCount = 0;

  // Filter to only TypeScript/JavaScript files
  const codeFiles = files.filter((f) =>
    /\.(ts|tsx|js|jsx)$/.test(f) && !f.includes('node_modules')
  );

  for (const file of codeFiles) {
    try {
      const content =
        fileContents?.get(file) ??
        (await readFile(file, 'utf-8'));

      const analysis = await analyzeFile(file, content, repoPath);

      // Track for later analysis
      analyzedFiles.set(file, {
        functions: analysis.functions,
        content,
      });

      allExports.push(...analysis.exports);
      analysis.imports.forEach((i) => allImports.add(i));
      allFunctions.push(...analysis.functions);
      fileSizes.push({ file, lines: analysis.lines });
      totalComplexity += analysis.complexity;
      fileCount++;

      // Track index files
      if (basename(file).startsWith('index.')) {
        indexFiles.add(relative(repoPath, file));
      }
    } catch (e) {
      // Skip files that can't be read
      continue;
    }
  }

  // Generate analysis
  const complexityHotspots = findComplexityHotspots(analyzedFiles);
  const unusedExports = findUnusedExports(allExports, allImports, indexFiles);
  const duplicateCandidates = findDuplicateCandidates(allFunctions);

  // File metrics
  const largestFiles = fileSizes
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 5)
    .map((f) => ({ file: relative(repoPath, f.file), lines: f.lines }));

  const totalLines = fileSizes.reduce((sum, f) => sum + f.lines, 0);
  const avgComplexity = fileCount > 0 ? totalComplexity / fileCount : 0;

  return {
    complexityHotspots,
    unusedExports,
    duplicateCandidates,
    fileMetrics: {
      totalFiles: fileCount,
      totalLines,
      avgComplexity: Math.round(avgComplexity * 10) / 10,
      largestFiles,
    },
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Generate a compact summary of static analysis for LLM consumption.
 * Designed to fit within ~500 tokens.
 */
export function summarizeStaticAnalysis(analysis: StaticAnalysis): string {
  const sections: string[] = [];

  // File overview
  sections.push(
    `FILES: ${analysis.fileMetrics.totalFiles} files, ` +
      `${analysis.fileMetrics.totalLines} lines, ` +
      `avg complexity ${analysis.fileMetrics.avgComplexity}`
  );

  // Complexity hotspots
  if (analysis.complexityHotspots.length > 0) {
    const hotspots = analysis.complexityHotspots
      .slice(0, 3)
      .map(
        (h) =>
          `  - ${h.file}:${h.line} ${h.function}() CC=${h.cyclomatic} depth=${h.nestingDepth}`
      )
      .join('\n');
    sections.push(`COMPLEXITY HOTSPOTS:\n${hotspots}`);
  }

  // Unused exports
  if (analysis.unusedExports.length > 0) {
    const unused = analysis.unusedExports
      .slice(0, 5)
      .map((u) => `  - ${u.file}: ${u.export}`)
      .join('\n');
    sections.push(`POTENTIALLY UNUSED EXPORTS:\n${unused}`);
  }

  // Duplicates
  if (analysis.duplicateCandidates.length > 0) {
    const dupes = analysis.duplicateCandidates
      .slice(0, 3)
      .map((d) => `  - ${d.signature} in ${d.files.join(', ')}`)
      .join('\n');
    sections.push(`DUPLICATE CANDIDATES:\n${dupes}`);
  }

  return sections.join('\n\n');
}
