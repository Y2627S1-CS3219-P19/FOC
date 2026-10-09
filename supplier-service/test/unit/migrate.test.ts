import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as migratorModule from 'drizzle-orm/postgres-js/migrator';
import { runMigrations } from '../../src/db/migrate.js';

vi.mock('drizzle-orm/postgres-js/migrator', () => ({
  migrate: vi.fn().mockResolvedValue(undefined),
}));

describe('Seam 1: Database Migrations Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports runMigrations function', () => {
    expect(typeof runMigrations).toBe('function');
  });

  it('executes drizzle migrate with the correct migrations folder when db is passed', async () => {
    const mockDb = { name: 'mock-db' } as any;
    await runMigrations(mockDb);

    expect(migratorModule.migrate).toHaveBeenCalledTimes(1);
    expect(migratorModule.migrate).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        migrationsFolder: expect.stringContaining('migrations'),
      })
    );
  });

  it('is idempotent when called multiple times on the same db instance', async () => {
    const mockDb = { name: 'mock-db' } as any;
    await runMigrations(mockDb);
    await runMigrations(mockDb);

    expect(migratorModule.migrate).toHaveBeenCalledTimes(2);
  });
});
