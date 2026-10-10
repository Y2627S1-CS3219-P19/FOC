export const ORDER_STATUSES = [
  'PENDING',
  'REJECTED',
  'OPEN',
  'ACCEPTED',
  'COLLECTED',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
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
  rejection_reason: string | null;
  rejection_balance: number | null;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface HistoryRow {
  id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: string | null;
  occurred_at: Date;
  reason: string | null;
}

export function toApi(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    requesterId: o.requester_id,
    runnerId: o.runner_id,
    supplier: {
      id: o.supplier_id,
      name: o.supplier_name,
      facilityType: o.supplier_facility_type,
      building: o.supplier_building,
      floor: o.supplier_floor,
      locationDescription: o.supplier_location_description,
    },
    deliveryLocation: o.delivery_location,
    items: o.items,
    creditAmount: o.credit_amount,
    expiresAt: o.expires_at,
    deliveredAt: o.delivered_at,
    rejection: o.rejection_reason ? { reason: o.rejection_reason, availableBalance: o.rejection_balance } : null,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    version: o.version,
  };
}

export function historyToApi(h: HistoryRow) {
  return {
    fromStatus: h.from_status,
    toStatus: h.to_status,
    actorId: h.actor_id,
    occurredAt: h.occurred_at,
    reason: h.reason,
  };
}
