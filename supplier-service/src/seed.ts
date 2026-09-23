import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { AppContext } from './context.js';

const FLAG = 'seed_completed';
const SEED_LOCK = 7_270_201;

interface SeedRow {
  Name: string;
  Type: string;
  Building: string;
  Floor: string;
  'Location Description': string;
  Latitude: string;
  Longitude: string;
  StartingTime: string;
  ClosingTime: string;
  ImageURL: string;
}

/** Windows-1252 bytes 0x80-0x9F that differ from Latin-1 and appear in hand-edited CSVs (smart quotes, dashes). */
const CP1252: Record<number, string> = { 0x85: '...', 0x91: "'", 0x92: "'", 0x93: '"', 0x94: '"', 0x96: '-', 0x97: '-' };

/**
 * The template CSV is not valid UTF-8: it contains a Windows-1252 apostrophe (byte 0x92). If the file is not
 * clean UTF-8, decode it byte-by-byte as Windows-1252 (Node's built-in decoder treats it as Latin-1).
 */
export function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  const text = utf8.includes('�') ? Array.from(buffer, (b) => CP1252[b] ?? String.fromCharCode(b)).join('') : utf8;
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** "0900hrs" -> "09:00" */
export function parseSeedTime(value: string): string {
  const m = /^(\d{2})(\d{2})\s*hrs?$/i.exec(value.trim());
  if (!m) throw new Error(`Unrecognised time "${value}" (expected e.g. 0900hrs)`);
  return `${m[1]}:${m[2]}`;
}

const num = (v: string) => (v.trim() === '' ? null : Number(v));

/**
 * Loads data/csv/supplier-seed-data.csv on the FIRST start only (M3: suppliers may be predefined).
 * A flag in system_state stops it running again, so suppliers an admin deletes are not re-created on restart.
 * Safe with concurrent starts (advisory lock) and duplicate names (ON CONFLICT DO NOTHING).
 */
export async function seedSuppliers(ctx: AppContext): Promise<number> {
  const client = await ctx.pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK]);
    const { rows } = await client.query<{ value: string }>('SELECT value FROM system_state WHERE key = $1', [FLAG]);
    if (rows[0]?.value === 'true') return 0;

    const records = parse(decodeCsv(await readFile(ctx.config.seedCsvPath)), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as SeedRow[];

    let inserted = 0;
    await client.query('BEGIN');
    for (const r of records) {
      const imageFile = r.ImageURL ? path.basename(new URL(r.ImageURL).pathname) : '';
      const imagePath = imageFile && existsSync(path.join(ctx.config.imagesDir, imageFile)) ? imageFile : null;
      const tags = r.Type.split('/').map((t) => t.trim().toLowerCase()).filter(Boolean);
      const res = await client.query(
        `INSERT INTO suppliers (name, facility_type, building, floor, location_description, latitude, longitude,
                                opens_at, closes_at, image_path, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT ((lower(name))) DO NOTHING`,
        [
          r.Name,
          r.Type,
          r.Building,
          r.Floor || null,
          r['Location Description'] ?? '',
          num(r.Latitude),
          num(r.Longitude),
          parseSeedTime(r.StartingTime),
          parseSeedTime(r.ClosingTime),
          imagePath,
          tags,
        ],
      );
      inserted += res.rowCount ?? 0;
    }
    await client.query(
      `INSERT INTO system_state (key, value) VALUES ($1, 'true') ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
      [FLAG],
    );
    await client.query('COMMIT');
    ctx.logger.info({ inserted, total: records.length }, 'Seeded suppliers from CSV');
    return inserted;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
