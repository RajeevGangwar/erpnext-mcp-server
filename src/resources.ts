/**
 * MCP Resource Definitions
 *
 * Registers ERPNext resource handlers: DocType listing and document lookup.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ERPNextClient } from "./client.js";

export function registerResources(
  server: Server,
  getClient: () => ERPNextClient,
): void {

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "erpnext://DocTypes",
          name: "All DocTypes",
          mimeType: "application/json",
          description: "List of all available DocTypes in the ERPNext instance"
        }
      ]
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "erpnext://{doctype}/{name}",
          name: "ERPNext Document",
          mimeType: "application/json",
          description: "Fetch an ERPNext document by doctype and name"
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const client = getClient();

    if (!client.isAuthenticated()) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        "Not authenticated with ERPNext. Call connect or configure API key authentication."
      );
    }

    const uri = request.params.uri;
    let result: any;

    if (uri === "erpnext://DocTypes") {
      try {
        const doctypes = await client.getAllDocTypes();
        result = { doctypes };
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to fetch DocTypes: ${error?.message || 'Unknown error'}`
        );
      }
    } else {
      const documentMatch = uri.match(/^erpnext:\/\/([^\/]+)\/(.+)$/);
      if (documentMatch) {
        const doctype = decodeURIComponent(documentMatch[1]);
        const name = decodeURIComponent(documentMatch[2]);
        try {
          result = await client.getDocument(doctype, name);
        } catch (error: any) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Failed to fetch ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          );
        }
      }
    }

    if (!result) {
      throw new McpError(ErrorCode.InvalidRequest, `Invalid ERPNext resource URI: ${uri}`);
    }

    return {
      contents: [{
        uri: request.params.uri,
        mimeType: "application/json",
        text: JSON.stringify(result, null, 2)
      }]
    };
  });
}
