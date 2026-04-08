/**
 * ERPNext API Client
 *
 * Generic HTTP client for the ERPNext/Frappe REST API.
 * Handles authentication and provides typed wrappers for common operations.
 */

import axios, { AxiosInstance } from "axios";

export class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;

  constructor(url?: string, apiKey?: string, apiSecret?: string) {
    this.baseUrl = (url || process.env.ERPNEXT_URL || '').replace(/\/$/, '');

    if (!this.baseUrl) {
      throw new Error("ERPNext URL is required (pass directly or set ERPNEXT_URL)");
    }

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const key = apiKey || process.env.ERPNEXT_API_KEY;
    const secret = apiSecret || process.env.ERPNEXT_API_SECRET;

    if (key && secret) {
      this.axiosInstance.defaults.headers.common['Authorization'] =
        `token ${key}:${secret}`;
      this.authenticated = true;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  async getDocument(doctype: string, name: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/resource/${doctype}/${name}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  async getDocList(doctype: string, filters?: Record<string, any>, fields?: string[], limit?: number): Promise<any[]> {
    try {
      const params: Record<string, any> = {};
      if (fields && fields.length) params['fields'] = JSON.stringify(fields);
      if (filters) params['filters'] = JSON.stringify(filters);
      if (limit) params['limit_page_length'] = limit;

      const response = await this.axiosInstance.get(`/api/resource/${doctype}`, { params });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} list: ${error?.message || 'Unknown error'}`);
    }
  }

  async createDocument(doctype: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.post(`/api/resource/${doctype}`, { data: doc });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create ${doctype}: ${error?.message || 'Unknown error'}`);
    }
  }

  async updateDocument(doctype: string, name: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.put(`/api/resource/${doctype}/${name}`, { data: doc });
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  async runReport(reportName: string, filters?: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/method/frappe.desk.query_report.run`, {
        params: {
          report_name: reportName,
          filters: filters ? JSON.stringify(filters) : undefined
        }
      });
      return response.data.message;
    } catch (error: any) {
      throw new Error(`Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`);
    }
  }

  async getAllDocTypes(): Promise<string[]> {
    try {
      const response = await this.axiosInstance.get('/api/resource/DocType', {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 500
        }
      });
      if (response.data && response.data.data) {
        return response.data.data.map((item: any) => item.name);
      }
      return [];
    } catch (error: any) {
      console.error("Failed to get DocTypes:", error?.message || 'Unknown error');
      try {
        const altResponse = await this.axiosInstance.get('/api/method/frappe.desk.search.search_link', {
          params: { doctype: 'DocType', txt: '', limit: 500 }
        });
        if (altResponse.data && altResponse.data.results) {
          return altResponse.data.results.map((item: any) => item.value);
        }
        return [];
      } catch (altError: any) {
        console.error("Alternative DocType fetch failed:", altError?.message || 'Unknown error');
        // Hardcoded fallback: common ERPNext DocTypes returned when both the
        // /api/resource/DocType endpoint and the search_link method fail
        // (e.g., permission restrictions on some Frappe Cloud plans).
        return [
          "Customer", "Supplier", "Item", "Sales Order", "Purchase Order",
          "Sales Invoice", "Purchase Invoice", "Employee", "Lead", "Opportunity",
          "Quotation", "Payment Entry", "Journal Entry", "Stock Entry"
        ];
      }
    }
  }
}
