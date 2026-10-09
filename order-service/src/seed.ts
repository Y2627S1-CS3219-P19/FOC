import { fileURLToPath } from 'node:url';
import { createLogger, runMigrations } from '@foc/shared-middleware';
import { createPool, withTransaction } from './db.js';
import type { OrderStatus } from './domain/order.js';

/**
 * Demo data for the live demo: orders in every status, from real campus suppliers (data/csv/supplier-seed-data.csv).
 *
 *   npm run seed                                   (outside Docker, needs DATABASE_URL)
 *   docker compose exec order-service node order-service/dist/seed.js
 *
 * Pass real Keycloak user ids to see names in the app:
 *   SEED_ALICE_ID=<requester id> SEED_BEN_ID=<runner id> SEED_CHLOE_ID=<another requester id> npm run seed
 *
 * Safe to run twice (fixed ids, ON CONFLICT DO NOTHING). Writes no outbox events, so Credit Service is not affected.
 * Supplier ids are placeholders: an order only keeps a snapshot of the supplier's name and location.
 */

const ALICE = process.env.SEED_ALICE_ID ?? 'a11ce000-0000-4000-8000-000000000001'; // requester
const BEN = process.env.SEED_BEN_ID ?? 'be000000-0000-4000-8000-000000000002'; // runner
const CHLOE = process.env.SEED_CHLOE_ID ?? 'c410e000-0000-4000-8000-000000000003'; // requester

interface Supplier {
  id: string;
  name: string;
  type: string;
  building: string;
  floor: string;
  where: string;
}

const s = (n: number, name: string, type: string, building: string, floor: string, where: string): Supplier => ({
  id: `5a000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
  name,
  type,
  building,
  floor,
  where,
});

const COOL_SPOT = s(1, 'Cool Spot', 'Food', 'Com2', '1', 'Opp LT16');
const TOMORO = s(2, 'TOMORO COFFEE', 'Food/Coffee', 'Hon Sui Sen Memorial Library', '2', 'Inside HSSML');
const PRINTER = s(3, 'Printer @ Com 2', 'Printing', 'Com 2', '1', 'Next to LT19');
const COOP = s(4, 'NUS Co-op', 'Shopping', 'Central Library', '1', 'Inside the library on the right side');
const INSTACHEF = s(5, 'InstaChef', 'Food', 'Terrace', '1', 'Next to foyer');
const ROBOT_CAFE = s(6, 'Cafe+ Robot Cafe', 'Food/Coffee', 'Central Library', '1', 'Opp to central library entrance');
const PASTA = s(7, 'Pasta Express', 'Food', 'Frontier', '1', 'Aircon section');
const ARISE = s(8, 'Arise and Shine', 'Food', 'Engineering Block E4', '4', 'Near LT6');
const SMOOY = s(9, 'Smooy', 'Food', 'COM3', '1', 'The Terrace @ COM3');
const OCTOBOX = s(10, 'Octobox', 'Shopping', "Prince George's Park", '2', 'Near PGP entrance');
const BAKEHAUS = s(11, 'Bakehaus / Aurea', 'Food', 'The Ridge', '1', 'Near COM2');

interface SeedOrder {
  n: number;
  status: OrderStatus;
  requester: string;
  supplier: Supplier;
  deliverTo: string;
  items: string[];
  credits: number;
  /** created_at = now() - createdMinutesAgo; expires_at = created_at + expiresAfterMinutes (max 24h). */
  createdMinutesAgo: number;
  expiresAfterMinutes: number;
  rejection?: { reason: string; balance: number | null };
}

const ORDERS: SeedOrder[] = [
  {
    n: 1,
    status: 'OPEN',
    requester: ALICE,
    supplier: COOL_SPOT,
    deliverTo: 'COM1 lobby',
    items: ['1x chicken rice', '1x iced milo'],
    credits: 6,
    createdMinutesAgo: 10,
    expiresAfterMinutes: 100,
  },
  {
    n: 2,
    status: 'OPEN',
    requester: CHLOE,
    supplier: TOMORO,
    deliverTo: 'UTown Residence lobby',
    items: ['1x iced latte (less sugar)'],
    credits: 4,
    createdMinutesAgo: 5,
    expiresAfterMinutes: 35,
  },
  {
    n: 3,
    status: 'OPEN',
    requester: ALICE,
    supplier: PRINTER,
    deliverTo: 'BIZ1 level 2',
    items: ['Print 20 pages A4, black and white'],
    credits: 3,
    createdMinutesAgo: 20,
    expiresAfterMinutes: 380,
  },
  {
    n: 4,
    status: 'OPEN',
    requester: CHLOE,
    supplier: COOP,
    deliverTo: 'Engineering E4 foyer',
    items: ['1x NUS hoodie (size M)'],
    credits: 10,
    createdMinutesAgo: 15,
    expiresAfterMinutes: 1200,
  },
  {
    n: 5,
    status: 'ACCEPTED',
    requester: ALICE,
    supplier: INSTACHEF,
    deliverTo: 'COM1 lobby',
    items: ['1x mala xiang guo'],
    credits: 7,
    createdMinutesAgo: 25,
    expiresAfterMinutes: 120,
  },
  {
    n: 6,
    status: 'COLLECTED',
    requester: CHLOE,
    supplier: ROBOT_CAFE,
    deliverTo: 'Central Library level 4',
    items: ['2x croissant', '1x mocha'],
    credits: 5,
    createdMinutesAgo: 40,
    expiresAfterMinutes: 120,
  },
  {
    n: 7,
    status: 'DELIVERED',
    requester: ALICE,
    supplier: PASTA,
    deliverTo: 'Frontier canteen entrance',
    items: ['1x carbonara'],
    credits: 6,
    createdMinutesAgo: 180,
    expiresAfterMinutes: 240,
  },
  {
    n: 8,
    status: 'COMPLETED',
    requester: ALICE,
    supplier: ARISE,
    deliverTo: 'E4 level 4',
    items: ['1x egg mayo sandwich'],
    credits: 4,
    createdMinutesAgo: 1500,
    expiresAfterMinutes: 120,
  },
  {
    n: 9,
    status: 'CANCELLED',
    requester: ALICE,
    supplier: SMOOY,
    deliverTo: 'COM3 lobby',
    items: ['1x frozen yoghurt'],
    credits: 3,
    createdMinutesAgo: 300,
    expiresAfterMinutes: 60,
  },
  {
    n: 10,
    status: 'EXPIRED',
    requester: CHLOE,
    supplier: OCTOBOX,
    deliverTo: 'PGP block 10',
    items: ['1x phone charger'],
    credits: 5,
    createdMinutesAgo: 240,
    expiresAfterMinutes: 120,
  },
  {
    n: 11,
    status: 'REJECTED',
    requester: CHLOE,
    supplier: BAKEHAUS,
    deliverTo: 'COM2 level 1',
    items: ['6x mini tarts'],
    credits: 30,
    createdMinutesAgo: 60,
    expiresAfterMinutes: 120,
    rejection: { reason: 'INSUFFICIENT_CREDITS', balance: 12 },
  },
];

const HAS_RUNNER: OrderStatus[] = ['ACCEPTED', 'COLLECTED', 'DELIVERED', 'COMPLETED'];

/** The status steps that lead to `status`, with who made each step (null = system). */
function path(o: SeedOrder): Array<[OrderStatus | null, OrderStatus, string | null]> {
  if (o.status === 'REJECTED')
    return [
      [null, 'PENDING', o.requester],
      ['PENDING', 'REJECTED', null],
    ];
  const steps: Array<[OrderStatus | null, OrderStatus, string | null]> = [
    [null, 'PENDING', o.requester],
    ['PENDING', 'OPEN', null],
  ];
  if (o.status === 'CANCELLED') steps.push(['OPEN', 'CANCELLED', o.requester]);
  if (o.status === 'EXPIRED') steps.push(['OPEN', 'EXPIRED', null]);
  const forward: Array<[OrderStatus, OrderStatus, string]> = [
    ['OPEN', 'ACCEPTED', BEN],
    ['ACCEPTED', 'COLLECTED', BEN],
    ['COLLECTED', 'DELIVERED', BEN],
    ['DELIVERED', 'COMPLETED', o.requester],
  ];
  for (const step of forward) {
    if (!HAS_RUNNER.includes(o.status)) break;
    steps.push(step);
    if (step[1] === o.status) break;
  }
  return steps;
}

export async function seedOrders(databaseUrl: string): Promise<number> {
  const logger = createLogger('order-service-seed');
  const pool = createPool(databaseUrl);
  try {
    await runMigrations(pool, fileURLToPath(new URL('../migrations', import.meta.url)), logger);
    let inserted = 0;
    await withTransaction(pool, async (client) => {
      for (const o of ORDERS) {
        const id = `5eed0000-0000-4000-8000-0000000000${String(o.n).padStart(2, '0')}`;
        const steps = path(o);
        const delivered = o.status === 'DELIVERED' || o.status === 'COMPLETED';
        const res = await client.query(
          `INSERT INTO orders (id, requester_id, runner_id, supplier_id, supplier_name, supplier_facility_type, supplier_building,
                               supplier_floor, supplier_location_description, delivery_location, items, credit_amount, status,
                               expires_at, delivered_at, rejection_reason, rejection_balance, created_at, updated_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                   now() - make_interval(mins => $14) + make_interval(mins => $15),
                   CASE WHEN $16 THEN now() - make_interval(mins => $14) + make_interval(mins => 20) END,
                   $17, $18, now() - make_interval(mins => $14), now(), $19)
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            o.requester,
            HAS_RUNNER.includes(o.status) ? BEN : null,
            o.supplier.id,
            o.supplier.name,
            o.supplier.type,
            o.supplier.building,
            o.supplier.floor,
            o.supplier.where,
            o.deliverTo,
            JSON.stringify(o.items),
            o.credits,
            o.status,
            o.createdMinutesAgo,
            o.expiresAfterMinutes,
            delivered,
            o.rejection?.reason ?? null,
            o.rejection?.balance ?? null,
            steps.length,
          ],
        );
        if (res.rowCount === 0) continue;
        inserted++;
        for (const [i, [from, to, actor]] of steps.entries()) {
          await client.query(
            `INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, occurred_at, reason)
             VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5) + make_interval(mins => $6), 'SEED')`,
            [id, from, to, actor, o.createdMinutesAgo, i * 5],
          );
        }
      }
    });
    logger.info({ inserted, total: ORDERS.length }, 'Seeded demo orders');
    return inserted;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL, e.g. postgres://orders:<password>@localhost:5436/orders_db');
  seedOrders(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
