# ERPNext MCP Server

A Model Context Protocol server for ERPNext integration.

This is a TypeScript-based MCP server that provides integration with ERPNext/Frappe API. It enables AI assistants to interact with ERPNext data and functionality through the Model Context Protocol. Supports both **stdio** and **HTTP/SSE** transports.

## Features

### Resources
- Access ERPNext documents via `erpnext://{doctype}/{name}` URIs
- List all DocTypes via `erpnext://DocTypes`
- JSON format for structured data access

### Tools
- `connect` - Connect to an ERPNext site using company credentials from Cosmos DB
- `list_companies` - List all available companies from erp-demo-studio Cosmos DB
- `set_company` - Switch active company context within current site connection
- `get_doctypes` - Get a list of all available DocTypes
- `get_doctype_fields` - Get fields list for a specific DocType
- `get_documents` - Get a list of documents for a specific doctype
- `create_document` - Create a new document in ERPNext
- `update_document` - Update an existing document in ERPNext
- `run_report` - Run an ERPNext report
- `call_method` - Call a whitelisted Frappe/ERPNext server method

### Transports
- **stdio** (default) - For local use with Claude Desktop and other MCP clients
- **HTTP/SSE** - For remote deployment, microservice-to-microservice communication

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ERPNEXT_URL` | Yes* | Base URL of your ERPNext instance |
| `ERPNEXT_API_KEY` | Yes* | ERPNext API key for authentication |
| `ERPNEXT_API_SECRET` | Yes* | ERPNext API secret for authentication |
| `TRANSPORT` | No | `stdio` (default) or `sse` |
| `PORT` | No | HTTP port for SSE transport (default: `8000`) |
| `MCP_SERVER_API_KEY` | No | API key to protect the HTTP endpoint |
| `COSMOS_ENDPOINT` | No | Azure Cosmos DB endpoint for multi-company support |
| `COSMOS_KEY` | No | Azure Cosmos DB primary key |
| `COSMOS_DATABASE` | No | Cosmos DB database name (default: `erp-demo-studio`) |

\* Not required if using `connect` tool with Cosmos DB credentials.

## Multi-Company Support

The server supports connecting to multiple ERPNext sites via credentials stored in Azure Cosmos DB (used by erp-demo-studio). This enables a single MCP server instance to serve data from different companies/sites.

### How it works

1. **`connect(company_id)`** - Looks up the company in Cosmos DB, retrieves ERPNext site credentials (`site_url`, `api_key`, `api_secret`), and sets up a session. All subsequent tool calls use this connection.

2. **`list_companies()`** - Lists all available companies from Cosmos DB so you can find the right `company_id`.

3. **`set_company(company_name)`** - Switches the active company context within the current site connection. Useful when a single ERPNext site hosts multiple companies.

### Auto-filtering

When a session company is active, `get_documents` automatically adds a `company` filter for transaction doctypes (Sales Order, Purchase Order, Work Order, BOM, etc.). Master data doctypes (Item, Supplier, Customer) are not filtered since they are shared across companies.

Similarly, `create_document` auto-sets the `company` field if not explicitly provided.

### Fallback behavior

When no `connect` call has been made, all tools fall back to the `ERPNEXT_URL` / `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` environment variables. This maintains backward compatibility with the single-site configuration.

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Usage

### Stdio Transport (Claude Desktop)

Add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "erpnext": {
      "command": "node",
      "args": ["/path/to/erpnext-server/build/index.js"],
      "env": {
        "ERPNEXT_URL": "https://your-site.frappe.cloud",
        "ERPNEXT_API_KEY": "your-api-key",
        "ERPNEXT_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

### HTTP/SSE Transport

Start the server in SSE mode:
```bash
TRANSPORT=sse PORT=8000 ERPNEXT_URL=https://your-site.frappe.cloud \
  ERPNEXT_API_KEY=your-key ERPNEXT_API_SECRET=your-secret \
  node build/index.js
```

Endpoints:
- `GET /health` - Health check
- `GET /sse` - SSE connection endpoint (MCP clients connect here)
- `POST /messages` - Message endpoint (used by SSE transport internally)

To secure the HTTP endpoint, set `MCP_SERVER_API_KEY` and pass `x-api-key` header in requests.

### Docker Deployment

Build and run:
```bash
npm run build
docker build -t erpnext-mcp-server .
docker run -p 8000:8000 \
  -e ERPNEXT_URL=https://your-site.frappe.cloud \
  -e ERPNEXT_API_KEY=your-key \
  -e ERPNEXT_API_SECRET=your-secret \
  -e MCP_SERVER_API_KEY=your-mcp-auth-key \
  erpnext-mcp-server
```

### Debugging

We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Usage Examples

### Get Customer List
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_documents</tool_name>
<arguments>
{
  "doctype": "Customer"
}
</arguments>
</use_mcp_tool>
```

### Get Customer Details
```
<access_mcp_resource>
<server_name>erpnext</server_name>
<uri>erpnext://Customer/CUSTOMER001</uri>
</access_mcp_resource>
```

### Create New Item
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "data": {
    "item_code": "ITEM001",
    "item_name": "Test Item",
    "item_group": "Products",
    "stock_uom": "Nos"
  }
}
</arguments>
</use_mcp_tool>
```

### Get Item Fields
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_doctype_fields</tool_name>
<arguments>
{
  "doctype": "Item"
}
</arguments>
</use_mcp_tool>
```

### Call a Frappe Whitelisted Method
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>call_method</tool_name>
<arguments>
{
  "method": "erpnext.manufacturing.doctype.bom.bom.get_bom_items",
  "args": {
    "bom": "BOM-ITEM001-001",
    "company": "My Company",
    "qty": 1
  }
}
</arguments>
</use_mcp_tool>
```
