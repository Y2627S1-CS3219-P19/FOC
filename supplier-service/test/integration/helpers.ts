import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TEST_IMAGES_DIR = path.resolve(__dirname, '../../../data/images');

export async function createTestApp(overrides: {
  dbReady?: boolean;
  imagesDir?: string;
  skipAuth?: boolean;
} = {}): Promise<FastifyInstance> {
  const app = await buildApp({
    dbReady: overrides.dbReady ?? true,
    imagesDir: overrides.imagesDir ?? TEST_IMAGES_DIR,
    skipAuth: overrides.skipAuth ?? false,
  });
  await app.ready();
  return app;
}
