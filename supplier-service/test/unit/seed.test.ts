import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { runSeed } from '../../src/db/seed.js';

describe('Seam 2: Database Seed Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports runSeed function', () => {
    expect(typeof runSeed).toBe('function');
  });

  it('handles missing seed CSV file gracefully without exiting process', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    const mockDb = {} as any;

    const result = await runSeed(mockDb, '/non/existent/path.csv');
    expect(result).toEqual({ insertedCount: 0 });
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('inserts seed records with onConflictDoNothing', async () => {
    const sampleCsv = `Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL
Mock Stall,Food,Com 1,1,Near entrance,1.23,103.45,0800hrs,2000hrs,https://example.com/img.jpg`;

    const tmpCsvPath = '/tmp/test-seed.csv';
    fs.writeFileSync(tmpCsvPath, sampleCsv);

    const mockReturning = vi.fn().mockResolvedValue([{ id: 'mock-id' }]);
    const mockOnConflictDoNothing = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

    const mockDb = { insert: mockInsert } as any;

    const result = await runSeed(mockDb, tmpCsvPath);
    expect(result.insertedCount).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(1);

    if (fs.existsSync(tmpCsvPath)) fs.unlinkSync(tmpCsvPath);
  });
});
