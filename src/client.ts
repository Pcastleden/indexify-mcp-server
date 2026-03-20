/**
 * Indexify API Client
 * Wraps the Indexify REST API for use by the MCP server tools.
 */

const DEFAULT_BASE_URL = "https://api.indexify.ai";

export interface IndexifyClientConfig {
  baseUrl?: string;
  apiKey: string;
}

export class IndexifyClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: IndexifyClientConfig) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { ...this.headers(), ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Indexify API ${method} ${path} failed (${res.status}): ${text}`);
    }

    // 204 No Content
    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json() as Promise<T>;
    }
    return (await res.text()) as T;
  }

  // ── Knowledge Bases ──────────────────────────────────────────────

  async listKnowledgeBases(params?: { search?: string; skip?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.search) qs.set("search", params.search);
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<any>("GET", `/knowledge-base${q ? `?${q}` : ""}`);
  }

  async getKnowledgeBase(knowledgeBaseId: string) {
    return this.request<any>("GET", `/knowledge-base/${knowledgeBaseId}`);
  }

  async createKnowledgeBase(data: { name: string; description?: string }) {
    return this.request<{ id: string }>("POST", "/knowledge-base", data);
  }

  async updateKnowledgeBase(knowledgeBaseId: string, data: { name?: string; description?: string }) {
    return this.request<void>("PUT", `/knowledge-base/${knowledgeBaseId}`, data);
  }

  async deleteKnowledgeBase(knowledgeBaseId: string) {
    return this.request<void>("DELETE", `/knowledge-base/${knowledgeBaseId}`);
  }

  async getKnowledgeBaseFiles(knowledgeBaseId: string, params?: { skip?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<any>("GET", `/knowledge-base/${knowledgeBaseId}/embedding-files${q ? `?${q}` : ""}`);
  }

  async addFileToKnowledgeBase(knowledgeBaseId: string, fileId: string) {
    return this.request<void>(
      "POST",
      `/knowledge-base/${knowledgeBaseId}/embedding-files/${fileId}`
    );
  }

  async removeFileFromKnowledgeBase(knowledgeBaseId: string, fileId: string) {
    return this.request<void>(
      "DELETE",
      `/knowledge-base/${knowledgeBaseId}/embedding-files/${fileId}`
    );
  }

  // ── Files ────────────────────────────────────────────────────────

  async listFiles(params?: { tag?: string; status?: string; skip?: number; limit?: number; search?: string }) {
    const qs = new URLSearchParams();
    if (params?.tag) qs.set("tag", params.tag);
    if (params?.status) qs.set("status", params.status);
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    if (params?.search) qs.set("search", params.search);
    const q = qs.toString();
    return this.request<any>("GET", `/file${q ? `?${q}` : ""}`);
  }

  async getFile(fileId: string) {
    return this.request<any>("GET", `/file/${fileId}`);
  }

  async deleteFile(fileId: string) {
    return this.request<void>("DELETE", `/file/${fileId}`);
  }

  async embedText(data: {
    text: string;
    title?: string;
    tags?: string[];
    metadata?: string;
    knowledgeBaseIds?: string[];
    correlationId?: string;
  }) {
    return this.request<string>("POST", "/file/text", data);
  }

  async uploadFileFromUrl(params: {
    url: string;
    tags?: string;
    metadata?: string;
    knowledgeBaseIds?: string;
    folderId?: string;
  }) {
    // For URL-based uploads, we fetch the file first then upload
    // This is a helper — the actual upload endpoint uses multipart/form-data
    // which is handled separately
    throw new Error("File upload from URL requires multipart handling - use embedText for text content or upload via the Indexify UI");
  }

  async getFileText(fileId: string) {
    return this.request<string>("GET", `/file/${fileId}/text/download`);
  }

  async getFileSplitText(fileId: string) {
    return this.request<string>("GET", `/file/${fileId}/split/download`);
  }

  async annotateFile(fileId: string) {
    return this.request<{ summary?: string; tags?: string[]; questions?: string[] }>(
      "POST",
      `/file/${fileId}/annotate`
    );
  }

  async addTag(fileId: string, tag: string) {
    return this.request<void>("POST", `/file/${fileId}/tag?tag=${encodeURIComponent(tag)}`);
  }

  async removeTag(fileId: string, tag: string) {
    return this.request<void>("DELETE", `/file/${fileId}/tag?tag=${encodeURIComponent(tag)}`);
  }

  async getFileEmbeddings(fileId: string, params?: { skip?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<Array<{ text: string; embedding: number[] }>>(
      "GET",
      `/file/${fileId}/embeddings${q ? `?${q}` : ""}`
    );
  }

  async getFileImages(fileId: string, params?: { skip?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<Array<{ page: number; url: string }>>(
      "GET",
      `/file/${fileId}/images${q ? `?${q}` : ""}`
    );
  }

  async getDownloadLink(fileId: string) {
    return this.request<{ url: string }>("GET", `/file/${fileId}/download-link`);
  }

  async reprocessFile(fileId: string) {
    return this.request<void>("POST", `/file/${fileId}/reprocess`);
  }

  async updateDisplayName(fileId: string, displayName: string) {
    return this.request<void>(
      "POST",
      `/file/${fileId}/display-name?displayName=${encodeURIComponent(displayName)}`
    );
  }

  async updateMetadata(fileId: string, metadata: string) {
    return this.request<void>(
      "POST",
      `/file/${fileId}/metadata?metadata=${encodeURIComponent(metadata)}`
    );
  }

  // ── RAG Query ────────────────────────────────────────────────────

  async queryEmbeddings(params: {
    input: string;
    knowledgeBaseId?: string;
    fileIds?: string[];
    tags?: string[];
    includeAnswer?: boolean;
    includeAnalysis?: boolean;
    includeSources?: boolean;
    model?: string;
  }) {
    const qs = new URLSearchParams();
    qs.set("input", params.input);
    if (params.knowledgeBaseId) qs.set("knowledgeBaseId", params.knowledgeBaseId);
    if (params.fileIds?.length) {
      params.fileIds.forEach((id) => qs.append("fileIds", id));
    }
    if (params.tags?.length) {
      params.tags.forEach((tag) => qs.append("tags", tag));
    }
    if (params.includeAnswer !== undefined) qs.set("includeAnswer", String(params.includeAnswer));
    if (params.includeAnalysis !== undefined) qs.set("includeAnalysis", String(params.includeAnalysis));
    if (params.includeSources !== undefined) qs.set("includeSources", String(params.includeSources));
    if (params.model) qs.set("model", params.model);
    return this.request<{ result?: string; embeddings: Array<{ text: string; score: number }> }>(
      "GET",
      `/file/rag/query?${qs.toString()}`
    );
  }

  // ── Folders ──────────────────────────────────────────────────────

  async listFolders(params?: { parentFolderId?: string }) {
    const qs = new URLSearchParams();
    if (params?.parentFolderId) qs.set("parentFolderId", params.parentFolderId);
    const q = qs.toString();
    return this.request<any>("GET", `/folder${q ? `?${q}` : ""}`);
  }

  async createFolder(data: { name: string; parentFolderId?: string }) {
    return this.request<{ id: string }>("POST", "/folder", data);
  }

  async getFolder(folderId: string) {
    return this.request<any>("GET", `/folder/${folderId}`);
  }

  async deleteFolder(folderId: string, force?: boolean) {
    const qs = force ? "?force=true" : "";
    return this.request<void>("DELETE", `/folder/${folderId}${qs}`);
  }

  async getFilesInFolder(folderId: string) {
    return this.request<any>("GET", `/folder/${folderId}/files`);
  }

  async moveFileToFolder(folderId: string, fileId: string) {
    return this.request<void>("POST", `/folder/${folderId}/files/${fileId}`);
  }

  // ── Files & Folders combined ─────────────────────────────────────

  async getFilesAndFolders(params?: { parentId?: string; status?: string; skip?: number; limit?: number }) {
    const qs = new URLSearchParams();
    if (params?.parentId) qs.set("parentId", params.parentId);
    if (params?.status) qs.set("status", params.status);
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<any>("GET", `/file-and-folders${q ? `?${q}` : ""}`);
  }
}
