#!/usr/bin/env node

/**
 * ERPNext MCP Server — Entry Point
 *
 * Wires credential resolver, server factory, and transport.
 * Picks CosmosCredentialResolver when COSMOS_ENDPOINT is set,
 * otherwise falls back to EnvCredentialResolver.
 */

import { createMCPServer } from "./tools.js";
import { startHTTP, startStdio } from "./transport.js";
import { CosmosCredentialResolver } from "./providers/cosmos.js";
import { EnvCredentialResolver } from "./credentials.js";
import { CredentialResolver } from "./credentials.js";

// Pick resolver based on environment
let resolver: CredentialResolver;
if (process.env.COSMOS_ENDPOINT) {
  resolver = new CosmosCredentialResolver();
} else {
  resolver = new EnvCredentialResolver();
}

const transportType = process.env.TRANSPORT || "stdio";

if (transportType === "http" || transportType === "sse") {
  const port = parseInt(process.env.PORT || "8000");
  startHTTP(() => createMCPServer(resolver), port);
} else {
  startStdio(() => createMCPServer(resolver)).catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
