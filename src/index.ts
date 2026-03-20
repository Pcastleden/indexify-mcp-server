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
import { IndexifyAuthClient } from "./auth-client.js";

// ── Configuration ──────────────────────────────────────────────────

const INDEXIFY_API_KEY = process.env.INDEXIFY_API_KEY || "";
const INDEXIFY_BASE_URL = process.env.INDEXIFY_BASE_URL || "https://api.indexify.ai";
const INDEXIFY_AUTH_BASE_URL = process.env.INDEXIFY_AUTH_BASE_URL || INDEXIFY_BASE_URL;
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

const authClient = new IndexifyAuthClient({
  baseUrl: INDEXIFY_AUTH_BASE_URL,
  apiKey: INDEXIFY_API_KEY,
});

// ════════════════════════════════════════════════════════════════════
//  SERVER FACTORY — creates a fresh McpServer with all tools registered
//  Each SSE session gets its own instance (McpServer.connect() is one-shot)
// ════════════════════════════════════════════════════════════════════

function createServer(): McpServer {
  const server = new McpServer({
    name: "indexify",
    version: "1.0.0",
  });

  // ── Instruction Prompt ──────────────────────────────────────────

  server.prompt(
    "indexify_workflow",
    "Recommended workflow for using the Indexify MCP server. Read this first before calling any tools.",
    {},
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `# Indexify MCP Server — Recommended Workflow

## Step 1: Resolve the user
Call \`get_or_create_user\` with the user's email address. This returns a userId.
Always do this first — the userId is needed to scope all subsequent operations to the correct user.

## Step 2: Pass userId on all calls
Include the userId on every tool call that accepts it. This ensures each user's documents,
knowledge bases, and queries are isolated from other users.

## Step 3: Organize with knowledge bases
Call \`create_knowledge_base\` to create collections for organizing documents
(e.g. "Financial Documents", "Receipts", "Research Papers").

## Step 4: Upload files or embed text
- Use \`upload_file_base64\` to upload PDFs, images, Word docs, spreadsheets, or scanned documents.
  Indexify performs layout-aware extraction and OCR — always send the original binary file.
- Use \`embed_text\` for raw text content that doesn't come from a file.
- Optionally pass knowledgeBaseIds to add content to knowledge bases immediately.

## Step 5: Query with natural language
Use the \`query\` tool to ask questions across your documents. You can scope queries to
specific knowledge bases, files, or tags. The query tool performs semantic search and
optionally generates an AI-synthesized answer using RAG.

## Key principles
- Always resolve the user first with get_or_create_user
- Always pass userId to keep data isolated per user
- Upload real files (not extracted text) to get the best extraction quality
- Use knowledge bases to organize and scope queries`,
          },
        },
      ],
    })
  );

  // ── USER MANAGEMENT TOOLS ─────────────────────────────────────────

  // 1. get_or_create_user
  server.registerTool(
    "get_or_create_user",
    {
      description: "The first tool to call before any other operation. Resolves or creates a user by email and returns their userId, which should be passed to all subsequent tools to keep each user's data isolated.",
      inputSchema: {
        email: z.string().describe("The user's email address"),
      },
      outputSchema: {
        userId: z.string().describe("The Indexify user ID"),
        created: z.boolean().describe("Whether a new user was created (true) or an existing user was found (false)"),
        message: z.string().describe("Human-readable status message"),
      },
    },
    async ({ email }) => {
      const result = await authClient.getOrCreateUser(email);
      const message = result.created ? "Created new user" : "Found existing user";
      return {
        content: [{ type: "text", text: `${message}. User ID: ${result.userId}` }],
        structuredContent: { userId: result.userId, created: result.created, message },
      };
    }
  );

  // 2. create_user
  server.registerTool(
    "create_user",
    {
      description: "Create a new user in Indexify. Returns the created user object with an id field. Requires user:write scope.",
      inputSchema: {
        firstName: z.string().optional().describe("User's first name"),
        surname: z.string().optional().describe("User's surname"),
        email: z.string().optional().describe("User's email address"),
        phoneNumber: z.string().optional().describe("User's phone number"),
        password: z.string().optional().describe("User's password"),
        roles: z.array(z.string()).optional().describe("Roles to assign to the user"),
        signUpVerificationRequired: z.boolean().optional().describe("Whether email verification is required"),
        additionalInformation: z.string().optional().describe("Additional info as JSON string"),
      },
      outputSchema: {
        id: z.string().describe("The created user's ID"),
        firstName: z.string().optional().describe("User's first name"),
        surname: z.string().optional().describe("User's surname"),
        contactInfo: z.object({ email: z.string().optional(), phoneNumber: z.string().optional() }).optional(),
        roles: z.array(z.string()).optional(),
      },
    },
    async ({ firstName, surname, email, phoneNumber, password, roles, signUpVerificationRequired, additionalInformation }) => {
      const result = await authClient.createUser({
        firstName, surname, contactInfo: { email, phoneNumber }, password, roles, signUpVerificationRequired,
        additionalInformation: additionalInformation ? JSON.parse(additionalInformation) : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    }
  );

  // 3. list_users
  server.registerTool(
    "list_users",
    {
      description: "List users in Indexify. Can filter by email, phone, or userId. Requires user:read scope.",
      inputSchema: {
        email: z.string().optional().describe("Filter by email address"),
        phone: z.string().optional().describe("Filter by phone number"),
        userId: z.string().optional().describe("Filter by user ID"),
        skip: z.number().optional().describe("Pagination offset"),
        limit: z.number().optional().describe("Max results"),
      },
      outputSchema: {
        users: z.array(z.object({
          id: z.string(), firstName: z.string().optional(), surname: z.string().optional(),
          contactInfo: z.object({ email: z.string().optional(), phoneNumber: z.string().optional() }).optional(),
          roles: z.array(z.string()).optional(),
        })).describe("Array of user objects"),
      },
    },
    async ({ email, phone, userId, skip, limit }) => {
      const result = await authClient.listUsers({ email, phone, userId, skip, limit });
      const users = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(users, null, 2) }],
        structuredContent: { users },
      };
    }
  );

  // 4. update_user
  server.registerTool(
    "update_user",
    {
      description: "Update an existing user's details. Requires user:write scope.",
      inputSchema: {
        id: z.string().describe("The user ID to update"),
        firstName: z.string().optional().describe("New first name"),
        surname: z.string().optional().describe("New surname"),
        email: z.string().optional().describe("New email address"),
        phoneNumber: z.string().optional().describe("New phone number"),
        roles: z.array(z.string()).optional().describe("New roles"),
      },
      outputSchema: {
        id: z.string(), firstName: z.string().optional(), surname: z.string().optional(),
        contactInfo: z.object({ email: z.string().optional(), phoneNumber: z.string().optional() }).optional(),
        roles: z.array(z.string()).optional(),
      },
    },
    async ({ id, firstName, surname, email, phoneNumber, roles }) => {
      const result = await authClient.updateUser(id, { firstName, surname, contactInfo: { email, phoneNumber }, roles });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    }
  );

  // 5. delete_user
  server.registerTool(
    "delete_user",
    {
      description: "Delete a user from Indexify. Requires user:write scope.",
      inputSchema: { id: z.string().describe("The user ID to delete") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ id }) => {
      await authClient.deleteUser(id);
      return {
        content: [{ type: "text", text: "User deleted." }],
        structuredContent: { success: true, message: "User deleted." },
      };
    }
  );

  // ── KNOWLEDGE BASE TOOLS ──────────────────────────────────────────

  // 6. list_knowledge_bases
  server.registerTool(
    "list_knowledge_bases",
    {
      description: "List all knowledge bases. A knowledge base is a collection of documents that can be queried together using RAG. Pass a userId to scope results to a specific user's data.",
      inputSchema: {
        search: z.string().optional().describe("Search term to filter knowledge bases by name"),
        skip: z.number().optional().describe("Number of results to skip for pagination"),
        limit: z.number().optional().describe("Maximum number of results to return"),
        userId: z.string().optional().describe("Scope to a specific user's knowledge bases"),
      },
      outputSchema: {
        knowledgeBases: z.array(z.object({
          id: z.string(), name: z.string(), description: z.string().optional(),
          fileCount: z.number().optional(), agentCount: z.number().optional(),
        })).describe("Array of knowledge base objects"),
      },
    },
    async ({ search, skip, limit, userId }) => {
      const result = await client.listKnowledgeBases({ search, skip, limit, userId });
      const knowledgeBases = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(knowledgeBases, null, 2) }],
        structuredContent: { knowledgeBases },
      };
    }
  );

  // 7. get_knowledge_base
  server.registerTool(
    "get_knowledge_base",
    {
      description: "Get details of a specific knowledge base including its file count and agent count.",
      inputSchema: { knowledgeBaseId: z.string().describe("The ID of the knowledge base") },
      outputSchema: {
        id: z.string(), name: z.string(), description: z.string().optional(),
        fileCount: z.number().optional(), agentCount: z.number().optional(),
      },
    },
    async ({ knowledgeBaseId }) => {
      const result = await client.getKnowledgeBase(knowledgeBaseId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    }
  );

  // 8. create_knowledge_base
  server.registerTool(
    "create_knowledge_base",
    {
      description: "Create a new knowledge base. Use this to organize documents into queryable collections (e.g. 'Financial Documents', 'Personal Vault', 'Receipts').",
      inputSchema: {
        name: z.string().describe("Name for the knowledge base"),
        description: z.string().optional().describe("Description of what this knowledge base contains"),
      },
      outputSchema: { id: z.string().describe("The created knowledge base ID"), message: z.string() },
    },
    async ({ name, description }) => {
      const result = await client.createKnowledgeBase({ name, description });
      return {
        content: [{ type: "text", text: `Knowledge base created with ID: ${result.id}` }],
        structuredContent: { id: result.id, message: `Knowledge base created with ID: ${result.id}` },
      };
    }
  );

  // 9. update_knowledge_base
  server.registerTool(
    "update_knowledge_base",
    {
      description: "Update the name or description of an existing knowledge base.",
      inputSchema: {
        knowledgeBaseId: z.string().describe("The ID of the knowledge base to update"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
      },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ knowledgeBaseId, name, description }) => {
      await client.updateKnowledgeBase(knowledgeBaseId, { name, description });
      return {
        content: [{ type: "text", text: "Knowledge base updated successfully." }],
        structuredContent: { success: true, message: "Knowledge base updated successfully." },
      };
    }
  );

  // 10. delete_knowledge_base
  server.registerTool(
    "delete_knowledge_base",
    {
      description: "Delete a knowledge base. This removes the knowledge base but not the underlying files.",
      inputSchema: { knowledgeBaseId: z.string().describe("The ID of the knowledge base to delete") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ knowledgeBaseId }) => {
      await client.deleteKnowledgeBase(knowledgeBaseId);
      return {
        content: [{ type: "text", text: "Knowledge base deleted." }],
        structuredContent: { success: true, message: "Knowledge base deleted." },
      };
    }
  );

  // 11. list_knowledge_base_files
  server.registerTool(
    "list_knowledge_base_files",
    {
      description: "List all files/documents in a specific knowledge base.",
      inputSchema: {
        knowledgeBaseId: z.string().describe("The ID of the knowledge base"),
        skip: z.number().optional().describe("Number of results to skip"),
        limit: z.number().optional().describe("Maximum results to return"),
      },
      outputSchema: {
        files: z.array(z.object({
          id: z.string(), displayName: z.string().optional(), status: z.string().optional(), tags: z.array(z.string()).optional(),
        })).describe("Array of file objects in the knowledge base"),
      },
    },
    async ({ knowledgeBaseId, skip, limit }) => {
      const result = await client.getKnowledgeBaseFiles(knowledgeBaseId, { skip, limit });
      const files = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
        structuredContent: { files },
      };
    }
  );

  // 12. add_file_to_knowledge_base
  server.registerTool(
    "add_file_to_knowledge_base",
    {
      description: "Add an existing file to a knowledge base so it becomes queryable within that collection.",
      inputSchema: {
        knowledgeBaseId: z.string().describe("The knowledge base ID"),
        fileId: z.string().describe("The file ID to add"),
      },
      outputSchema: { success: z.boolean(), message: z.string(), fileId: z.string(), knowledgeBaseId: z.string() },
    },
    async ({ knowledgeBaseId, fileId }) => {
      await client.addFileToKnowledgeBase(knowledgeBaseId, fileId);
      return {
        content: [{ type: "text", text: `File ${fileId} added to knowledge base.` }],
        structuredContent: { success: true, message: `File ${fileId} added to knowledge base.`, fileId, knowledgeBaseId },
      };
    }
  );

  // 13. remove_file_from_knowledge_base
  server.registerTool(
    "remove_file_from_knowledge_base",
    {
      description: "Remove a file from a knowledge base (the file itself is not deleted).",
      inputSchema: {
        knowledgeBaseId: z.string().describe("The knowledge base ID"),
        fileId: z.string().describe("The file ID to remove"),
      },
      outputSchema: { success: z.boolean(), message: z.string(), fileId: z.string(), knowledgeBaseId: z.string() },
    },
    async ({ knowledgeBaseId, fileId }) => {
      await client.removeFileFromKnowledgeBase(knowledgeBaseId, fileId);
      return {
        content: [{ type: "text", text: `File ${fileId} removed from knowledge base.` }],
        structuredContent: { success: true, message: `File ${fileId} removed from knowledge base.`, fileId, knowledgeBaseId },
      };
    }
  );

  // ── FILE TOOLS ────────────────────────────────────────────────────

  // 14. list_files
  server.registerTool(
    "list_files",
    {
      description: "List all uploaded files. Can filter by tag, status, or search term. Pass a userId to scope results to a specific user's files.",
      inputSchema: {
        tag: z.string().optional().describe("Filter by tag"),
        status: z.string().optional().describe("Filter by status (e.g. 'embedded', 'processing', 'error')"),
        search: z.string().optional().describe("Search term"),
        skip: z.number().optional().describe("Pagination offset"),
        limit: z.number().optional().describe("Max results"),
        userId: z.string().optional().describe("Scope to a specific user's files"),
      },
      outputSchema: {
        files: z.array(z.object({
          id: z.string(), displayName: z.string().optional(), status: z.string().optional(),
          tags: z.array(z.string()).optional(), summary: z.string().optional(), metadata: z.string().optional(),
        })).describe("Array of file objects"),
      },
    },
    async ({ tag, status, search, skip, limit, userId }) => {
      const result = await client.listFiles({ tag, status, search, skip, limit, userId });
      const files = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
        structuredContent: { files },
      };
    }
  );

  // 15. get_file
  server.registerTool(
    "get_file",
    {
      description: "Get details about a specific file including its status, tags, summary, and metadata.",
      inputSchema: { fileId: z.string().describe("The file ID") },
      outputSchema: {
        id: z.string(), displayName: z.string().optional(), status: z.string().optional(),
        tags: z.array(z.string()).optional(), summary: z.string().optional(),
        metadata: z.string().optional(), mimeType: z.string().optional(), createdAt: z.string().optional(),
      },
    },
    async ({ fileId }) => {
      const result = await client.getFile(fileId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    }
  );

  // 16. upload_file_base64
  server.registerTool(
    "upload_file_base64",
    {
      description: "Upload a file to Indexify from base64-encoded content. Supports PDFs, images (JPG, PNG, TIFF, BMP, WebP, GIF), Word docs (DOC, DOCX), spreadsheets (XLS, XLSX, CSV), presentations (PPTX), and scanned documents. Indexify performs layout-aware extraction and OCR on uploaded files — always send the original binary file rather than pre-extracted text to get the best quality results.",
      inputSchema: {
        fileBase64: z.string().describe("The base64-encoded file content"),
        fileName: z.string().describe("The file name with extension (e.g. 'bank-statement.pdf')"),
        userId: z.string().describe("The Indexify user ID (required). Call get_or_create_user first to obtain this."),
        tags: z.array(z.string()).optional().describe("Tags to categorize the file"),
        metadata: z.string().optional().describe("Additional metadata as a string"),
        knowledgeBaseIds: z.array(z.string()).optional().describe("Knowledge base IDs to immediately add this file to"),
        folderId: z.string().optional().describe("Folder ID to place the file in"),
      },
      outputSchema: { fileId: z.string().describe("The uploaded file's ID"), message: z.string() },
    },
    async ({ fileBase64, fileName, userId, tags, metadata, knowledgeBaseIds, folderId }) => {
      const fileId = await client.uploadFileBase64({ fileBase64, fileName, tags, metadata, knowledgeBaseIds, folderId, userId });
      return {
        content: [{ type: "text", text: `File uploaded successfully. File ID: ${fileId}` }],
        structuredContent: { fileId, message: `File uploaded successfully. File ID: ${fileId}` },
      };
    }
  );

  // 17. embed_text
  server.registerTool(
    "embed_text",
    {
      description: "Ingest raw text content into Indexify. The text will be chunked, embedded, and made queryable. Returns a file ID. Optionally add it directly to knowledge bases. Pass a userId to scope this content to a specific user.",
      inputSchema: {
        text: z.string().describe("The text content to embed"),
        title: z.string().optional().describe("A title for this text content"),
        tags: z.array(z.string()).optional().describe("Tags to categorize the content"),
        metadata: z.string().optional().describe("Additional metadata as a string"),
        knowledgeBaseIds: z.array(z.string()).optional().describe("Knowledge base IDs to immediately add this content to"),
        correlationId: z.string().optional().describe("External correlation ID for tracking"),
        userId: z.string().optional().describe("Scope to a specific user's data"),
      },
      outputSchema: { fileId: z.string().describe("The created file ID for the embedded text"), message: z.string() },
    },
    async ({ text, title, tags, metadata, knowledgeBaseIds, correlationId, userId }) => {
      const fileId = await client.embedText({ text, title, tags, metadata, knowledgeBaseIds, correlationId, userId });
      return {
        content: [{ type: "text", text: `Text embedded successfully. File ID: ${fileId}` }],
        structuredContent: { fileId: String(fileId), message: `Text embedded successfully. File ID: ${fileId}` },
      };
    }
  );

  // 18. get_file_text
  server.registerTool(
    "get_file_text",
    {
      description: "Download the extracted text content of a file. Useful for reading what was extracted from a PDF, image, or other document.",
      inputSchema: { fileId: z.string().describe("The file ID") },
      outputSchema: { text: z.string().describe("The extracted text content of the file") },
    },
    async ({ fileId }) => {
      const text = await client.getFileText(fileId);
      const textStr = typeof text === "string" ? text : JSON.stringify(text);
      return {
        content: [{ type: "text", text: textStr }],
        structuredContent: { text: textStr },
      };
    }
  );

  // 19. annotate_file
  server.registerTool(
    "annotate_file",
    {
      description: "Use AI to automatically generate a summary, tags, and potential questions for a file. Great for auto-categorizing uploaded documents.",
      inputSchema: { fileId: z.string().describe("The file ID to annotate") },
      outputSchema: {
        summary: z.string().optional().describe("AI-generated summary of the file"),
        tags: z.array(z.string()).optional().describe("AI-suggested tags"),
        questions: z.array(z.string()).optional().describe("Potential questions that can be answered from this file"),
      },
    },
    async ({ fileId }) => {
      const result = await client.annotateFile(fileId);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    }
  );

  // 20. add_tag_to_file
  server.registerTool(
    "add_tag_to_file",
    {
      description: "Add a tag to a file for categorization and filtering.",
      inputSchema: { fileId: z.string().describe("The file ID"), tag: z.string().describe("The tag to add") },
      outputSchema: { success: z.boolean(), message: z.string(), fileId: z.string(), tag: z.string() },
    },
    async ({ fileId, tag }) => {
      await client.addTag(fileId, tag);
      return {
        content: [{ type: "text", text: `Tag '${tag}' added to file.` }],
        structuredContent: { success: true, message: `Tag '${tag}' added to file.`, fileId, tag },
      };
    }
  );

  // 21. remove_tag_from_file
  server.registerTool(
    "remove_tag_from_file",
    {
      description: "Remove a tag from a file.",
      inputSchema: { fileId: z.string().describe("The file ID"), tag: z.string().describe("The tag to remove") },
      outputSchema: { success: z.boolean(), message: z.string(), fileId: z.string(), tag: z.string() },
    },
    async ({ fileId, tag }) => {
      await client.removeTag(fileId, tag);
      return {
        content: [{ type: "text", text: `Tag '${tag}' removed from file.` }],
        structuredContent: { success: true, message: `Tag '${tag}' removed from file.`, fileId, tag },
      };
    }
  );

  // 22. get_file_download_link
  server.registerTool(
    "get_file_download_link",
    {
      description: "Generate a temporary download link for the original uploaded file.",
      inputSchema: { fileId: z.string().describe("The file ID") },
      outputSchema: { url: z.string().describe("Temporary download URL for the file") },
    },
    async ({ fileId }) => {
      const result = await client.getDownloadLink(fileId);
      return {
        content: [{ type: "text", text: `Download URL: ${result.url}` }],
        structuredContent: { url: result.url },
      };
    }
  );

  // 23. get_file_images
  server.registerTool(
    "get_file_images",
    {
      description: "Get page images extracted from a document (e.g. PDF pages as images).",
      inputSchema: {
        fileId: z.string().describe("The file ID"),
        skip: z.number().optional().describe("Pages to skip"),
        limit: z.number().optional().describe("Max pages to return"),
      },
      outputSchema: {
        images: z.array(z.object({ page: z.number(), url: z.string() })).describe("Array of page images"),
      },
    },
    async ({ fileId, skip, limit }) => {
      const result = await client.getFileImages(fileId, { skip, limit });
      const images = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(images, null, 2) }],
        structuredContent: { images },
      };
    }
  );

  // 24. update_file_display_name
  server.registerTool(
    "update_file_display_name",
    {
      description: "Update the display name of a file.",
      inputSchema: { fileId: z.string().describe("The file ID"), displayName: z.string().describe("The new display name") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ fileId, displayName }) => {
      await client.updateDisplayName(fileId, displayName);
      return {
        content: [{ type: "text", text: "Display name updated." }],
        structuredContent: { success: true, message: "Display name updated." },
      };
    }
  );

  // 25. update_file_metadata
  server.registerTool(
    "update_file_metadata",
    {
      description: "Update the metadata string of a file.",
      inputSchema: { fileId: z.string().describe("The file ID"), metadata: z.string().describe("The new metadata string") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ fileId, metadata }) => {
      await client.updateMetadata(fileId, metadata);
      return {
        content: [{ type: "text", text: "Metadata updated." }],
        structuredContent: { success: true, message: "Metadata updated." },
      };
    }
  );

  // 26. reprocess_file
  server.registerTool(
    "reprocess_file",
    {
      description: "Re-run extraction and embedding on a file. Useful if processing failed or you want to refresh the embeddings.",
      inputSchema: { fileId: z.string().describe("The file ID to reprocess") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ fileId }) => {
      await client.reprocessFile(fileId);
      return {
        content: [{ type: "text", text: "File queued for reprocessing." }],
        structuredContent: { success: true, message: "File queued for reprocessing." },
      };
    }
  );

  // 27. delete_file
  server.registerTool(
    "delete_file",
    {
      description: "Permanently delete a file and its embeddings.",
      inputSchema: { fileId: z.string().describe("The file ID to delete") },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ fileId }) => {
      await client.deleteFile(fileId);
      return {
        content: [{ type: "text", text: "File deleted." }],
        structuredContent: { success: true, message: "File deleted." },
      };
    }
  );

  // ── RAG QUERY TOOLS ───────────────────────────────────────────────

  // 28. query
  server.registerTool(
    "query",
    {
      description: "Query your documents using natural language. This performs semantic search across your embedded documents and optionally generates an AI answer using RAG. You can scope the query to a specific knowledge base, specific files, or tags. Pass a userId to scope the query to a specific user's documents.",
      inputSchema: {
        input: z.string().describe("The natural language question or search query"),
        knowledgeBaseId: z.string().optional().describe("Scope the query to a specific knowledge base"),
        fileIds: z.array(z.string()).optional().describe("Scope the query to specific file IDs"),
        tags: z.array(z.string()).optional().describe("Filter by tags"),
        includeAnswer: z.boolean().optional().describe("Whether to generate an AI-synthesized answer (default: true)"),
        includeSources: z.boolean().optional().describe("Whether to include source chunks (default: true)"),
        includeAnalysis: z.boolean().optional().describe("Whether to include analysis metadata (default: false)"),
        model: z.string().optional().describe("LLM model for answer generation. Options: gemini-2.0-flash, gemini-2.5-flash, gpt-5, gpt-4o, claude-sonnet-4-6, claude-haiku-4-5, etc."),
        userId: z.string().optional().describe("Scope the query to a specific user's documents"),
      },
      outputSchema: {
        answer: z.string().optional().describe("AI-generated answer from RAG"),
        sources: z.array(z.object({ text: z.string(), score: z.number().optional() })).optional().describe("Matching source chunks"),
        sourceCount: z.number().describe("Number of source chunks returned"),
      },
    },
    async ({ input, knowledgeBaseId, fileIds, tags, includeAnswer, includeSources, includeAnalysis, model, userId }) => {
      const result = await client.queryEmbeddings({
        input, knowledgeBaseId, fileIds, tags, includeAnswer, includeSources, includeAnalysis, model, userId,
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

      const sources = result.embeddings?.map((emb: any) => ({ text: emb.text, score: emb.score })) || [];
      return {
        content: [{ type: "text", text }],
        structuredContent: { answer: result.result || undefined, sources, sourceCount: sources.length },
      };
    }
  );

  // ── FOLDER TOOLS ──────────────────────────────────────────────────

  // 29. list_folders
  server.registerTool(
    "list_folders",
    {
      description: "List all folders. Folders help organize files hierarchically. Pass a userId to scope results to a specific user's folders.",
      inputSchema: {
        parentFolderId: z.string().optional().describe("Parent folder ID to list children of"),
        userId: z.string().optional().describe("Scope to a specific user's folders"),
      },
      outputSchema: {
        folders: z.array(z.object({ id: z.string(), name: z.string(), parentFolderId: z.string().optional() })).describe("Array of folder objects"),
      },
    },
    async ({ parentFolderId, userId }) => {
      const result = await client.listFolders({ parentFolderId, userId });
      const folders = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
        structuredContent: { folders },
      };
    }
  );

  // 30. create_folder
  server.registerTool(
    "create_folder",
    {
      description: "Create a new folder for organizing files.",
      inputSchema: {
        name: z.string().describe("Folder name"),
        parentFolderId: z.string().optional().describe("Parent folder ID for nesting"),
      },
      outputSchema: { id: z.string().describe("The created folder's ID"), message: z.string() },
    },
    async ({ name, parentFolderId }) => {
      const result = await client.createFolder({ name, parentFolderId });
      return {
        content: [{ type: "text", text: `Folder created with ID: ${result.id}` }],
        structuredContent: { id: result.id, message: `Folder created with ID: ${result.id}` },
      };
    }
  );

  // 31. move_file_to_folder
  server.registerTool(
    "move_file_to_folder",
    {
      description: "Move a file into a folder.",
      inputSchema: {
        folderId: z.string().describe("The destination folder ID"),
        fileId: z.string().describe("The file ID to move"),
      },
      outputSchema: { success: z.boolean(), message: z.string() },
    },
    async ({ folderId, fileId }) => {
      await client.moveFileToFolder(folderId, fileId);
      return {
        content: [{ type: "text", text: "File moved to folder." }],
        structuredContent: { success: true, message: "File moved to folder." },
      };
    }
  );

  // 32. list_files_and_folders
  server.registerTool(
    "list_files_and_folders",
    {
      description: "List files and folders together, optionally within a parent folder. Shows the full file tree. Pass a userId to scope results to a specific user's data.",
      inputSchema: {
        parentId: z.string().optional().describe("Parent folder ID (omit for root)"),
        status: z.string().optional().describe("Filter files by status"),
        skip: z.number().optional().describe("Pagination offset"),
        limit: z.number().optional().describe("Max results"),
        userId: z.string().optional().describe("Scope to a specific user's data"),
      },
      outputSchema: {
        items: z.array(z.object({
          id: z.string(), type: z.string().optional(), name: z.string().optional(),
          displayName: z.string().optional(), status: z.string().optional(),
        })).describe("Array of file and folder objects"),
      },
    },
    async ({ parentId, status, skip, limit, userId }) => {
      const result = await client.getFilesAndFolders({ parentId, status, skip, limit, userId });
      const items = Array.isArray(result) ? result : [];
      return {
        content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
        structuredContent: { items },
      };
    }
  );

  return server;
}

// ════════════════════════════════════════════════════════════════════
//  START THE SERVER
// ════════════════════════════════════════════════════════════════════

async function main() {
  if (TRANSPORT === "stdio") {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Indexify MCP Server running on stdio");
  } else {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", server: "indexify-mcp", version: "1.0.0" });
    });

    // Each SSE session gets its own McpServer instance
    const sessions: Record<string, { server: McpServer; transport: SSEServerTransport }> = {};

    app.get("/sse", async (req, res) => {
      // Keep-alive headers to prevent proxy/load-balancer from closing the SSE stream
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // nginx/Railway proxy buffering off

      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;
      const server = createServer();
      sessions[sessionId] = { server, transport };
      console.log(`[SSE] Session ${sessionId} connected (${Object.keys(sessions).length} active)`);

      res.on("close", () => {
        console.log(`[SSE] Session ${sessionId} disconnected`);
        server.close().catch(() => {});
        delete sessions[sessionId];
      });

      await server.connect(transport);
    });

    app.post("/messages", async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const session = sessions[sessionId];
      if (!session) {
        console.error(`[POST /messages] No session for ${sessionId}. Active sessions: ${Object.keys(sessions).join(", ") || "none"}`);
        res.status(400).json({ error: "No active SSE session for this sessionId" });
        return;
      }
      await session.transport.handlePostMessage(req, res, req.body);
    });

    app.listen(PORT, () => {
      console.log(`🚀 Indexify MCP Server (SSE) running on http://localhost:${PORT}`);
      console.log(`   SSE endpoint: http://localhost:${PORT}/sse`);
      console.log(`   Messages endpoint: http://localhost:${PORT}/messages`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
      console.log(`   Connected to: ${INDEXIFY_BASE_URL}`);
      console.log(`   Auth API: ${INDEXIFY_AUTH_BASE_URL}`);
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
