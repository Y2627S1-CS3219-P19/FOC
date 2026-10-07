import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createDb } from './connection.js';
import * as schema from './schema.js';
import { parseSeedCsv } from './seedParser.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSeed(
  dbInstance?: ReturnType<typeof createDb>['db'],
  customCsvPath?: string
): Promise<{ insertedCount: number }> {
  console.log('Seeding campus suppliers...');
  const csvPath =
    customCsvPath ??
    process.env.SEED_CSV_PATH ??
    path.resolve(__dirname, '../../../data/csv/supplier-seed-data.csv');

  if (!fs.existsSync(csvPath)) {
    console.warn(`Seed CSV file not found at: ${csvPath}, skipping seeding.`);
    return { insertedCount: 0 };
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parseSeedCsv(csvContent);
  console.log(`Parsed ${records.length} records from CSV.`);

  const shouldClose = !dbInstance;
  let clientToClose: ReturnType<typeof createDb>['client'] | null = null;
  let db = dbInstance;

  if (!db) {
    const conn = createDb();
    clientToClose = conn.client;
    db = conn.db;
  }

  try {
    let insertedCount = 0;
    for (const record of records) {
      const result = await db
        .insert(schema.suppliers)
        .values({
          name: record.name,
          facilityType: record.facilityType,
          building: record.building,
          floor: record.floor,
          locationDescription: record.locationDescription,
          latitude: record.latitude,
          longitude: record.longitude,
          opensAt: record.opensAt,
          closesAt: record.closesAt,
          isActive: true,
          imageUrl: record.imageUrl,
        })
        .onConflictDoNothing()
        .returning();

      if (result.length > 0) {
        insertedCount++;
      }
    }

    console.log(
      `Seeding completed. Inserted ${insertedCount} new suppliers (${records.length - insertedCount} already existed).`
    );
    return { insertedCount };
  } catch (err) {
    console.error('Seeding failed:', err);
    throw err;
  } finally {
    if (shouldClose && clientToClose) {
      await clientToClose.end();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runSeed().catch(() => process.exit(1));
}
