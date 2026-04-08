# ERPNext MCP Server

Connect AI assistants to your ERPNext instance. This server lets tools like Claude, Cursor, or any [MCP-compatible](https://modelcontextprotocol.io) client read and write ERPNext data through natural language.

## What Can It Do?

Once connected, your AI assistant can:

- **Query your data** — "Show me all pending Sales Orders" / "What's the stock level of TV-55-OLED?"
- **Create documents** — "Create a Purchase Order for 100 units of OLED panels from ShenTech"
- **Run reports** — "Run the Gross Profit report for last month"
- **Explore your schema** — "What fields does a Sales Order have?"
- **Work with multiple companies** — "Switch to the PharmaCore company and show me their suppliers"

## Quick Start

### Option 1: Use with Claude Desktop (recommended for getting started)

**Prerequisites:** [Node.js 20+](https://nodejs.org/) installed.

**Step 1:** Clone and build the server

```bash
git clone https://github.com/RajeevGangwar/erpnext-mcp-server.git
cd erpnext-mcp-server
npm install
npm run build
```

**Step 2:** Get your ERPNext API credentials

1. Log in to your ERPNext instance as Administrator
2. Go to the search bar and type **User**, then open the User list
3. Open the user you want to connect as (or create a dedicated API user)
4. Scroll down to the **API Access** section (under the Settings tab)
5. Click **Generate Keys**
6. **Copy the API Secret immediately** — it is shown only once
7. The API Key stays visible on the user page — copy it too

> **Tip:** Create a dedicated user like `api@yourcompany.com` with only the roles you need (e.g., Sales User, Stock User) instead of using Administrator.

**Step 3:** Configure Claude Desktop

Open your Claude Desktop config file:
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

Add this block (replace the placeholder values with your credentials):

```json
{
  "mcpServers": {
    "erpnext": {
      "command": "node",
      "args": ["C:/path/to/erpnext-mcp-server/build/index.js"],
      "env": {
        "ERPNEXT_URL": "https://your-site.frappe.cloud",
        "ERPNEXT_API_KEY": "your-api-key-from-step-2",
        "ERPNEXT_API_SECRET": "your-api-secret-from-step-2"
      }
    }
  }
}
```

**Step 4:** Restart Claude Desktop and start chatting with your ERP data.

### Option 2: Deploy as a shared HTTP server

For teams or production use, deploy the server once and connect multiple clients to it. Credentials are passed per-session via HTTP headers — the server itself stores nothing.

```bash
# Build and run
npm run build
TRANSPORT=http PORT=8000 node build/index.js
```

Or with Docker:

```bash
docker build -t erpnext-mcp-server .
docker run -p 8000:8000 -e TRANSPORT=http erpnext-mcp-server
```

Clients connect by passing ERPNext credentials as HTTP headers:

```json
{
  "x-erpnext-url": "https://your-site.frappe.cloud",
  "x-erpnext-api-key": "your-api-key",
  "x-erpnext-api-secret": "your-api-secret",
  "x-erpnext-company": "Your Company Name"
}
```

One server can serve multiple ERPNext sites simultaneously — each connection uses its own credentials.

---

## Available Tools

| Tool | What it does | Example prompt |
|------|-------------|----------------|
| `list_companies` | Lists all companies on the ERPNext site | "What companies are set up?" |
| `set_company` | Switches which company's data you're working with | "Switch to the Mumbai office company" |
| `get_doctypes` | Lists all available document types | "What types of documents can I access?" |
| `get_doctype_fields` | Shows the fields/schema for a document type | "What fields does a Purchase Order have?" |
| `get_document` | Fetches a specific document by name | "Show me Sales Order SO-00042" |
| `get_documents` | Searches documents with filters | "List all overdue Purchase Orders" |
| `create_document` | Creates a new document | "Create a new Supplier called AcmeCorp" |
| `update_document` | Updates an existing document | "Update Item TV-55-OLED description" |
| `run_report` | Runs a built-in ERPNext report | "Run the Stock Balance report" |
| `call_method` | Calls a server-side ERPNext method | "Get the BOM tree for TV-55-OLED" |

### Multi-Company Support

ERPNext sites can host multiple companies. When you set an active company (via `set_company` or the `x-erpnext-company` header), the server automatically:

- **Filters queries** — Sales Orders, Purchase Orders, Work Orders, and other transaction documents are scoped to that company
- **Sets the company on new documents** — documents you create are assigned to the active company
- **Leaves shared data alone** — Items, Suppliers, and Customers are shared across companies and are never filtered

---

## How Credentials Work

The server supports two ways to receive ERPNext credentials:

### For local/desktop use (environment variables)

Set these when starting the server or in your Claude Desktop config:

| Variable | Required | What it is |
|----------|----------|------------|
| `ERPNEXT_URL` | Yes | Your ERPNext site URL (e.g., `https://mycompany.frappe.cloud`) |
| `ERPNEXT_API_KEY` | Yes | API key from ERPNext User > API Access |
| `ERPNEXT_API_SECRET` | Yes | API secret (shown once when generated) |
| `ERPNEXT_COMPANY` | No | Default company to use for filtering |

### For shared/remote use (HTTP headers)

When deployed as an HTTP server, each client passes credentials as request headers. This means:
- The server stores no credentials — it's fully stateless
- Different clients can connect to different ERPNext sites simultaneously
- Credentials rotate without redeploying the server

| Header | Maps to |
|--------|---------|
| `x-erpnext-url` | ERPNext site URL |
| `x-erpnext-api-key` | API key |
| `x-erpnext-api-secret` | API secret |
| `x-erpnext-company` | Default company |

HTTP headers take precedence over environment variables when both are present.

---

## Server Configuration

These settings control the server itself (not your ERPNext connection):

| Variable | Default | What it does |
|----------|---------|--------------|
| `TRANSPORT` | `stdio` | How clients connect: `stdio` for Claude Desktop, `http` for shared deployment |
| `PORT` | `8000` | Port for HTTP mode |
| `MCP_SERVER_API_KEY` | *(none)* | If set, clients must send a matching `x-api-key` header to connect |

---

## Security

- **Credentials are never stored** by the server — they come from env vars or per-request headers
- **Credentials are never logged** or included in error messages
- **Per-session isolation** — each client connection gets its own ERPNext session, credentials are not shared
- **Docker image runs as non-root** user (`app`)
- **Optional API key protection** — set `MCP_SERVER_API_KEY` to require authentication for HTTP connections

---

## HTTP Endpoints (for advanced users)

| Method | Path | What it does |
|--------|------|--------------|
| `POST/GET/DELETE` | `/mcp` | Main endpoint (StreamableHTTP protocol) |
| `GET` | `/sse` | Server-Sent Events connection (legacy, single session) |
| `POST` | `/messages` | SSE message endpoint (legacy) |
| `GET` | `/health` | Health check — returns `{"status": "healthy"}` |

---

## Development

```bash
git clone https://github.com/RajeevGangwar/erpnext-mcp-server.git
cd erpnext-mcp-server
npm install
npm run build        # compile TypeScript
npm run watch        # auto-rebuild on changes
npm run inspector    # MCP Inspector for debugging tools
```

### Project Structure

```
src/
├── index.ts        # Entry point — picks transport mode, starts server
├── client.ts       # ERPNext HTTP client (REST API wrapper)
├── tools.ts        # MCP tool definitions and handlers
├── resources.ts    # MCP resource definitions (document lookup)
└── transport.ts    # HTTP/SSE/stdio transport setup
```

---

## License

MIT — see [LICENSE](LICENSE) for details.
