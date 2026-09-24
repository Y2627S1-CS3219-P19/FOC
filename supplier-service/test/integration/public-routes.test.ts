import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from './helpers.js';

describe('Slice 4: Public Routes (Health & Images)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({ dbReady: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Probes', () => {
    it('GET /health/live returns 200 { status: "UP" }', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'UP' });
    });

    it('GET /health/ready returns 200 when database is ready', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'UP', checks: { db: true } });
    });

    it('GET /health/ready returns 503 when database is not ready', async () => {
      const downApp = await createTestApp({ dbReady: false });
      const response = await downApp.inject({
        method: 'GET',
        url: '/health/ready',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ status: 'DOWN', checks: { db: false } });
      await downApp.close();
    });
  });

  describe('Public Images (GET /v1/supplier-images/:file)', () => {
    it('serves existing static image without requiring Authorization header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/supplier-images/COOL_SPOT.jpeg',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toMatch(/image\/jpeg/);
      expect(response.rawPayload.length).toBeGreaterThan(0);
    });

    it('returns 404 for non-existent image', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/supplier-images/DOES_NOT_EXIST.jpeg',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
