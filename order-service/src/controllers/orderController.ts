import type { Request, Response } from 'express';
import { hasRole, parseOrThrow } from '@foc/shared-middleware';
import type { AppContext } from '../context.js';
import { historyToApi, toApi } from '../domain/order.js';
import type { Page } from '../repositories/orderRepository.js';
import type { OrderRow } from '../domain/order.js';
import {
  byUserQuerySchema,
  createOrderSchema,
  idParamSchema,
  listOpenQuerySchema,
  mineQuerySchema,
  userIdParamSchema,
} from '../schemas.js';
import * as orders from '../services/orderService.js';
import { changeStatus, type UserAction } from '../services/statusService.js';

/** Runs after requireAuth, so req.auth is always set. */
export function callerOf(req: Request): orders.Caller {
  return { userId: req.auth!.userId, isAdmin: hasRole(req, 'admin'), correlationId: req.correlationId };
}

const sendPage = (res: Response, p: Page<OrderRow>, q: { page: number; limit: number }) =>
  res.json({ data: p.rows.map(toApi), page: q.page, limit: q.limit, total: p.total });

export function orderController(ctx: AppContext) {
  return {
    async create(req: Request, res: Response) {
      const input = parseOrThrow(createOrderSchema, req.body);
      const order = await orders.createOrder(ctx, callerOf(req), input);
      // 202: the order is PENDING until Credit Service replies.
      res.status(202).location(`/v1/orders/${order.id}`).json({ data: toApi(order) });
    },

    async listOpen(req: Request, res: Response) {
      const q = parseOrThrow(listOpenQuerySchema, req.query);
      sendPage(res, await orders.listOpen(ctx, callerOf(req), q), q);
    },

    async listMine(req: Request, res: Response) {
      const q = parseOrThrow(mineQuerySchema, req.query);
      sendPage(res, await orders.listMine(ctx, callerOf(req), q), q);
    },

    async listByUser(req: Request, res: Response) {
      const { userId } = parseOrThrow(userIdParamSchema, req.params);
      const q = parseOrThrow(byUserQuerySchema, req.query);
      sendPage(res, await orders.listByUser(ctx, userId, q), q);
    },

    async get(req: Request, res: Response) {
      const { id } = parseOrThrow(idParamSchema, req.params);
      const { order, requester, runner } = await orders.getOrder(ctx, callerOf(req), id);
      res.json({ data: { ...toApi(order), requester, runner } });
    },

    /** One handler per action, e.g. changeStatus('accept') for POST /:id/accept. */
    changeStatus(action: UserAction) {
      return async (req: Request, res: Response) => {
        const { id } = parseOrThrow(idParamSchema, req.params);
        const order = await changeStatus(ctx, callerOf(req), action, id);
        res.json({ data: toApi(order) });
      };
    },

    async timeline(req: Request, res: Response) {
      const { id } = parseOrThrow(idParamSchema, req.params);
      const history = await orders.getTimeline(ctx, callerOf(req), id);
      res.json({ data: history.map(historyToApi) });
    },
  };
}
