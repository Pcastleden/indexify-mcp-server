# Indexify MCP Server

An MCP (Model Context Protocol) server that exposes [Indexify](https://indexify.ai)'s document ingestion, embedding, and RAG query capabilities as tools for AI agents.

**Built for [Dreamer](https://dreamer.com)** — the personal agentic platform by /dev/agents — but works with any MCP client including Claude Desktop, Claude Code, and other MCP-compatible tools.

## What is Indexify?

Indexify is an AI-powered document processing and knowledge management platform. It can:

- **Ingest** PDFs, images, spreadsheets, scanned documents and raw text
- **Extract** text with layout-aware parsing and OCR
- **Embed** content into vector representations for semantic search
- **Query** your documents using natural language with RAG (Retrieval Augmented Generation)
- **Organize** documents into knowledge bases, folders, and tag-based collections

## Why This MCP Server?

This server gives any AI agent the ability to:

1. **Store and organize documents** — Create knowledge bases, upload text, tag and categorize files
2. **Query documents with natural language** — Ask questions and get AI-synthesized answers grounded in your actual documents
3. **Auto-annotate** — Use AI to generate summaries, tags, and potential questions for any document

This fills a critical gap in agent platforms like Dreamer: **unstructured document intelligence**.

---

## Quick Start

### 1. Install

```bash
npm install
npm run build
```

### 2. Set Environment Variables

```bash
export INDEXIFY_API_KEY="your-api-key-here"
export INDEXIFY_BASE_URL="https://api.indexify.ai"   # optional, this is the default
export MCP_TRANSPORT="sse"                            # "sse" for remote, "stdio" for local
export PORT=3100                                      # optional, default 3100
```

### 3. Run

```bash
# SSE mode (for Dreamer, remote clients)
npm start

# Stdio mode (for Claude Desktop)
MCP_TRANSPORT=stdio npm start

# Development
npm run dev
```

---

## Dreamer Integration

### Adding as a Tool in Dreamer

In Dreamer, tools are MCP servers. To add Indexify as a tool:

1. Deploy this server (e.g. on Railway, Render, Fly.io, or any host)
2. In Dreamer, go to Tools → Add Tool
3. Configure:
   - **MCP Server URL**: `https://your-deployment-url.com/sse`
   - **Name**: Indexify
   - **Description**: AI-powered document ingestion, embedding, and RAG queries. Store documents, organize them into knowledge bases, and query them with natural language.

### Example Dreamer Agents Using Indexify

**Document Vault** — Store and query all your important documents
- Trigger: Chrome extension (share any web page/PDF)
- Tools: Indexify (this tool)
- What it does: Ingests documents into a "Personal Vault" knowledge base, auto-annotates them with summaries and tags, provides a searchable UI

**Personal Expense Tracker** — Upload bank statements, get automated budgets
- Trigger: Share from phone (photos of receipts, statement PDFs)
- Tools: Indexify + Google Sheets
- What it does: Ingests financial documents, queries for transaction data, generates spending categorization and budget insights

---

## Available Tools (26 total)

### Knowledge Bases
| Tool | Description |
|------|-------------|
| `list_knowledge_bases` | List all knowledge bases |
| `get_knowledge_base` | Get details of a specific knowledge base |
| `create_knowledge_base` | Create a new knowledge base |
| `update_knowledge_base` | Update name/description |
| `delete_knowledge_base` | Delete a knowledge base |
| `list_knowledge_base_files` | List files in a knowledge base |
| `add_file_to_knowledge_base` | Add a file to a knowledge base |
| `remove_file_from_knowledge_base` | Remove a file from a knowledge base |

### Files & Documents
| Tool | Description |
|------|-------------|
| `list_files` | List all files with filtering |
| `get_file` | Get file details |
| `embed_text` | Ingest raw text and embed it |
| `get_file_text` | Download extracted text from a file |
| `annotate_file` | AI-generate summary, tags, and questions |
| `add_tag_to_file` | Add a tag to a file |
| `remove_tag_from_file` | Remove a tag |
| `get_file_download_link` | Get a download URL |
| `get_file_images` | Get extracted page images |
| `update_file_display_name` | Update display name |
| `update_file_metadata` | Update metadata |
| `reprocess_file` | Re-run extraction/embedding |
| `delete_file` | Delete a file |

### RAG Query
| Tool | Description |
|------|-------------|
| `query` | **The star tool.** Natural language query with RAG. Scoped by knowledge base, files, or tags. Returns AI answer + source chunks. |

### Folders
| Tool | Description |
|------|-------------|
| `list_folders` | List folders |
| `create_folder` | Create a folder |
| `move_file_to_folder` | Move a file to a folder |
| `list_files_and_folders` | Browse the file tree |

---

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "indexify": {
      "command": "node",
      "args": ["/path/to/indexify-mcp-server/dist/index.js"],
      "env": {
        "INDEXIFY_API_KEY": "your-api-key",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

---

## Docker

```bash
docker build -t indexify-mcp-server .
docker run -p 3100:3100 -e INDEXIFY_API_KEY=your-key indexify-mcp-server
```

---

## Architecture

```
┌─────────────────────────────────────┐
│     AI Agent (Dreamer / Claude)     │
├─────────────────────────────────────┤
│          MCP Protocol               │
│      (SSE or stdio transport)       │
├─────────────────────────────────────┤
│      Indexify MCP Server            │
│   26 tools wrapping Indexify API    │
├─────────────────────────────────────┤
│       Indexify API                  │
│  api.indexify.ai                    │
│  (document processing, embedding,  │
│   RAG, knowledge bases)            │
└─────────────────────────────────────┘
```

---

## License

MIT — built by [Indexify](https://indexify.ai)
