/**
 * Database layer for PR Reviewer MCP server
 *
 * Uses sql.js (pure JS SQLite) for cross-platform compatibility.
 *
 * Stores:
 * - Learned patterns from past reviews
 * - Review history
 * - Repository context
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

export interface Learning {
  id: number;
  repo: string;
  pattern_type: 'code_quality' | 'test_coverage' | 'architecture' | 'security';
  pattern: string;
  context: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ReviewRecord {
  id: number;
  repo: string;
  pr_number: number;
  pr_title: string;
  author: string;
  findings_count: number;
  escalated: boolean;
  reviewed_at: string;
  summary: string;
}

export interface RepoContext {
  id: number;
  repo: string;
  key: string;
  value: string;
  updated_at: string;
}

export async function createDatabase(dbPath: string): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();

  // Ensure directory exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing database or create new
  let db: SqlJsDatabase;
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      pattern TEXT NOT NULL,
      context TEXT,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_learnings_repo ON learnings(repo);
    CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(pattern_type);

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT,
      author TEXT,
      findings_count INTEGER DEFAULT 0,
      escalated INTEGER DEFAULT 0,
      reviewed_at TEXT DEFAULT (datetime('now')),
      summary TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_repo ON reviews(repo);
    CREATE INDEX IF NOT EXISTS idx_reviews_author ON reviews(author);

    CREATE TABLE IF NOT EXISTS repo_context (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(repo, key)
    );

    CREATE INDEX IF NOT EXISTS idx_context_repo ON repo_context(repo);
  `);

  return db;
}

export class ReviewerDB {
  private db: SqlJsDatabase | null = null;
  private dbPath: string;
  private initPromise: Promise<void>;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    this.db = await createDatabase(this.dbPath);
  }

  private async ensureInit(): Promise<SqlJsDatabase> {
    await this.initPromise;
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  private save(): void {
    if (this.db) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  // Learnings

  async storeLearning(
    repo: string,
    patternType: Learning['pattern_type'],
    pattern: string,
    context: string,
    confidence: number = 0.5
  ): Promise<number> {
    const db = await this.ensureInit();
    db.run(
      `INSERT INTO learnings (repo, pattern_type, pattern, context, confidence) VALUES (?, ?, ?, ?, ?)`,
      [repo, patternType, pattern, context, confidence]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    this.save();
    return result[0]?.values[0]?.[0] as number;
  }

  async getLearnings(repo: string, patternType?: Learning['pattern_type']): Promise<Learning[]> {
    const db = await this.ensureInit();
    let query = 'SELECT * FROM learnings WHERE repo = ?';
    const params: (string | undefined)[] = [repo];

    if (patternType) {
      query += ' AND pattern_type = ?';
      params.push(patternType);
    }

    query += ' ORDER BY confidence DESC, updated_at DESC';

    const result = db.exec(query, params.filter(Boolean) as string[]);
    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as unknown as Learning;
    });
  }

  async updateLearningConfidence(id: number, confidence: number): Promise<void> {
    const db = await this.ensureInit();
    db.run(
      `UPDATE learnings SET confidence = ?, updated_at = datetime('now') WHERE id = ?`,
      [confidence, id]
    );
    this.save();
  }

  // Reviews

  async logReview(
    repo: string,
    prNumber: number,
    prTitle: string,
    author: string,
    findingsCount: number,
    escalated: boolean,
    summary: string
  ): Promise<number> {
    const db = await this.ensureInit();
    db.run(
      `INSERT INTO reviews (repo, pr_number, pr_title, author, findings_count, escalated, summary) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [repo, prNumber, prTitle, author, findingsCount, escalated ? 1 : 0, summary]
    );
    const result = db.exec('SELECT last_insert_rowid() as id');
    this.save();
    return result[0]?.values[0]?.[0] as number;
  }

  async getReviewHistory(repo: string, limit: number = 20): Promise<ReviewRecord[]> {
    const db = await this.ensureInit();
    const result = db.exec(
      `SELECT * FROM reviews WHERE repo = ? ORDER BY reviewed_at DESC LIMIT ?`,
      [repo, limit]
    );
    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as unknown as ReviewRecord;
    });
  }

  async getAuthorStats(repo: string, author: string): Promise<{ totalPRs: number; escalatedPRs: number; avgFindings: number }> {
    const db = await this.ensureInit();
    const result = db.exec(
      `SELECT COUNT(*) as totalPRs, SUM(escalated) as escalatedPRs, AVG(findings_count) as avgFindings
       FROM reviews WHERE repo = ? AND author = ?`,
      [repo, author]
    );
    if (!result[0] || !result[0].values[0]) {
      return { totalPRs: 0, escalatedPRs: 0, avgFindings: 0 };
    }
    const row = result[0].values[0];
    return {
      totalPRs: (row[0] as number) || 0,
      escalatedPRs: (row[1] as number) || 0,
      avgFindings: (row[2] as number) || 0,
    };
  }

  // Repository Context

  async setContext(repo: string, key: string, value: string): Promise<void> {
    const db = await this.ensureInit();
    db.run(
      `INSERT INTO repo_context (repo, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(repo, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [repo, key, value]
    );
    this.save();
  }

  async getContext(repo: string, key?: string): Promise<RepoContext[]> {
    const db = await this.ensureInit();
    let query = 'SELECT * FROM repo_context WHERE repo = ?';
    const params: string[] = [repo];

    if (key) {
      query += ' AND key = ?';
      params.push(key);
    }

    const result = db.exec(query, params);
    if (!result[0]) return [];

    const columns = result[0].columns;
    return result[0].values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj as unknown as RepoContext;
    });
  }

  // Get full context for a repository (for agent prompts)
  async getFullContext(repo: string): Promise<{
    learnings: Learning[];
    recentReviews: ReviewRecord[];
    context: RepoContext[];
  }> {
    return {
      learnings: await this.getLearnings(repo),
      recentReviews: await this.getReviewHistory(repo, 10),
      context: await this.getContext(repo),
    };
  }

  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
