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

  it('fails loudly when the seed CSV is not valid UTF-8', async () => {
    const cp1252CsvPath = '/tmp/test-seed-cp1252.csv';
    // "Prince George’s Park" as an Excel/Windows-1252 export writes it: 0x92, not UTF-8.
    fs.writeFileSync(
      cp1252CsvPath,
      Buffer.concat([
        Buffer.from(
          'Name,Type,Building,Floor,Location Description,Latitude,Longitude,StartingTime,ClosingTime,ImageURL\nOctobox,Shopping,Prince George',
          'ascii'
        ),
        Buffer.from([0x92]),
        Buffer.from('s Park,2,Near PGP entrance,1.29,103.77,0000hrs,2359hrs,', 'ascii'),
      ])
    );

    const mockInsert = vi.fn();
    const mockDb = { insert: mockInsert } as any;

    await expect(runSeed(mockDb, cp1252CsvPath)).rejects.toThrow(/not valid UTF-8/i);
    expect(mockInsert).not.toHaveBeenCalled();

    if (fs.existsSync(cp1252CsvPath)) fs.unlinkSync(cp1252CsvPath);
  });
});
