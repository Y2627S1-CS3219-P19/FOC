import type { FastifyPluginAsync } from 'fastify';
import type { SupplierRepository } from '../db/repository.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listQuerySchema,
  idParamSchema,
  bulkDeleteQuerySchema,
} from '../schemas/supplier.js';
import { forbidden, notFound, conflict } from '../middleware/errors.js';

export interface SupplierRoutesOptions {
  repository: SupplierRepository;
}

export const supplierRoutes: FastifyPluginAsync<SupplierRoutesOptions> = async (fastify, opts) => {
  const repo = opts.repository;

  // Protect all supplier endpoints with requireAuth
  fastify.addHook('preHandler', fastify.requireAuth);

  // GET /v1/suppliers/filter-options
  fastify.get('/filter-options', async (req, reply) => {
    const isAdmin = req.auth?.roles.includes('admin') ?? false;
    const options = await repo.getFilterOptions(isAdmin);
    return reply.status(200).send({ data: options });
  });

  // GET /v1/suppliers
  fastify.get('/', async (req, reply) => {
    const query = listQuerySchema.parse(req.query);
    const isAdmin = req.auth?.roles.includes('admin') ?? false;

    if (!isAdmin && (query.status === 'inactive' || query.status === 'all')) {
      throw forbidden('ADMIN_ONLY_FILTER', 'Only administrators can view deactivated suppliers.');
    }

    const { data, total } = await repo.list(query, isAdmin);
    return reply.status(200).send({
      data,
      page: query.page,
      limit: query.limit,
      total,
    });
  });

  // GET /v1/suppliers/:id
  fastify.get('/:id', async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const isAdmin = req.auth?.roles.includes('admin') ?? false;

    const supplier = await repo.findById(id);
    if (!supplier || (!supplier.isActive && !isAdmin)) {
      throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
    }

    return reply.status(200).send({ data: supplier });
  });

  // POST /v1/suppliers (Admin)
  fastify.post('/', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const body = createSupplierSchema.parse(req.body);

    try {
      const created = await repo.create({
        name: body.name,
        facilityType: body.facilityType,
        building: body.building,
        floor: body.floor ?? null,
        locationDescription: body.locationDescription ?? null,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        opensAt: body.opensAt,
        closesAt: body.closesAt,
        imageUrl: body.imageUrl ?? null,
      });

      return reply.status(201).send({ data: created });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw conflict('SUPPLIER_NAME_TAKEN', 'A supplier with this name already exists');
      }
      throw err;
    }
  });

  // PATCH /v1/suppliers/:id (Admin)
  fastify.patch('/:id', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateSupplierSchema.parse(req.body);

    try {
      const updated = await repo.update(id, body);
      if (!updated) {
        throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
      }
      return reply.status(200).send({ data: updated });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw conflict('SUPPLIER_NAME_TAKEN', 'A supplier with this name already exists');
      }
      throw err;
    }
  });

  // PATCH /v1/suppliers/:id/deactivate (Admin)
  fastify.patch('/:id/deactivate', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const deactivated = await repo.setActive(id, false);
    if (!deactivated) {
      throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
    }
    return reply.status(200).send({ data: deactivated });
  });

  // PATCH /v1/suppliers/:id/reactivate (Admin)
  fastify.patch('/:id/reactivate', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const reactivated = await repo.setActive(id, true);
    if (!reactivated) {
      throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
    }
    return reply.status(200).send({ data: reactivated });
  });

  // DELETE /v1/suppliers/:id (Admin)
  fastify.delete('/:id', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { id } = idParamSchema.parse(req.params);
    const deleted = await repo.deleteById(id);
    if (!deleted) {
      throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
    }
    return reply.status(204).send();
  });

  // DELETE /v1/suppliers?facilityType=...&confirm=true (Admin bulk delete)
  fastify.delete('/', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const query = bulkDeleteQuerySchema.parse(req.query);
    const deletedCount = await repo.deleteByFacilityType(query.facilityType);
    return reply.status(200).send({
      data: {
        deleted: deletedCount,
        facilityType: query.facilityType,
      },
    });
  });
};
