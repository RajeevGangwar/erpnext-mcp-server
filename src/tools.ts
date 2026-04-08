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
  Tool,
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
    throw new McpError(ErrorCode.InvalidRequest, "Not connected. Provide credentials via x-erpnext-* headers or ERPNEXT_* env vars.");
  }

  /** Return an authenticated client or throw an MCP error. */
  function requireAuth(): ERPNextClient {
    const c = getClient();
    if (!c.isAuthenticated()) {
      throw new McpError(ErrorCode.InvalidRequest, "Not authenticated. Provide credentials via x-erpnext-* headers or ERPNEXT_* env vars.");
    }
    return c;
  }

  // ── Register resources & tools ──────────────────────────────────────
  registerResources(server, getClient);
  registerTools(server, requireAuth, () => company, (c) => { company = c; });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool registration
// ─────────────────────────────────────────────────────────────────────────────

function registerTools(
  server: Server,
  requireAuth: () => ERPNextClient,
  getCompany: () => string | null,
  setCompany: (name: string | null) => void,
): void {

  // ── Tool list ─────────────────────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
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
        description: "Get the schema (fields list) for a specific DocType via the DocType meta API",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" }
          },
          required: ["doctype"]
        }
      },
      {
        name: "get_document",
        description: "Fetch a single document by DocType and name",
        inputSchema: {
          type: "object" as const,
          properties: {
            doctype: { type: "string", description: "ERPNext DocType (e.g., Customer, Item)" },
            name: { type: "string", description: "Document name/ID" }
          },
          required: ["doctype", "name"]
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
        const client = requireAuth();
        try {
          const companies = await client.getDocList("Company", undefined, ["name", "default_currency", "country"], 100);
          return { content: [{ type: "text", text: JSON.stringify(companies, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to list companies: ${error.message}` }], isError: true };
        }
      }

      case "set_company": {
        const name = String(request.params.arguments?.company_name || "");
        if (!name) throw new McpError(ErrorCode.InvalidParams, "company_name is required");
        const client = requireAuth();
        try {
          const matches = await client.getDocList("Company", { name }, ["name"], 1);
          if (!matches.length) {
            return { content: [{ type: "text", text: `Company "${name}" not found on this ERPNext site.` }], isError: true };
          }
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to verify company "${name}": ${error.message}` }], isError: true };
        }
        setCompany(name);
        return { content: [{ type: "text", text: JSON.stringify({
          status: "company_switched",
          active_company: getCompany(),
          note: "All subsequent queries will filter by this company where applicable."
        }, null, 2) }] };
      }

      // ── ERPNext data tools ────────────────────────────────────────────

      case "get_doctypes": {
        const client = requireAuth();
        try {
          const doctypes = await client.getAllDocTypes();
          return { content: [{ type: "text", text: JSON.stringify(doctypes, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "get_doctype_fields": {
        const client = requireAuth();
        const doctype = String(request.params.arguments?.doctype);
        if (!doctype) {
          throw new McpError(ErrorCode.InvalidParams, "doctype is required");
        }
        try {
          const doc = await client.getDocument("DocType", doctype);
          const fields = (doc.fields || []).map((f: any) => ({
            fieldname: f.fieldname,
            fieldtype: f.fieldtype,
            label: f.label,
            reqd: f.reqd || 0,
            options: f.options || null,
          }));
          return { content: [{ type: "text", text: JSON.stringify(fields, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get schema for ${doctype}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "get_document": {
        const client = requireAuth();
        const doctype = String(request.params.arguments?.doctype);
        const name = String(request.params.arguments?.name);
        if (!doctype || !name) {
          throw new McpError(ErrorCode.InvalidParams, "doctype and name are required");
        }
        try {
          const doc = await client.getDocument(doctype, name);
          return { content: [{ type: "text", text: JSON.stringify(doc, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get ${doctype} "${name}": ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "get_documents": {
        const client = requireAuth();
        const doctype = String(request.params.arguments?.doctype);
        const fields = request.params.arguments?.fields as string[] | undefined;
        let filters = request.params.arguments?.filters as Record<string, any> | undefined;
        const limit = request.params.arguments?.limit as number || undefined;
        if (!doctype) {
          throw new McpError(ErrorCode.InvalidParams, "doctype is required");
        }
        // Auto-apply company filter for transaction doctypes
        const activeCompany = getCompany();
        if (activeCompany && COMPANY_DOCTYPES.has(doctype)) {
          if (!filters) filters = {};
          if (!filters["company"]) {
            filters = { ...filters, company: activeCompany };
          }
        }
        try {
          const documents = await client.getDocList(doctype, filters, fields, limit);
          return { content: [{ type: "text", text: JSON.stringify(documents, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "create_document": {
        const client = requireAuth();
        const doctype = String(request.params.arguments?.doctype);
        let data = request.params.arguments?.data as Record<string, any> | undefined;
        if (!doctype || !data) {
          throw new McpError(ErrorCode.InvalidParams, "doctype and data are required");
        }
        // Auto-set company only for doctypes that have a company field
        const activeCompany = getCompany();
        if (activeCompany && !data["company"] && COMPANY_DOCTYPES.has(doctype)) {
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
        const client = requireAuth();
        const doctype = String(request.params.arguments?.doctype);
        const name = String(request.params.arguments?.name);
        const data = request.params.arguments?.data as Record<string, any> | undefined;
        if (!doctype || !name || !data) {
          throw new McpError(ErrorCode.InvalidParams, "doctype, name, and data are required");
        }
        try {
          const result = await client.updateDocument(doctype, name, data);
          return { content: [{ type: "text", text: `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}` }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "run_report": {
        const client = requireAuth();
        const reportName = String(request.params.arguments?.report_name);
        const filters = request.params.arguments?.filters as Record<string, any> | undefined;
        if (!reportName) {
          throw new McpError(ErrorCode.InvalidParams, "report_name is required");
        }
        try {
          const result = await client.runReport(reportName, filters);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error: any) {
          return { content: [{ type: "text", text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}` }], isError: true };
        }
      }

      case "call_method": {
        const client = requireAuth();
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
