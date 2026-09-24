import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { createDb } from './connection.js';
import * as schema from './schema.js';
import { parseSeedCsv } from './seedParser.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  console.log('Seeding campus suppliers...');
  const csvPath =
    process.env.SEED_CSV_PATH ??
    path.resolve(__dirname, '../../../data/csv/supplier-seed-data.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`Seed CSV file not found at: ${csvPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const records = parseSeedCsv(csvContent);
  console.log(`Parsed ${records.length} records from CSV.`);

  const { client, db } = createDb();

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

    console.log(`Seeding completed. Inserted ${insertedCount} new suppliers (${records.length - insertedCount} already existed).`);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
