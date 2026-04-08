/**
 * Transport Setup
 *
 * Express app with StreamableHTTP, legacy SSE, and stdio transports.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";

/**
 * Start HTTP transport (StreamableHTTP + legacy SSE).
 * @param createServer Factory that returns a fresh MCP Server per session.
 * @param port Port to listen on.
 */
export function startHTTP(createServer: () => Server, port: number): void {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // API key auth middleware
  app.use((req, res, next) => {
    const expected = process.env.MCP_SERVER_API_KEY;
    if (expected && req.headers["x-api-key"] !== expected) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });

  // Health endpoint
  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", service: "erpnext-mcp-server", transport: "http" });
  });

  // ── StreamableHTTP: POST/GET/DELETE /mcp ─────────────────────────────

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session -- forward the request
    if (sessionId && transports[sessionId]) {
      await transports[sessionId].handleRequest(req, res, req.body);
      return;
    }

    // New session -- must be an initialize request
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete transports[sid];
      };

      // Each session gets its own server instance
      const server = createServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: missing session or not an initialize request" },
      id: null
    });
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  // ── Legacy SSE: GET /sse + POST /messages ────────────────────────────

  let sseTransport: SSEServerTransport | null = null;

  app.get("/sse", async (_req, res) => {
    sseTransport = new SSEServerTransport("/messages", res);
    const server = createServer();
    await server.connect(sseTransport);
  });

  app.post("/messages", async (req, res) => {
    if (sseTransport) {
      await sseTransport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).json({ error: "No SSE connection established" });
    }
  });

  // ── Start ────────────────────────────────────────────────────────────

  app.listen(port, () => {
    console.error(`ERPNext MCP server running on http://0.0.0.0:${port} (http transport)`);
    console.error(`  StreamableHTTP: POST/GET/DELETE /mcp`);
    console.error(`  Legacy SSE: GET /sse + POST /messages`);
    console.error(`  Health: GET /health`);
  });
}

/**
 * Start stdio transport (single session).
 * @param createServer Factory that returns a configured MCP Server.
 */
export async function startStdio(createServer: () => Server): Promise<void> {
  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
  console.error("ERPNext MCP server running on stdio");
}
