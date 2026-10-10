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
  data: {
    valid: boolean;
    reason: 'NOT_FOUND' | 'INACTIVE' | 'CLOSED' | null;
    // Supplier Service allows an empty location description; the order snapshot column does not.
    supplier: (Omit<SupplierSnapshot, 'locationDescription'> & { locationDescription: string | null }) | null;
  };
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
      if (data.valid && data.supplier) {
        const { id, name, facilityType, building, floor, locationDescription } = data.supplier;
        return {
          valid: true,
          supplier: { id, name, facilityType, building, floor, locationDescription: locationDescription ?? '' },
        };
      }
      return { valid: false, reason: data.reason ?? 'NOT_FOUND' };
    },
  };
}
