#!/usr/bin/env node

/**
 * ERPNext MCP Server
 * This server provides integration with the ERPNext/Frappe API, allowing:
 * - Authentication with ERPNext
 * - Fetching documents from ERPNext
 * - Querying lists of documents
 * - Creating and updating documents
 * - Running reports
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { CosmosClient } from "@azure/cosmos";
import express from "express";
import cors from "cors";

// ERPNext API client configuration
class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;

  constructor(url?: string, apiKey?: string, apiSecret?: string) {
    // Use provided values or fall back to environment variables
    this.baseUrl = (url || process.env.ERPNEXT_URL || '').replace(/\/$/, '');

    // Validate configuration
    if (!this.baseUrl) {
      throw new Error("ERPNext URL is required (pass directly or set ERPNEXT_URL)");
    }

    // Initialize axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    // Configure authentication if credentials provided
    const key = apiKey || process.env.ERPNEXT_API_KEY;
    const secret = apiSecret || process.env.ERPNEXT_API_SECRET;

    if (key && secret) {
      this.axiosInstance.defaults.headers.common['Authorization'] =
        `token ${key}:${secret}`;
      this.authenticated = true;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  // Get a document by doctype and name
  async getDocument(doctype: string, name: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Get list of documents for a doctype
  async getDocList(doctype: string, filters?: Record<string, any>, fields?: string[], limit?: number): Promise<any[]> {
    try {
      let params: Record<string, any> = {};
      
      if (fields && fields.length) {
        params['fields'] = JSON.stringify(fields);
      }
      
      if (filters) {
        params['filters'] = JSON.stringify(filters);
      }
      
      if (limit) {
        params['limit_page_length'] = limit;
      }
      
      const response = await this.axiosInstance.get(`/api/resource/${doctype}`, { params });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} list: ${error?.message || 'Unknown error'}`);
    }
  }

  // Create a new document
  async createDocument(doctype: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.post(`/api/resource/${doctype}`, {
        data: doc
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create ${doctype}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Update an existing document
  async updateDocument(doctype: string, name: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.put(`/api/resource/${doctype}/${name}`, {
        data: doc
      });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Run a report
  async runReport(reportName: string, filters?: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/method/frappe.desk.query_report.run`, {
        params: {
          report_name: reportName,
          filters: filters ? JSON.stringify(filters) : undefined
        }
      });
      return response.data.message;
    } catch (error: any) {
      throw new Error(`Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Get all available DocTypes
  async getAllDocTypes(): Promise<string[]> {
    try {
      // Use the standard REST API to fetch DocTypes
      const response = await this.axiosInstance.get('/api/resource/DocType', {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 500 // Get more doctypes at once
        }
      });
      
      if (response.data && response.data.data) {
        return response.data.data.map((item: any) => item.name);
      }
      
      return [];
    } catch (error: any) {
      console.error("Failed to get DocTypes:", error?.message || 'Unknown error');
      
      // Try an alternative approach if the first one fails
      try {
        // Try using the method API to get doctypes
        const altResponse = await this.axiosInstance.get('/api/method/frappe.desk.search.search_link', {
          params: {
            doctype: 'DocType',
            txt: '',
            limit: 500
          }
        });
        
        if (altResponse.data && altResponse.data.results) {
          return altResponse.data.results.map((item: any) => item.value);
        }
        
        return [];
      } catch (altError: any) {
        console.error("Alternative DocType fetch failed:", altError?.message || 'Unknown error');
        
        // Fallback: Return a list of common DocTypes
        return [
          "Customer", "Supplier", "Item", "Sales Order", "Purchase Order",
          "Sales Invoice", "Purchase Invoice", "Employee", "Lead", "Opportunity",
          "Quotation", "Payment Entry", "Journal Entry", "Stock Entry"
        ];
      }
    }
  }
}

// Cache for doctype metadata
const doctypeCache = new Map<string, any>();

// --- Cosmos DB multi-company support ---

// Cosmos DB connection for company credential lookup
function getCosmosContainer() {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const database = process.env.COSMOS_DATABASE || "erp-demo-studio";
  if (!endpoint || !key) return null;
  const client = new CosmosClient({ endpoint, key });
  return client.database(database).container("companies");
}

// Session state — set by connect tool, used by all other tools
let sessionClient: ERPNextClient | null = null;
let sessionCompany: string | null = null;  // company name for auto-filtering

// Initialize default ERPNext client (from env vars, optional)
let erpnext: ERPNextClient | null = null;
try {
  erpnext = new ERPNextClient();
} catch {
  // No env vars set — that's OK, use connect() tool instead
}

// Get the active ERPNext client (session or default env-var client)
function getClient(): ERPNextClient {
  if (sessionClient) return sessionClient;
  if (erpnext) return erpnext;
  throw new Error("Not connected. Call the 'connect' tool with a company_id first, or set ERPNEXT_URL env var.");
}

// Create an MCP server with capabilities for resources and tools
const server = new Server(
  {
    name: "erpnext-server",
    version: "0.1.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

/**
 * Handler for listing available ERPNext resources.
 * Exposes DocTypes list as a resource and common doctypes as individual resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // List of common DocTypes to expose as individual resources
  const commonDoctypes = [
    "Customer",
    "Supplier",
    "Item",
    "Sales Order",
    "Purchase Order",
    "Sales Invoice",
    "Purchase Invoice",
    "Employee"
  ];

  const resources = [
    // Add a resource to get all doctypes
    {
      uri: "erpnext://DocTypes",
      name: "All DocTypes",
      mimeType: "application/json",
      description: "List of all available DocTypes in the ERPNext instance"
    }
  ];

  return {
    resources
  };
});

/**
 * Handler for resource templates.
 * Allows querying ERPNext documents by doctype and name.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  const resourceTemplates = [
    {
      uriTemplate: "erpnext://{doctype}/{name}",
      name: "ERPNext Document",
      mimeType: "application/json",
      description: "Fetch an ERPNext document by doctype and name"
    }
  ];

  return { resourceTemplates };
});

/**
 * Handler for reading ERPNext resources.
 */
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

  // Handle special resource: erpnext://DocTypes (list of all doctypes)
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
    // Handle document access: erpnext://{doctype}/{name}
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
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid ERPNext resource URI: ${uri}`
    );
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2)
    }]
  };
});

/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "connect",
        description: "Connect to an ERPNext site using company credentials from Cosmos DB. Call this first to set up the session. All subsequent tool calls will use this connection.",
        inputSchema: {
          type: "object" as const,
          properties: {
            company_id: { type: "string", description: "Company ID from erp-demo-studio Cosmos DB" }
          },
          required: ["company_id"]
        }
      },
      {
        name: "list_companies",
        description: "List all available companies from the erp-demo-studio Cosmos DB",
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
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_doctype_fields",
        description: "Get fields list for a specific DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "get_documents",
        description: "Get a list of documents for a specific doctype",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            fields: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Fields to include (optional)"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Filters in the format {field: value} (optional)"
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return (optional)"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "create_document",
        description: "Create a new document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data"
            }
          },
          required: ["doctype", "data"]
        }
      },
      {
        name: "update_document",
        description: "Update an existing document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data to update"
            }
          },
          required: ["doctype", "name", "data"]
        }
      },
      {
        name: "run_report",
        description: "Run an ERPNext report",
        inputSchema: {
          type: "object",
          properties: {
            report_name: {
              type: "string",
              description: "Name of the report"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Report filters (optional)"
            }
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
      }
    ]
  };
});

// DocTypes that have a company field (transaction/company-scoped docs).
// Master data (Item, Supplier, Customer) is shared across companies.
const COMPANY_DOCTYPES = new Set([
  "Sales Order", "Delivery Note", "Sales Invoice",
  "Purchase Order", "Purchase Receipt", "Purchase Invoice",
  "Payment Entry", "Stock Entry", "Stock Reconciliation",
  "Work Order", "BOM", "Journal Entry", "Bin",
  "Material Request", "Quality Inspection"
]);

/**
 * Handler for tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    // --- Session management tools ---

    case "connect": {
      const companyId = String(request.params.arguments?.company_id || "");
      const container = getCosmosContainer();
      if (!container) {
        return { content: [{ type: "text", text: "Error: Cosmos DB not configured. Set COSMOS_ENDPOINT and COSMOS_KEY environment variables." }] };
      }
      try {
        const { resource: company } = await container.item(companyId, companyId).read();
        if (!company) {
          return { content: [{ type: "text", text: `Error: Company ${companyId} not found in Cosmos DB.` }] };
        }
        const config = company.erp_config || {};
        if (!config.site_url || !config.api_key || !config.api_secret) {
          return { content: [{ type: "text", text: `Error: Company ${companyId} missing erp_config credentials (site_url, api_key, api_secret).` }] };
        }
        sessionClient = new ERPNextClient(config.site_url, config.api_key, config.api_secret);
        sessionCompany = company.name || null;
        return { content: [{ type: "text", text: JSON.stringify({
          status: "connected",
          company: company.name,
          site_url: config.site_url,
          active_company: sessionCompany,
        }, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error connecting: ${error.message}` }] };
      }
    }

    case "list_companies": {
      const container = getCosmosContainer();
      if (!container) {
        return { content: [{ type: "text", text: "Error: Cosmos DB not configured." }] };
      }
      try {
        const { resources } = await container.items.query(
          "SELECT c.id, c.name, c.industry, c.country, c.currency, c.erp_config.site_url FROM c ORDER BY c.created_at DESC"
        ).fetchAll();
        return { content: [{ type: "text", text: JSON.stringify(resources, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text", text: `Error listing companies: ${error.message}` }] };
      }
    }

    case "set_company": {
      const companyName = String(request.params.arguments?.company_name || "");
      sessionCompany = companyName;
      return { content: [{ type: "text", text: JSON.stringify({
        status: "company_switched",
        active_company: sessionCompany,
        note: "All subsequent queries will filter by this company where applicable."
      }, null, 2) }] };
    }

    // --- ERPNext data tools ---

    case "get_documents": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype);
      const fields = request.params.arguments?.fields as string[] | undefined;
      let filters = request.params.arguments?.filters as Record<string, any> || {};
      const limit = request.params.arguments?.limit as number || undefined;

      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }

      // Auto-apply company filter if session company is set and not already filtered
      if (sessionCompany && !filters["company"] && COMPANY_DOCTYPES.has(doctype)) {
        filters = { ...filters, company: sessionCompany };
      }

      try {
        const documents = await client.getDocList(doctype, filters, fields, limit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(documents, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "create_document": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype);
      let data = request.params.arguments?.data as Record<string, any> | undefined;

      if (!doctype || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and data are required"
        );
      }

      // Auto-set company if session company is set and not already in data
      if (sessionCompany && !data["company"]) {
        data = { ...data, company: sessionCompany };
      }

      try {
        const result = await client.createDocument(doctype, data);
        return {
          content: [{
            type: "text",
            text: `Created ${doctype}: ${result.name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "update_document": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const data = request.params.arguments?.data as Record<string, any> | undefined;

      if (!doctype || !name || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype, name, and data are required"
        );
      }

      try {
        const result = await client.updateDocument(doctype, name, data);
        return {
          content: [{
            type: "text",
            text: `Updated ${doctype} ${name}\n\n${JSON.stringify(result, null, 2)}`
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "run_report": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      const reportName = String(request.params.arguments?.report_name);
      const filters = request.params.arguments?.filters as Record<string, any> | undefined;

      if (!reportName) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Report name is required"
        );
      }

      try {
        const result = await client.runReport(reportName, filters);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "get_doctype_fields": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      const doctype = String(request.params.arguments?.doctype);

      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }

      try {
        // Get a sample document to understand the fields
        const documents = await client.getDocList(doctype, {}, ["*"], 1);

        if (!documents || documents.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No documents found for ${doctype}. Cannot determine fields.`
            }],
            isError: true
          };
        }

        // Extract field names from the first document
        const sampleDoc = documents[0];
        const fields = Object.keys(sampleDoc).map(field => ({
          fieldname: field,
          value: typeof sampleDoc[field],
          sample: sampleDoc[field]?.toString()?.substring(0, 50) || null
        }));

        return {
          content: [{
            type: "text",
            text: JSON.stringify(fields, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get fields for ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "call_method": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{ type: "text", text: "Error: Not authenticated. Call connect or set ERPNEXT_API_KEY and ERPNEXT_API_SECRET." }],
          isError: true
        };
      }
      const method = String(request.params.arguments?.method || "");
      const args = request.params.arguments?.args || {};
      try {
        const response = await client.getAxiosInstance().post(`/api/method/${method}`, args);
        return {
          content: [{ type: "text", text: JSON.stringify(response.data, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error calling method ${method}: ${error.response?.data?.message || error.message}` }],
          isError: true
        };
      }
    }

    case "get_doctypes": {
      const client = getClient();

      if (!client.isAuthenticated()) {
        return {
          content: [{
            type: "text",
            text: "Not authenticated with ERPNext. Call connect or set ERPNEXT_API_KEY."
          }],
          isError: true
        };
      }

      try {
        const doctypes = await client.getAllDocTypes();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(doctypes, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Start the server using the configured transport.
 * Set TRANSPORT=sse for HTTP/SSE mode, otherwise defaults to stdio.
 */
async function main() {
  const transportType = process.env.TRANSPORT || "stdio";

  if (transportType === "sse") {
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
      res.json({ status: "healthy", service: "erpnext-mcp-server", transport: "sse" });
    });

    let sseTransport: SSEServerTransport | null = null;

    app.get("/sse", async (_req, res) => {
      sseTransport = new SSEServerTransport("/messages", res);
      await server.connect(sseTransport);
    });

    app.post("/messages", async (req, res) => {
      if (sseTransport) {
        await sseTransport.handlePostMessage(req, res);
      } else {
        res.status(400).json({ error: "No SSE connection established" });
      }
    });

    const PORT = parseInt(process.env.PORT || "8000");
    app.listen(PORT, () => {
      console.error(`ERPNext MCP server running on http://0.0.0.0:${PORT} (SSE transport)`);
    });
  } else {
    // Default: stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("ERPNext MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
