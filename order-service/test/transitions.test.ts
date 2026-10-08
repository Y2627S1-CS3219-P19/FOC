// AI-assisted: Claude Code (Opus 5.5), 2026-10-08. Scope: unit tests for the transition table. Reviewed by <name>.
import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderRow, type OrderStatus } from '../src/domain/order.js';
import { TRANSITIONS, isAllowedFrom, updateSql, type Action } from '../src/domain/transitions.js';

const LEGAL: Array<[Action, OrderStatus, OrderStatus]> = [
  ['accept', 'OPEN', 'ACCEPTED'],
  ['withdraw', 'ACCEPTED', 'OPEN'],
  ['collect', 'ACCEPTED', 'COLLECTED'],
  ['deliver', 'COLLECTED', 'DELIVERED'],
  ['confirm', 'DELIVERED', 'COMPLETED'],
  ['cancel', 'OPEN', 'CANCELLED'],
  ['expire', 'OPEN', 'EXPIRED'],
];

describe('transition table', () => {
  it('has exactly the legal transitions', () => {
    for (const [action, from, to] of LEGAL) {
      expect(TRANSITIONS[action]).toMatchObject({ from, to });
    }
    expect(Object.keys(TRANSITIONS).sort()).toEqual(LEGAL.map(([a]) => a).sort());
  });

  it('rejects every action from every other status', () => {
    for (const [action, from] of LEGAL) {
      for (const status of ORDER_STATUSES) {
        expect(isAllowedFrom(action, status)).toBe(status === from);
      }
    }
  });

  it('final states have no way out', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED'] as const) {
      expect(LEGAL.some(([, from]) => from === status)).toBe(false);
    }
  });
});

describe('who may trigger each transition', () => {
  it('matches the rules', () => {
    expect(TRANSITIONS.accept.actors).toEqual(['nonRequester']);
    expect(TRANSITIONS.withdraw.actors).toEqual(['runner']);
    expect(TRANSITIONS.collect.actors).toEqual(['runner']);
    expect(TRANSITIONS.deliver.actors).toEqual(['runner']);
    expect(TRANSITIONS.confirm.actors).toEqual(['requester', 'system']);
    expect(TRANSITIONS.cancel.actors).toEqual(['requester']);
    expect(TRANSITIONS.expire.actors).toEqual(['system']);
  });

  it('refuses to build SQL for an actor that is not allowed', () => {
    expect(() => updateSql('accept', 'requester')).toThrow();
    expect(() => updateSql('cancel', 'runner')).toThrow();
    expect(() => updateSql('expire', 'requester')).toThrow();
  });
});

describe('conditional UPDATE', () => {
  it('accept checks status, expiry and that the caller is not the requester', () => {
    const sql = updateSql('accept', 'nonRequester');
    expect(sql).toContain("status = 'OPEN'");
    expect(sql).toContain('requester_id <> $2');
    expect(sql).toContain('expires_at > now()');
    expect(sql).toContain('runner_id = $2');
    expect(sql).toContain('version = version + 1');
  });

  it('withdraw clears the runner and leaves expires_at alone', () => {
    const sql = updateSql('withdraw', 'runner');
    expect(sql).toContain('runner_id = NULL');
    expect(sql).not.toMatch(/expires_at\s*=/);
  });

  it('manual and auto confirm use the same UPDATE, apart from the caller check', () => {
    expect(updateSql('confirm', 'requester')).toBe(
      updateSql('confirm', 'system').replace("status = 'DELIVERED'", "status = 'DELIVERED' AND requester_id = $2"),
    );
  });

  it('system transitions use only $1', () => {
    expect(updateSql('expire', 'system')).not.toContain('$2');
    expect(updateSql('confirm', 'system')).not.toContain('$2');
  });
});

describe('event payloads', () => {
  const order: OrderRow = {
    id: 'o1',
    requester_id: 'req',
    runner_id: 'run',
    supplier_id: 's1',
    supplier_name: 'Cool Spot',
    supplier_facility_type: 'Food',
    supplier_building: 'Com2',
    supplier_floor: '1',
    supplier_location_description: 'Opp LT16',
    delivery_location: 'COM1 lobby',
    items: ['1x chicken rice'],
    credit_amount: 5,
    status: 'COMPLETED',
    expires_at: new Date(),
    delivered_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    version: 6,
  };

  it('completed carries what Credit needs to pay the runner, plus orderVersion', () => {
    expect(TRANSITIONS.confirm.payload(order, null)).toEqual({
      orderId: 'o1',
      requesterId: 'req',
      runnerId: 'run',
      creditAmount: 5,
      orderVersion: 6,
    });
    expect(TRANSITIONS.confirm.event.routingKey).toBe('order.completed');
  });

  it('runner withdraw never publishes order.withdrawn', () => {
    expect(TRANSITIONS.withdraw.event.routingKey).toBe('order.reopened');
  });
});
