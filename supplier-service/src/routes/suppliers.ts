import { Router } from 'express';
import { forbidden, hasRole, notFound, parseOrThrow, requireActiveSession, requireRole } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { bulkDeleteQuerySchema, createSupplierSchema, idParamSchema, listQuerySchema, updateSupplierSchema } from '../schemas.js';
import { findSupplier, mapSupplierDbError, openNowSql, toApi, type SupplierRow } from '../suppliers.js';

const SORTS = {
  name: 'lower(s.name) {dir}, s.id',
  location: 'lower(s.building) {dir}, s.floor {dir} NULLS LAST, lower(s.name), s.id',
  facilityType: 'lower(s.facility_type) {dir}, lower(s.name), s.id',
} as const;

/**
 * Access control, using identity + role from the User Service's Keycloak tokens:
 * - every route needs a valid token (401) and a live, non-suspended session checked with the User Service (401/403)
 * - reading: any logged-in user, but regular users only ever see ACTIVE suppliers
 * - creating, editing, (de)activating, deleting: role `admin` only (403 INSUFFICIENT_ROLE otherwise)
 */
export function suppliersRouter(ctx: AppContext): Router {
  const router = Router();
  const tz = ctx.config.timezone;
  router.use(ctx.auth.requireAuth, requireActiveSession(ctx.sessions));

  // Values for the filter dropdowns in the UI.
  router.get('/filter-options', async (req, res) => {
    const activeOnly = hasRole(req, 'admin') ? '' : 'WHERE is_active';
    const [types, buildings] = await Promise.all([
      ctx.pool.query<{ v: string }>(`SELECT DISTINCT facility_type AS v FROM suppliers ${activeOnly} ORDER BY 1`),
      ctx.pool.query<{ v: string }>(`SELECT DISTINCT building AS v FROM suppliers ${activeOnly} ORDER BY 1`),
    ]);
    res.json({ data: { facilityTypes: types.rows.map((r) => r.v), buildings: buildings.rows.map((r) => r.v) } });
  });

  // F7: list with search, filter, sort and pagination.
  router.get('/', async (req, res) => {
    const q = parseOrThrow(listQuerySchema, req.query);
    const isAdmin = hasRole(req, 'admin');
    if (!isAdmin && (q.status === 'inactive' || q.status === 'all')) {
      throw forbidden('ADMIN_ONLY_FILTER', 'Only administrators can view deactivated suppliers.');
    }
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: (p: string) => string, value: unknown) => {
      params.push(value);
      where.push(sql(`$${params.length}`));
    };
    if (q.status === 'active' || q.status === 'open_now') where.push('s.is_active');
    if (q.status === 'inactive') where.push('NOT s.is_active');
    if (q.status === 'open_now') where.push(openNowSql(tz));
    if (q.search) add((p) => `(s.name ILIKE ${p} OR s.building ILIKE ${p} OR s.location_description ILIKE ${p})`, `%${q.search}%`);
    if (q.facilityType) {
      const types = q.facilityType.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      add((p) => `lower(s.facility_type) = ANY(${p}::text[])`, types);
    }
    if (q.building) add((p) => `lower(s.building) = lower(${p})`, q.building);
    if (q.tag) add((p) => `${p} = ANY(s.tags)`, q.tag);

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = SORTS[q.sort].replaceAll('{dir}', q.order.toUpperCase());
    const total = await ctx.pool.query<{ n: string }>(`SELECT count(*) AS n FROM suppliers s ${clause}`, params);
    const { rows } = await ctx.pool.query<SupplierRow>(
      `SELECT s.*, ${openNowSql(tz)} AS is_open_now FROM suppliers s ${clause}
       ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, q.limit, (q.page - 1) * q.limit],
    );
    res.json({ data: rows.map(toApi), page: q.page, limit: q.limit, total: Number(total.rows[0]!.n) });
  });

  // F7.1: details. Deactivated suppliers are invisible (404) to regular users.
  router.get('/:id', async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const supplier = await findSupplier(ctx.pool, id, tz);
    if (!supplier || (!supplier.is_active && !hasRole(req, 'admin'))) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    res.json({ data: toApi(supplier) });
  });

  // ----- admin only below -----
  const admin = requireRole('admin');

  // F8: create.
  router.post('/', admin, async (req, res) => {
    const b = parseOrThrow(createSupplierSchema, req.body);
    try {
      const { rows } = await ctx.pool.query<{ id: string }>(
        `INSERT INTO suppliers (name, facility_type, building, floor, location_description, latitude, longitude,
                                opens_at, closes_at, tags, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
        [
          b.name,
          b.facilityType,
          b.building,
          b.floor ?? null,
          b.locationDescription ?? '',
          b.latitude ?? null,
          b.longitude ?? null,
          b.opensAt,
          b.closesAt,
          b.tags ?? [],
          req.auth!.userId,
        ],
      );
      res.status(201).json({ data: toApi((await findSupplier(ctx.pool, rows[0]!.id, tz))!) });
    } catch (err) {
      throw mapSupplierDbError(err);
    }
  });

  // F9.3: update details.
  router.patch('/:id', admin, async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const b = parseOrThrow(updateSupplierSchema, req.body);
    const columns: Record<string, unknown> = {
      name: b.name,
      facility_type: b.facilityType,
      building: b.building,
      floor: b.floor,
      location_description: b.locationDescription,
      latitude: b.latitude,
      longitude: b.longitude,
      opens_at: b.opensAt,
      closes_at: b.closesAt,
      tags: b.tags,
    };
    const values: unknown[] = [id, req.auth!.userId];
    const sets = Object.entries(columns)
      .filter(([, v]) => v !== undefined)
      .map(([col, v]) => {
        values.push(v);
        return `${col} = $${values.length}`;
      });
    try {
      const result = await ctx.pool.query(
        `UPDATE suppliers SET ${sets.join(', ')}, updated_by = $2, updated_at = now() WHERE id = $1`,
        values,
      );
      if (!result.rowCount) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    } catch (err) {
      throw mapSupplierDbError(err);
    }
    res.json({ data: toApi((await findSupplier(ctx.pool, id, tz))!) });
  });

  // F9.1 / F9.2: deactivate (kept, cannot be chosen for new orders) and reactivate.
  for (const [path, active] of [
    ['deactivate', false],
    ['reactivate', true],
  ] as const) {
    router.patch(`/:id/${path}`, admin, async (req, res) => {
      const { id } = parseOrThrow(idParamSchema, req.params);
      const result = await ctx.pool.query(
        'UPDATE suppliers SET is_active = $2, updated_by = $3, updated_at = now() WHERE id = $1',
        [id, active, req.auth!.userId],
      );
      if (!result.rowCount) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');
      res.json({ data: toApi((await findSupplier(ctx.pool, id, tz))!) });
    });
  }

  // F10.1.1: delete one. Historical orders keep their own snapshot of the supplier, so this is safe.
  router.delete('/:id', admin, async (req, res) => {
    const { id } = parseOrThrow(idParamSchema, req.params);
    const result = await ctx.pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
    if (!result.rowCount) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    res.status(204).end();
  });

  // F10.1.2: bulk delete by facility type. Needs ?facilityType=...&confirm=true so it cannot happen by accident.
  router.delete('/', admin, async (req, res) => {
    const q = parseOrThrow(bulkDeleteQuerySchema, req.query);
    const result = await ctx.pool.query('DELETE FROM suppliers WHERE lower(facility_type) = lower($1)', [q.facilityType]);
    res.json({ data: { deleted: result.rowCount ?? 0, facilityType: q.facilityType } });
  });

  return router;
}
