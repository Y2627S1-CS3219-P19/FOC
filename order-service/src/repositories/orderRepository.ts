import type { Queryable } from '../db.js';
import type { HistoryRow, OrderRow, OrderStatus } from '../domain/order.js';
import type { ByUserQuery, ListOpenQuery, MineQuery } from '../schemas.js';

export interface NewOrder {
  id: string;
  requesterId: string;
  supplier: {
    id: string;
    name: string;
    facilityType: string;
    building: string;
    floor: string | null;
    locationDescription: string;
  };
  deliveryLocation: string;
  items: string[];
  creditAmount: number;
  expiresAt: string;
}

export interface Page<T> {
  rows: T[];
  total: number;
}

export async function insertOrder(db: Queryable, o: NewOrder): Promise<OrderRow> {
  const { rows } = await db.query<OrderRow>(
    `INSERT INTO orders (id, requester_id, supplier_id, supplier_name, supplier_facility_type, supplier_building,
                         supplier_floor, supplier_location_description, delivery_location, items, credit_amount, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      o.id,
      o.requesterId,
      o.supplier.id,
      o.supplier.name,
      o.supplier.facilityType,
      o.supplier.building,
      o.supplier.floor,
      o.supplier.locationDescription,
      o.deliveryLocation,
      JSON.stringify(o.items),
      o.creditAmount,
      o.expiresAt,
    ],
  );
  return rows[0]!;
}

export async function insertHistory(
  db: Queryable,
  h: { orderId: string; from: OrderStatus | null; to: OrderStatus; actorId: string | null; reason?: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, $3, $4, $5)`,
    [h.orderId, h.from, h.to, h.actorId, h.reason ?? null],
  );
}

export async function findOrder(db: Queryable, id: string): Promise<OrderRow | null> {
  const { rows } = await db.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function findHistory(db: Queryable, orderId: string): Promise<HistoryRow[]> {
  const { rows } = await db.query<HistoryRow>('SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY occurred_at, id', [
    orderId,
  ]);
  return rows;
}

/** Checks a requested expiry against DATABASE time, never app server time. */
export async function checkExpiry(db: Queryable, expiresAt: string): Promise<{ inFuture: boolean; within24h: boolean }> {
  const { rows } = await db.query<{ in_future: boolean; within_24h: boolean }>(
    `SELECT $1::timestamptz > now() AS in_future, $1::timestamptz <= now() + interval '24 hours' AS within_24h`,
    [expiresAt],
  );
  return { inFuture: rows[0]!.in_future, within24h: rows[0]!.within_24h };
}

/** Builds "WHERE a AND b" with numbered params, the same way supplier-service does. */
function whereBuilder() {
  const params: unknown[] = [];
  const where: string[] = [];
  return {
    params,
    add(sql: (p: string) => string, value: unknown) {
      params.push(value);
      where.push(sql(`$${params.length}`));
    },
    raw(sql: string) {
      where.push(sql);
    },
    clause: () => (where.length ? `WHERE ${where.join(' AND ')}` : ''),
  };
}

async function page(
  db: Queryable,
  clause: string,
  params: unknown[],
  orderBy: string,
  p: { page: number; limit: number },
): Promise<Page<OrderRow>> {
  const total = await db.query<{ n: string }>(`SELECT count(*) AS n FROM orders ${clause}`, params);
  const { rows } = await db.query<OrderRow>(
    `SELECT * FROM orders ${clause} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, p.limit, (p.page - 1) * p.limit],
  );
  return { rows, total: Number(total.rows[0]!.n) };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const OPEN_SORTS = { expiry: 'expires_at', credit: 'credit_amount' } as const;

/** OPEN, not yet past expiry, and not the viewer's own orders. */
export async function listOpen(db: Queryable, viewerId: string, q: ListOpenQuery): Promise<Page<OrderRow>> {
  const w = whereBuilder();
  w.raw(`status = 'OPEN'`);
  w.raw('expires_at > now()');
  w.add((p) => `requester_id <> ${p}`, viewerId);
  if (q.supplierId) w.add((p) => `supplier_id = ${p}`, q.supplierId);
  if (q.building) w.add((p) => `lower(supplier_building) = lower(${p})`, q.building);
  if (q.facilityType) w.add((p) => `lower(supplier_facility_type) = lower(${p})`, q.facilityType);
  if (q.deliveryLocation) w.add((p) => `delivery_location ILIKE ${p}`, `%${escapeLike(q.deliveryLocation)}%`);
  if (q.minCredit !== undefined) w.add((p) => `credit_amount >= ${p}`, q.minCredit);
  if (q.maxCredit !== undefined) w.add((p) => `credit_amount <= ${p}`, q.maxCredit);
  if (q.minRemainingMinutes !== undefined)
    w.add((p) => `expires_at >= now() + make_interval(mins => ${p})`, q.minRemainingMinutes);
  if (q.maxRemainingMinutes !== undefined)
    w.add((p) => `expires_at <= now() + make_interval(mins => ${p})`, q.maxRemainingMinutes);
  const orderBy = `${OPEN_SORTS[q.sort]} ${q.order.toUpperCase()}, id`;
  return page(db, w.clause(), w.params, orderBy, q);
}

/** The caller's orders as requester, or as the currently assigned runner. */
export async function listMine(db: Queryable, userId: string, q: MineQuery): Promise<Page<OrderRow>> {
  const w = whereBuilder();
  w.add((p) => (q.as === 'requester' ? `requester_id = ${p}` : `runner_id = ${p}`), userId);
  if (q.status) w.add((p) => `status = ${p}`, q.status);
  return page(db, w.clause(), w.params, 'created_at DESC, id', q);
}

/** Admin view: every order where the user is requester or runner. */
export async function listByUser(db: Queryable, userId: string, q: ByUserQuery): Promise<Page<OrderRow>> {
  const w = whereBuilder();
  w.add((p) => `(requester_id = ${p} OR runner_id = ${p})`, userId);
  if (q.status) w.add((p) => `status = ${p}`, q.status);
  return page(db, w.clause(), w.params, 'created_at DESC, id', q);
}
