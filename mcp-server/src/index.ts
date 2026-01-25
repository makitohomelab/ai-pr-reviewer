#!/usr/bin/env node
/**
 * AI PR Reviewer MCP Server
 *
 * Supports both stdio (for local Claude Code) and HTTP (for GitHub Actions) transport.
 *
 * Usage:
 *   node dist/index.js              # stdio mode (default)
 *   node dist/index.js --http       # HTTP mode on port 3100
 *   node dist/index.js --http 8080  # HTTP mode on custom port
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { createServer } from './server.js';
import { ReviewerDB } from './db.js';

const DEFAULT_HTTP_PORT = 3100;
const DEFAULT_DB_PATH = process.env.DATABASE_PATH || path.join(process.env.HOME || '.', '.ai-pr-reviewer', 'memory.db');

async function main() {
  const args = process.argv.slice(2);
  const httpMode = args.includes('--http');
  const portArg = args.find((_, i, arr) => arr[i - 1] === '--http' && !isNaN(parseInt(_, 10)));
  const port = portArg ? parseInt(portArg, 10) : DEFAULT_HTTP_PORT;

  // Initialize database
  const db = new ReviewerDB(DEFAULT_DB_PATH);
  console.error(`Database: ${DEFAULT_DB_PATH}`);

  // Create MCP server
  const { server, context } = createServer(db);

  // Cleanup on exit
  const cleanup = () => {
    console.error('Shutting down...');
    context.db.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  if (httpMode) {
    // HTTP mode - for GitHub Actions
    const app = express();
    const transports = new Map<string, StreamableHTTPServerTransport>();

    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string || randomUUID();

      let transport = transports.get(sessionId);
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => sessionId,
        });
        transports.set(sessionId, transport);
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    });

    // Health check endpoint
    app.get('/health', (_, res) => {
      res.json({ status: 'ok', mode: 'http', port });
    });

    app.listen(port, () => {
      console.error(`MCP Server running in HTTP mode on port ${port}`);
      console.error(`Health check: http://localhost:${port}/health`);
    });
  } else {
    // Stdio mode - for local Claude Code
    console.error('MCP Server running in stdio mode');
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
