/**
 * Indexify Auth API Client
 * Wraps the Indexify user management REST API.
 */

export interface AuthClientConfig {
  baseUrl: string;
  apiKey: string;
}

export interface UserContactInfo {
  email?: string;
  phoneNumber?: string;
}

export interface CreateUserData {
  firstName?: string;
  surname?: string;
  contactInfo: UserContactInfo;
  password?: string;
  roles?: string[];
  signUpVerificationRequired?: boolean;
  additionalInformation?: Record<string, unknown>;
}

export interface User {
  id: string;
  firstName?: string;
  surname?: string;
  contactInfo?: UserContactInfo;
  roles?: string[];
  [key: string]: unknown;
}

export class IndexifyAuthClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: AuthClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiKey = config.apiKey;
  }

  private headers(): Record<string, string> {
    return {
      authorization: this.apiKey.startsWith("Basic ") ? this.apiKey : `Bearer ${this.apiKey}`,
      "content-type": "application/json",
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Indexify Auth API ${method} ${path} failed (${res.status}): ${text}`);
    }

    if (res.status === 204) return undefined as T;

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return res.json() as Promise<T>;
    }
    return (await res.text()) as T;
  }

  async createUser(data: CreateUserData): Promise<User> {
    return this.request<User>("POST", "/user", data);
  }

  async listUsers(params?: {
    email?: string;
    phone?: string;
    userId?: string;
    skip?: number;
    limit?: number;
  }): Promise<User[]> {
    const qs = new URLSearchParams();
    if (params?.email) qs.set("email", params.email);
    if (params?.phone) qs.set("phone", params.phone);
    if (params?.userId) qs.set("userId", params.userId);
    if (params?.skip !== undefined) qs.set("skip", String(params.skip));
    if (params?.limit !== undefined) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return this.request<User[]>("GET", `/user${q ? `?${q}` : ""}`);
  }

  async updateUser(
    id: string,
    data: Partial<CreateUserData>
  ): Promise<User> {
    return this.request<User>("PATCH", `/user/${id}`, data);
  }

  async deleteUser(id: string): Promise<void> {
    return this.request<void>("DELETE", `/user/${id}`);
  }

  async getOrCreateUser(email: string): Promise<{ userId: string; created: boolean }> {
    const users = await this.listUsers({ email });
    if (users && users.length > 0) {
      return { userId: users[0].id, created: false };
    }
    const newUser = await this.createUser({
      contactInfo: { email },
    });
    return { userId: newUser.id, created: true };
  }
}
