#!/usr/bin/env node

/**
 * ERPNext MCP Server -- Entry Point
 *
 * Credentials come from HTTP request headers (x-erpnext-*) or env vars.
 * No external credential stores required.
 */

import { createMCPServer } from "./tools.js";
import { startHTTP, startStdio } from "./transport.js";

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http" || transport === "sse") {
  startHTTP(createMCPServer, parseInt(process.env.PORT || "8000"));
} else {
  startStdio(createMCPServer).catch((err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}
