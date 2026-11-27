// src/lib/courier/steadfast.ts
// Server-only service layer for interacting with the Steadfast Courier API.
// Documented at: https://portal.packzy.com/api/v1

const BASE_URL = "https://portal.packzy.com/api/v1";

export interface SteadfastOrder {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  note?: string;
  item_description?: string;
  delivery_type?: number; // 0 = home, 1 = hub
}

export interface SteadfastResponse {
  status: number;
  message: string;
  consignment?: {
    consignment_id: number;
    invoice: string;
    tracking_code: string;
    status: string;
    created_at: string;
  };
}

export const steadfast = {
  isConfigured(): boolean {
    return Boolean(
      process.env.STEADFAST_API_KEY?.trim() && process.env.STEADFAST_SECRET_KEY?.trim()
    );
  },

  getHeaders() {
    return {
      "Api-Key": (process.env.STEADFAST_API_KEY || "").trim(),
      "Secret-Key": (process.env.STEADFAST_SECRET_KEY || "").trim(),
      "Content-Type": "application/json",
    };
  },

  async createOrder(data: SteadfastOrder): Promise<SteadfastResponse> {
    if (!this.isConfigured()) {
      throw new Error("Steadfast API credentials are not configured.");
    }
    const response = await fetch(`${BASE_URL}/create_order`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(12000),
    });

    return await response.json();
  },

  async getStatusById(id: string | number): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error("Steadfast API credentials are not configured.");
    }
    const safeId = String(id).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(safeId)) {
      throw new Error("Invalid consignment identifier.");
    }

    const response = await fetch(
      `${BASE_URL}/status_by_cid/${encodeURIComponent(safeId)}`,
      {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      }
    );
    return await response.json();
  },

  async checkFraud(phone: string): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error("Steadfast API credentials are not configured.");
    }
    const cleanPhone = phone.replace(/\D/g, "").slice(-11);
    if (!/^01\d{9}$/.test(cleanPhone)) {
      throw new Error("Invalid Bangladesh mobile number.");
    }

    const url = `${BASE_URL}/fraud_check/${encodeURIComponent(cleanPhone)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { status: 500, message: "Invalid response from courier service" };
    }
  },
};
