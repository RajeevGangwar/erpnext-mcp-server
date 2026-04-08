# ERPNext MCP Server

MCP server for ERPNext/Frappe -- multi-site, header-based auth. Connects AI assistants to any ERPNext instance via the [Model Context Protocol](https://modelcontextprotocol.io). Supports **stdio** (Claude Desktop), **StreamableHTTP**, and **legacy SSE** transports.

## Credential Modes

| Mode | How credentials arrive | Use case |
|---|---|---|
| **HTTP headers** | `x-erpnext-url`, `x-erpnext-api-key`, `x-erpnext-api-secret`, `x-erpnext-company` | Periscope / remote deployment, multi-site |
| **Environment variables** | `ERPNEXT_URL`, `ERPNEXT_API_KEY`, `ERPNEXT_API_SECRET`, `ERPNEXT_COMPANY` | stdio / Claude Desktop, single-site |

HTTP headers take precedence. If no headers are provided, env vars are used as fallback.

One container can serve unlimited ERPNext sites -- each session gets credentials from its own request headers.

## Security Notes

- The Docker image runs as a non-root user (`app`).
- Set `MCP_SERVER_API_KEY` to protect the HTTP endpoint; requests must include a matching `x-api-key` header.
- Credentials are scoped per session -- they are never shared across connections.
- The SSE transport supports only one concurrent connection; use StreamableHTTP (`/mcp`) for production multi-session use.

## Tools (10)

| Tool | Description |
|---|---|
| `list_companies` | List all companies on the connected ERPNext site |
| `set_company` | Switch active company context (validates company exists, auto-filters transactions) |
| `get_doctypes` | List all available DocTypes |
| `get_doctype_fields` | Get the schema (field definitions) for a DocType via the meta API |
| `get_document` | Fetch a single document by DocType and name |
| `get_documents` | Query documents with filters, field selection, limits |
| `create_document` | Create a new document |
| `update_document` | Update an existing document |
| `run_report` | Run an ERPNext report |
| `call_method` | Call a whitelisted Frappe/ERPNext server method |

### Auto-filtering

When a company is active (via `set_company` or `x-erpnext-company` header), `get_documents` automatically adds a `company` filter for transaction doctypes (Sales Order, Purchase Order, Work Order, BOM, etc.). Master data doctypes (Item, Supplier, Customer) are not filtered since they are shared across companies.

Similarly, `create_document` auto-sets the `company` field for transaction doctypes only -- it will not add a company field to master data documents.

## Resources

- `erpnext://DocTypes` -- list all available DocTypes
- `erpnext://{doctype}/{name}` -- fetch a specific document

## Periscope Integration

Configure an **Authentication JSON** block on the MCP connection in Periscope:

```json
{
  "x-erpnext-url": "https://your-site.frappe.cloud",
  "x-erpnext-api-key": "your-api-key",
  "x-erpnext-api-secret": "your-api-secret",
  "x-erpnext-company": "Your Company Name"
}
```

Periscope injects these as HTTP headers on every request to the MCP server.

## Claude Desktop Integration

Add to your Claude Desktop config (`%APPDATA%/Claude/claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "erpnext": {
      "command": "node",
      "args": ["/path/to/erpnext-mcp-server/build/index.js"],
      "env": {
        "ERPNEXT_URL": "https://your-site.frappe.cloud",
        "ERPNEXT_API_KEY": "your-api-key",
        "ERPNEXT_API_SECRET": "your-api-secret",
        "ERPNEXT_COMPANY": "Your Company Name"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ERPNEXT_URL` | For stdio | Base URL of your ERPNext instance |
| `ERPNEXT_API_KEY` | For stdio | ERPNext API key |
| `ERPNEXT_API_SECRET` | For stdio | ERPNext API secret |
| `ERPNEXT_COMPANY` | No | Default company for auto-filtering |
| `TRANSPORT` | No | `stdio` (default), `http`, or `sse` |
| `PORT` | No | HTTP port (default: `8000`) |
| `MCP_SERVER_API_KEY` | No | API key to protect the HTTP endpoint |

## Development

```bash
npm install
npm run build
npm run watch      # auto-rebuild on changes
npm run inspector  # MCP Inspector for debugging
```

## Docker Deployment

```bash
docker build -t erpnext-mcp-server .
docker run -p 8000:8000 \
  -e TRANSPORT=http \
  -e MCP_SERVER_API_KEY=your-mcp-auth-key \
  erpnext-mcp-server
```

No `ERPNEXT_*` env vars needed when using HTTP headers -- credentials come per-session from the client.

## HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| `POST/GET/DELETE` | `/mcp` | StreamableHTTP (primary) |
| `GET` | `/sse` | Legacy SSE connection (single session) |
| `POST` | `/messages` | Legacy SSE messages |
| `GET` | `/health` | Health check |

To secure the HTTP endpoint, set `MCP_SERVER_API_KEY` and pass `x-api-key` header in requests.
