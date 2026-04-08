/**
 * Cosmos DB Credential Resolver
 *
 * Reads ERPNext connection credentials from the erp-demo-studio Cosmos DB.
 * Requires COSMOS_ENDPOINT and COSMOS_KEY environment variables.
 */

import { CosmosClient, Container } from "@azure/cosmos";
import { CredentialResolver, ConnectionInfo, ConnectionCredentials } from "../credentials.js";

export class CosmosCredentialResolver implements CredentialResolver {
  private container: Container;

  constructor() {
    const endpoint = process.env.COSMOS_ENDPOINT;
    const key = process.env.COSMOS_KEY;
    const database = process.env.COSMOS_DATABASE || "erp-demo-studio";

    if (!endpoint || !key) {
      throw new Error("COSMOS_ENDPOINT and COSMOS_KEY must be set");
    }

    const client = new CosmosClient({ endpoint, key });
    this.container = client.database(database).container("companies");
  }

  async listConnections(): Promise<ConnectionInfo[]> {
    const { resources } = await this.container.items.query(
      "SELECT c.id, c.name, c.industry, c.country, c.currency, c.erp_config.site_url FROM c ORDER BY c.created_at DESC"
    ).fetchAll();
    return resources.map((r: any) => ({
      id: r.id,
      name: r.name,
      url: r.site_url
    }));
  }

  async getCredentials(id: string): Promise<ConnectionCredentials> {
    const { resource: company } = await this.container.item(id, id).read();
    if (!company) {
      throw new Error(`Company ${id} not found in Cosmos DB`);
    }
    const config = company.erp_config || {};
    if (!config.site_url || !config.api_key || !config.api_secret) {
      throw new Error(`Company ${id} missing erp_config credentials (site_url, api_key, api_secret)`);
    }
    return {
      url: config.site_url,
      apiKey: config.api_key,
      apiSecret: config.api_secret,
      company: company.name || undefined,
    };
  }
}
