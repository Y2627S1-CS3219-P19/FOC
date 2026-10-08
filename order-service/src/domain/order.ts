// AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: order row type and statuses. Reviewed by <name>.

export const ORDER_STATUSES = ['OPEN', 'ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** One row of the orders table, as pg returns it. */
export interface OrderRow {
  id: string;
  requester_id: string;
  runner_id: string | null;
  supplier_id: string;
  supplier_name: string;
  supplier_facility_type: string;
  supplier_building: string;
  supplier_floor: string | null;
  supplier_location_description: string;
  delivery_location: string;
  items: string[];
  credit_amount: number;
  status: OrderStatus;
  expires_at: Date;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}
