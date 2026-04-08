/**
 * Credential Resolver
 *
 * Interface for resolving ERPNext connection credentials.
 * EnvCredentialResolver reads from environment variables (single-site mode).
 */

export interface ConnectionInfo {
  id: string;
  name: string;
  url?: string;
}

export interface ConnectionCredentials {
  url: string;
  apiKey: string;
  apiSecret: string;
  company?: string;
}

export interface CredentialResolver {
  listConnections(): Promise<ConnectionInfo[]>;
  getCredentials(id: string): Promise<ConnectionCredentials>;
}

/**
 * Resolves credentials from ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET env vars.
 * Returns a single "default" connection.
 */
export class EnvCredentialResolver implements CredentialResolver {
  async listConnections(): Promise<ConnectionInfo[]> {
    const url = process.env.ERPNEXT_URL;
    if (!url) return [];
    return [{ id: "default", name: "Default (env)", url }];
  }

  async getCredentials(id: string): Promise<ConnectionCredentials> {
    if (id !== "default") {
      throw new Error(`EnvCredentialResolver only supports id "default", got "${id}"`);
    }
    const url = process.env.ERPNEXT_URL;
    const apiKey = process.env.ERPNEXT_API_KEY;
    const apiSecret = process.env.ERPNEXT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new Error("ERPNEXT_URL, ERPNEXT_API_KEY, and ERPNEXT_API_SECRET must be set");
    }
    return { url, apiKey, apiSecret };
  }
}
