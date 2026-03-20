#!/usr/bin/env node
/**
 * Indexify MCP Server
 *
 * Exposes Indexify's document ingestion, embedding, and RAG query capabilities
 * as MCP tools for AI agents (e.g. Dreamer, Claude, etc.)
 *
 * Transport: SSE (for remote/Dreamer) or stdio (for local/Claude Desktop)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { z } from "zod";
import { IndexifyClient } from "./client.js";

// ── Configuration ──────────────────────────────────────────────────

const INDEXIFY_API_KEY = process.env.INDEXIFY_API_KEY || "";
const INDEXIFY_BASE_URL = process.env.INDEXIFY_BASE_URL || "https://api.indexify.ai";
const TRANSPORT = process.env.MCP_TRANSPORT || "sse"; // "sse" or "stdio"
const PORT = parseInt(process.env.PORT || "3100", 10);

if (!INDEXIFY_API_KEY) {
  console.error("⚠️  INDEXIFY_API_KEY environment variable is required");
  process.exit(1);
}

const client = new IndexifyClient({
  baseUrl: INDEXIFY_BASE_URL,
  apiKey: INDEXIFY_API_KEY,
});

// ── MCP Server ─────────────────────────────────────────────────────

const server = new McpServer({
  name: "indexify",
  version: "1.0.0",
});

// ════════════════════════════════════════════════════════════════════
//  KNOWLEDGE BASE TOOLS
// ════════════════════════════════════════════════════════════════════

server.tool(
  "list_knowledge_bases",
  "List all knowledge bases. A knowledge base is a collection of documents that can be queried together using RAG.",
  {
    search: z.string().optional().describe("Search term to filter knowledge bases by name"),
    skip: z.number().optional().describe("Number of results to skip for pagination"),
    limit: z.number().optional().describe("Maximum number of results to return"),
  },
  async ({ search, skip, limit }) => {
    const result = await client.listKnowledgeBases({ search, skip, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_knowledge_base",
  "Get details of a specific knowledge base including its file count and agent count.",
  {
    knowledgeBaseId: z.string().describe("The ID of the knowledge base"),
  },
  async ({ knowledgeBaseId }) => {
    const result = await client.getKnowledgeBase(knowledgeBaseId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_knowledge_base",
  "Create a new knowledge base. Use this to organize documents into queryable collections (e.g. 'Financial Documents', 'Personal Vault', 'Receipts').",
  {
    name: z.string().describe("Name for the knowledge base"),
    description: z.string().optional().describe("Description of what this knowledge base contains"),
  },
  async ({ name, description }) => {
    const result = await client.createKnowledgeBase({ name, description });
    return {
      content: [{ type: "text", text: `Knowledge base created with ID: ${result.id}` }],
    };
  }
);

server.tool(
  "update_knowledge_base",
  "Update the name or description of an existing knowledge base.",
  {
    knowledgeBaseId: z.string().describe("The ID of the knowledge base to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
  },
  async ({ knowledgeBaseId, name, description }) => {
    await client.updateKnowledgeBase(knowledgeBaseId, { name, description });
    return { content: [{ type: "text", text: "Knowledge base updated successfully." }] };
  }
);

server.tool(
  "delete_knowledge_base",
  "Delete a knowledge base. This removes the knowledge base but not the underlying files.",
  {
    knowledgeBaseId: z.string().describe("The ID of the knowledge base to delete"),
  },
  async ({ knowledgeBaseId }) => {
    await client.deleteKnowledgeBase(knowledgeBaseId);
    return { content: [{ type: "text", text: "Knowledge base deleted." }] };
  }
);

server.tool(
  "list_knowledge_base_files",
  "List all files/documents in a specific knowledge base.",
  {
    knowledgeBaseId: z.string().describe("The ID of the knowledge base"),
    skip: z.number().optional().describe("Number of results to skip"),
    limit: z.number().optional().describe("Maximum results to return"),
  },
  async ({ knowledgeBaseId, skip, limit }) => {
    const result = await client.getKnowledgeBaseFiles(knowledgeBaseId, { skip, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_file_to_knowledge_base",
  "Add an existing file to a knowledge base so it becomes queryable within that collection.",
  {
    knowledgeBaseId: z.string().describe("The knowledge base ID"),
    fileId: z.string().describe("The file ID to add"),
  },
  async ({ knowledgeBaseId, fileId }) => {
    await client.addFileToKnowledgeBase(knowledgeBaseId, fileId);
    return { content: [{ type: "text", text: `File ${fileId} added to knowledge base.` }] };
  }
);

server.tool(
  "remove_file_from_knowledge_base",
  "Remove a file from a knowledge base (the file itself is not deleted).",
  {
    knowledgeBaseId: z.string().describe("The knowledge base ID"),
    fileId: z.string().describe("The file ID to remove"),
  },
  async ({ knowledgeBaseId, fileId }) => {
    await client.removeFileFromKnowledgeBase(knowledgeBaseId, fileId);
    return { content: [{ type: "text", text: `File ${fileId} removed from knowledge base.` }] };
  }
);

// ════════════════════════════════════════════════════════════════════
//  FILE TOOLS
// ════════════════════════════════════════════════════════════════════

server.tool(
  "list_files",
  "List all uploaded files. Can filter by tag, status, or search term.",
  {
    tag: z.string().optional().describe("Filter by tag"),
    status: z.string().optional().describe("Filter by status (e.g. 'embedded', 'processing', 'error')"),
    search: z.string().optional().describe("Search term"),
    skip: z.number().optional().describe("Pagination offset"),
    limit: z.number().optional().describe("Max results"),
  },
  async ({ tag, status, search, skip, limit }) => {
    const result = await client.listFiles({ tag, status, search, skip, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "get_file",
  "Get details about a specific file including its status, tags, summary, and metadata.",
  {
    fileId: z.string().describe("The file ID"),
  },
  async ({ fileId }) => {
    const result = await client.getFile(fileId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "embed_text",
  "Ingest raw text content into Indexify. The text will be chunked, embedded, and made queryable. Returns a file ID. Optionally add it directly to knowledge bases.",
  {
    text: z.string().describe("The text content to embed"),
    title: z.string().optional().describe("A title for this text content"),
    tags: z.array(z.string()).optional().describe("Tags to categorize the content"),
    metadata: z.string().optional().describe("Additional metadata as a string"),
    knowledgeBaseIds: z
      .array(z.string())
      .optional()
      .describe("Knowledge base IDs to immediately add this content to"),
    correlationId: z.string().optional().describe("External correlation ID for tracking"),
  },
  async ({ text, title, tags, metadata, knowledgeBaseIds, correlationId }) => {
    const fileId = await client.embedText({ text, title, tags, metadata, knowledgeBaseIds, correlationId });
    return {
      content: [{ type: "text", text: `Text embedded successfully. File ID: ${fileId}` }],
    };
  }
);

server.tool(
  "get_file_text",
  "Download the extracted text content of a file. Useful for reading what was extracted from a PDF, image, or other document.",
  {
    fileId: z.string().describe("The file ID"),
  },
  async ({ fileId }) => {
    const text = await client.getFileText(fileId);
    return { content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text) }] };
  }
);

server.tool(
  "annotate_file",
  "Use AI to automatically generate a summary, tags, and potential questions for a file. Great for auto-categorizing uploaded documents.",
  {
    fileId: z.string().describe("The file ID to annotate"),
  },
  async ({ fileId }) => {
    const result = await client.annotateFile(fileId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "add_tag_to_file",
  "Add a tag to a file for categorization and filtering.",
  {
    fileId: z.string().describe("The file ID"),
    tag: z.string().describe("The tag to add"),
  },
  async ({ fileId, tag }) => {
    await client.addTag(fileId, tag);
    return { content: [{ type: "text", text: `Tag '${tag}' added to file.` }] };
  }
);

server.tool(
  "remove_tag_from_file",
  "Remove a tag from a file.",
  {
    fileId: z.string().describe("The file ID"),
    tag: z.string().describe("The tag to remove"),
  },
  async ({ fileId, tag }) => {
    await client.removeTag(fileId, tag);
    return { content: [{ type: "text", text: `Tag '${tag}' removed from file.` }] };
  }
);

server.tool(
  "get_file_download_link",
  "Generate a temporary download link for the original uploaded file.",
  {
    fileId: z.string().describe("The file ID"),
  },
  async ({ fileId }) => {
    const result = await client.getDownloadLink(fileId);
    return { content: [{ type: "text", text: `Download URL: ${result.url}` }] };
  }
);

server.tool(
  "get_file_images",
  "Get page images extracted from a document (e.g. PDF pages as images).",
  {
    fileId: z.string().describe("The file ID"),
    skip: z.number().optional().describe("Pages to skip"),
    limit: z.number().optional().describe("Max pages to return"),
  },
  async ({ fileId, skip, limit }) => {
    const result = await client.getFileImages(fileId, { skip, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "update_file_display_name",
  "Update the display name of a file.",
  {
    fileId: z.string().describe("The file ID"),
    displayName: z.string().describe("The new display name"),
  },
  async ({ fileId, displayName }) => {
    await client.updateDisplayName(fileId, displayName);
    return { content: [{ type: "text", text: "Display name updated." }] };
  }
);

server.tool(
  "update_file_metadata",
  "Update the metadata string of a file.",
  {
    fileId: z.string().describe("The file ID"),
    metadata: z.string().describe("The new metadata string"),
  },
  async ({ fileId, metadata }) => {
    await client.updateMetadata(fileId, metadata);
    return { content: [{ type: "text", text: "Metadata updated." }] };
  }
);

server.tool(
  "reprocess_file",
  "Re-run extraction and embedding on a file. Useful if processing failed or you want to refresh the embeddings.",
  {
    fileId: z.string().describe("The file ID to reprocess"),
  },
  async ({ fileId }) => {
    await client.reprocessFile(fileId);
    return { content: [{ type: "text", text: "File queued for reprocessing." }] };
  }
);

server.tool(
  "delete_file",
  "Permanently delete a file and its embeddings.",
  {
    fileId: z.string().describe("The file ID to delete"),
  },
  async ({ fileId }) => {
    await client.deleteFile(fileId);
    return { content: [{ type: "text", text: "File deleted." }] };
  }
);

// ════════════════════════════════════════════════════════════════════
//  RAG QUERY TOOLS  (the star of the show)
// ════════════════════════════════════════════════════════════════════

server.tool(
  "query",
  "Query your documents using natural language. This performs semantic search across your embedded documents and optionally generates an AI answer using RAG. You can scope the query to a specific knowledge base, specific files, or tags.",
  {
    input: z.string().describe("The natural language question or search query"),
    knowledgeBaseId: z
      .string()
      .optional()
      .describe("Scope the query to a specific knowledge base"),
    fileIds: z
      .array(z.string())
      .optional()
      .describe("Scope the query to specific file IDs"),
    tags: z
      .array(z.string())
      .optional()
      .describe("Filter by tags"),
    includeAnswer: z
      .boolean()
      .optional()
      .describe("Whether to generate an AI-synthesized answer (default: true)"),
    includeSources: z
      .boolean()
      .optional()
      .describe("Whether to include source chunks (default: true)"),
    includeAnalysis: z
      .boolean()
      .optional()
      .describe("Whether to include analysis metadata (default: false)"),
    model: z
      .string()
      .optional()
      .describe(
        "LLM model for answer generation. Options: gemini-2.0-flash, gemini-2.5-flash, gpt-5, gpt-4o, claude-sonnet-4-6, claude-haiku-4-5, etc."
      ),
  },
  async ({ input, knowledgeBaseId, fileIds, tags, includeAnswer, includeSources, includeAnalysis, model }) => {
    const result = await client.queryEmbeddings({
      input,
      knowledgeBaseId,
      fileIds,
      tags,
      includeAnswer,
      includeSources,
      includeAnalysis,
      model,
    });

    let text = "";
    if (result.result) {
      text += `**Answer:**\n${result.result}\n\n`;
    }
    if (result.embeddings?.length) {
      text += `**Sources (${result.embeddings.length} chunks):**\n`;
      result.embeddings.forEach((emb: any, i: number) => {
        text += `\n--- Source ${i + 1} (score: ${emb.score?.toFixed(3) || "N/A"}) ---\n${emb.text}\n`;
      });
    }
    if (!text) text = "No results found for your query.";

    return { content: [{ type: "text", text }] };
  }
);

// ════════════════════════════════════════════════════════════════════
//  FOLDER TOOLS
// ════════════════════════════════════════════════════════════════════

server.tool(
  "list_folders",
  "List all folders. Folders help organize files hierarchically.",
  {
    parentFolderId: z.string().optional().describe("Parent folder ID to list children of"),
  },
  async ({ parentFolderId }) => {
    const result = await client.listFolders({ parentFolderId });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "create_folder",
  "Create a new folder for organizing files.",
  {
    name: z.string().describe("Folder name"),
    parentFolderId: z.string().optional().describe("Parent folder ID for nesting"),
  },
  async ({ name, parentFolderId }) => {
    const result = await client.createFolder({ name, parentFolderId });
    return { content: [{ type: "text", text: `Folder created with ID: ${result.id}` }] };
  }
);

server.tool(
  "move_file_to_folder",
  "Move a file into a folder.",
  {
    folderId: z.string().describe("The destination folder ID"),
    fileId: z.string().describe("The file ID to move"),
  },
  async ({ folderId, fileId }) => {
    await client.moveFileToFolder(folderId, fileId);
    return { content: [{ type: "text", text: "File moved to folder." }] };
  }
);

server.tool(
  "list_files_and_folders",
  "List files and folders together, optionally within a parent folder. Shows the full file tree.",
  {
    parentId: z.string().optional().describe("Parent folder ID (omit for root)"),
    status: z.string().optional().describe("Filter files by status"),
    skip: z.number().optional().describe("Pagination offset"),
    limit: z.number().optional().describe("Max results"),
  },
  async ({ parentId, status, skip, limit }) => {
    const result = await client.getFilesAndFolders({ parentId, status, skip, limit });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ════════════════════════════════════════════════════════════════════
//  START THE SERVER
// ════════════════════════════════════════════════════════════════════

async function main() {
  if (TRANSPORT === "stdio") {
    // Local mode — for Claude Desktop, Claude Code, etc.
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Indexify MCP Server running on stdio");
  } else {
    // Remote SSE mode — for Dreamer, web clients, etc.
    const app = express();
    app.use(express.json());

    // Health check
    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "indexify-mcp", version: "1.0.0" });
    });

    // Store transports by session
    const transports: Record<string, SSEServerTransport> = {};

    app.get("/sse", async (req, res) => {
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      transports[sessionId] = transport;

      res.on("close", () => {
        delete transports[sessionId];
      });

      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports[sessionId];
      if (!transport) {
        res.status(400).json({ error: "No active SSE session for this sessionId" });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(PORT, () => {
      console.log(`🚀 Indexify MCP Server (SSE) running on http://localhost:${PORT}`);
      console.log(`   SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`   Messages endpoint: http://localhost:${PORT}/messages`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   Connected to: ${INDEXIFY_BASE_URL}`);
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
