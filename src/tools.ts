/**
 * MCP Tool Definitions & Handlers
 *
 * Registers all ERPNext tools on a Server instance.
 * Credentials come from ERPNextConfig (populated from HTTP headers or env vars).
 *
 * createMCPServer() is the main factory: builds a Server with per-instance
 * session state (client + company context).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { ERPNextClient } from "./client.js";
import { registerResources } from "./resources.js";

/** Credentials passed from HTTP headers or env vars. */
export interface ERPNextConfig {
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  company?: string;
}

/** DocTypes that have a company field (transaction/company-scoped docs). */
const COMPANY_DOCTYPES = new Set([
  "Sales Order", "Delivery Note", "Sales Invoice",
  "Purchase Order", "Purchase Receipt", "Purchase Invoice",
  "Payment Entry", "Stock Entry", "Stock Reconciliation",
  "Work Order", "BOM", "Journal Entry", "Bin",
  "Material Request", "Quality Inspection"
]);

/**
 * Creates a fully configured MCP Server with per-instance session state.
 * @param config Optional credentials from HTTP headers; falls back to env vars.
 */
export function createMCPServer(config?: ERPNextConfig): Server {
  const server = new Server(
    { name: "erpnext-mcp-server", version: "0.3.0" },
    { capabilities: { tools: {}, resources: {} } }
  );

  // ── Per-instance session state ──────────────────────────────────────
  let client: ERPNextClient | null = null;
  try {
    client = new ERPNextClient(config?.url, config?.apiKey, config?.apiSecret);
  } catch {
    // No credentials available yet -- tools will return auth errors
  }

  let company: string | null = config?.company || process.env.ERPNEXT_COMPANY || null;

  function getClient(): ERPNextClient {
    if (client) return client;
    throw new Error("Not connected. Provide credentials via x-erpnext-* headers or ERPNEXT_* env vars.");
  }

  // ── Register resources & tools ──────────────────────────────────────
  registerResources(server, getClient);
  registerTools(server, getClient, () => company, (c) => { company = c; });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

function registerTools(
  server: Server,
  getClient: () => ERPNextClient,
  getCompany: () => string | null,
  setCompany: (name: string | null) => void,
): void {

  // ── Tool list ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: any[] = [
      {
        name: "list_companies",
        description: "List all companies on the connected ERPNext site",
        inputSchema: {
          type: "object" as const,
          properties: {}
        }
      },
      {
        name: "set_company",
        description: "Switch the active company context within the current site connection. Use this to query a different company's data on the same ERPNext site.",
        inputSchema: {
          type: "object" as const,
          properties: {
            company_name: { type: "string", description: "ERPNext company name (e.g., 'TechVolt Electronics')" }
          },
          required: ["company_name"]
        }
      },
      {
        name: "get_doctypes",
        description: "Get a list of all available DocTypes",
        inputSchema: {
          type: "object" as const,
          properties: {}
        }
      },
      {
        name: "get_doctype_fields",
        description: "Get fields list for a specific DocType",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "get_documents",
        description: "Get a list of documents for a specific doctype",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" },
            fields: {
              type: "array",
              items: { type: "string" },
              description: "Fields to include (optional)"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Filters in the format {field: value} (optional)"
            },
            limit: { type: "number", description: "Maximum number of documents to return (optional)" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "create_document",
        description: "Create a new document in ERPNext",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" },
            data: { type: "object", additionalProperties: true, description: "Document data" }
          },
          required: ["doctype", "data"]
        }
      },
      {
        name: "update_document",
        description: "Update an existing document in ERPNext",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" },
            name: { type: "string", description: "Document name/ID" },
            data: { type: "object", additionalProperties: true, description: "Document data to update" }
          },
          required: ["doctype", "name", "data"]
        }
      },
      {
        name: "run_report",
        description: "Run an ERPNext report",
        inputSchema: {
          type: "object" as const,
          properties: {
            report_name: { type: "string", description: "Name of the report" },
            filters: { type: "object", additionalProperties: true, description: "Report filters (optional)" }
          },
          required: ["report_name"]
        }
      },
      {
        name: "call_method",
        description: "Call a whitelisted Frappe/ERPNext server method (e.g., erpnext.manufacturing.doctype.bom.bom.get_bom_items)",
        inputSchema: {
          type: "object" as const,
          properties: {
            method: { type: "string", description: "Full dotted method path" },
            args: { type: "object", description: "Method arguments (optional)" }
          },
          required: ["method"]
        }
      },
    ];

    return { tools };
  });

  // ── Tool handler ──────────────────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {

      // ── Session management tools ──────────────────────────────────────

      case "list_companies": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        try {
          const companies = await client.getDocList("Company", {}, ["name", "default_currency", "country"], 100);
          return { content: [{ type: "text", text: JSON.stringify(companies, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to list companies: ${error.message}` }], isError: true };
        }
      }

      case "set_company": {
        const companyName = String(request.params.arguments?.company_name || "");
        setCompany(companyName);
        return { content: [{ type: "text", text: JSON.stringify({
          status: "company_switched",
          active_company: getCompany(),
          note: "All subsequent queries will filter by this company where applicable."
        }, null, 2) }] };
      }

      // ── ERPNext data tools ────────────────────────────────────────────

      case "get_doctypes": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        try {
          const doctypes = await client.getAllDocTypes();
          return { content: [{ type: "text", text: JSON.stringify(doctypes, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "get_doctype_fields": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const doctype = String(request.params.arguments?.doctype);
        if (!doctype) {
          throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
        }
        try {
          const documents = await client.getDocList(doctype, {}, ["*"], 1);
          if (!documents || documents.length === 0) {
            return { content: [{ type: "text", text: `No documents found for ${doctype}. Cannot determine fields.` }], isError: true };
          }
          const sampleDoc = documents[0];
          const fields = Object.keys(sampleDoc).map(field => ({
            fieldname: field,
            value: typeof sampleDoc[field],
            sample: sampleDoc[field]?.toString()?.substring(0, 50) || null
          }));
          return { content: [{ type: "text", text: JSON.stringify(fields, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get fields for ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "get_documents": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const doctype = String(request.params.arguments?.doctype);
        const fields = request.params.arguments?.fields as string[] | undefined;
        let filters = request.params.arguments?.filters as Record<string, any> || {};
        const limit = request.params.arguments?.limit as number || undefined;
        if (!doctype) {
          throw new McpError(ErrorCode.InvalidParams, "Doctype is required");
        }
        // Auto-apply company filter
        const activeCompany = getCompany();
        if (activeCompany && !filters["company"] && COMPANY_DOCTYPES.has(doctype)) {
          filters = { ...filters, company: activeCompany };
        }
        try {
          const documents = await client.getDocList(doctype, filters, fields, limit);
          return { content: [{ type: "text", text: JSON.stringify(documents, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "create_document": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const doctype = String(request.params.arguments?.doctype);
        let data = request.params.arguments?.data as Record<string, any> | undefined;
        if (!doctype || !data) {
          throw new McpError(ErrorCode.InvalidParams, "Doctype and data are required");
        }
        // Auto-set company
        const activeCompany = getCompany();
        if (activeCompany && !data["company"]) {
          data = { ...data, company: activeCompany };
        }
        try {
          const result = await client.createDocument(doctype, data);
          return { content: [{ type: "text", text: `Created ${doctype}: ${result.name}\n\n${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "update_document": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const doctype = String(request.params.arguments?.doctype);
        const name = String(request.params.arguments?.name);
        const data = request.params.arguments?.data as Record<string, any> | undefined;
        if (!doctype || !name || !data) {
          throw new McpError(ErrorCode.InvalidParams, "Doctype, name, and data are required");
        }
        try {
          const result = await client.updateDocument(doctype, name, data);
          return { content: [{ type: "text", text: `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "run_report": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const reportName = String(request.params.arguments?.report_name);
        const filters = request.params.arguments?.filters as Record<string, any> | undefined;
        if (!reportName) {
          throw new McpError(ErrorCode.InvalidParams, "Report name is required");
        }
        try {
          const result = await client.runReport(reportName, filters);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "call_method": {
        const client = getClient();
        if (!client.isAuthenticated()) {
          return { content: [{ type: "text", text: "Not authenticated. Provide credentials via headers or env vars." }], isError: true };
        }
        const method = String(request.params.arguments?.method || "");
        const args = request.params.arguments?.args || {};
        try {
          const response = await client.getAxiosInstance().post(`/api/method/${method}`, args);
          return { content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Error calling method ${method}: ${error.response?.data?.message || error.message}` }], isError: true };
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
    }
  });
}
