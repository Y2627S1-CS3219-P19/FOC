import type { FastifyPluginAsync } from 'fastify';
import fastifyStatic from '@fastify/static';

export interface ImageRoutesOptions {
  imagesDir: string;
}

export const imageRoutes: FastifyPluginAsync<ImageRoutesOptions> = async (fastify, opts) => {
  await fastify.register(fastifyStatic, {
    root: opts.imagesDir,
    prefix: '/v1/supplier-images/',
    decorateReply: false,
    maxAge: '1h',
  });
};
