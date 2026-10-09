import { callInternal, type InternalHttpOptions } from './http.js';

export interface SupplierSnapshot {
  id: string;
  name: string;
  facilityType: string;
  building: string;
  floor: string | null;
  locationDescription: string;
}

export type SupplierCheck =
  { valid: true; supplier: SupplierSnapshot } | { valid: false; reason: 'NOT_FOUND' | 'INACTIVE' | 'CLOSED' };

export interface SupplierClient {
  validate(supplierId: string, correlationId?: string): Promise<SupplierCheck>;
}

interface ValidateBody {
  data: { valid: boolean; reason: 'NOT_FOUND' | 'INACTIVE' | 'CLOSED' | null; supplier: SupplierSnapshot | null };
}

/** GET /v1/internal/suppliers/:id/validate on the Supplier Service. */
export function createSupplierClient(options: Omit<InternalHttpOptions, 'service'>): SupplierClient {
  const http = { ...options, service: 'SUPPLIER' as const };
  return {
    async validate(supplierId, correlationId) {
      const res = await callInternal(
        http,
        'GET',
        `/v1/internal/suppliers/${encodeURIComponent(supplierId)}/validate`,
        correlationId,
      );
      if (res.status !== 200) throw new Error(`Supplier validate returned ${res.status}`);
      const { data } = res.body as ValidateBody;
      if (data.valid && data.supplier) return { valid: true, supplier: data.supplier };
      return { valid: false, reason: data.reason ?? 'NOT_FOUND' };
    },
  };
}
