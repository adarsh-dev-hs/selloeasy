import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { createRedis, getConfig, loggerOptions, type Redis } from '@selloeasy/core';
import { pingDb } from '@selloeasy/db';
import { createLlm } from '@selloeasy/engine';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import './types';
import { authRoutes } from './modules/auth';
import { dashboardRoutes } from './modules/dashboards';
import { intelligenceRoutes } from './modules/intelligence';
import { knowledgeRoutes } from './modules/knowledge';
import { leadRoutes } from './modules/leads';
import { orgRoutes } from './modules/org';
import { outreachRoutes } from './modules/outreach';
import { platformRoutes } from './modules/platform';
import { platformDataRoutes } from './modules/platform-data';
import { auditPlugin } from './plugins/audit';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';

export interface BuildOptions {
  redis?: Redis;
  logger?: boolean;
}

export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = getConfig();
  const app = Fastify({
    logger: opts.logger === false ? false : loggerOptions('api'),
    trustProxy: config.TRUST_PROXY,
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined)?.slice(0, 64) || randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: undefined,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const redis = opts.redis ?? createRedis();
  app.decorate('config', config);
  app.decorate('redis', redis);
  app.decorate('llm', createLlm({ redis }));
  app.addHook('onClose', async () => {
    if (!opts.redis) await redis.quit().catch(() => undefined);
  });
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  await app.register(errorsPlugin);
  await app.register(fastifyHelmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } });
  await app.register(fastifyCors, { origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true });
  await app.register(fastifyRateLimit, { max: config.RATE_LIMIT_MAX, timeWindow: config.RATE_LIMIT_WINDOW, redis, nameSpace: 'rl:' });
  // Multipart for platform data imports (plan2 §11.2); per-route size limits are enforced in the handler.
  await app.register(fastifyMultipart, { limits: { fileSize: config.IMPORT_MAX_MB * 1024 * 1024, files: 1, fields: 5 } });
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'SelloEasy API',
        version: '1.0.0',
        description: 'Marketing Intelligence platform API. Errors use RFC 7807 problem+json. Auth: httpOnly cookie session (se_at / se_rt).',
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'se_at' } } },
      security: [{ cookieAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/api/docs' });

  await app.register(authPlugin);
  await app.register(auditPlugin);

  app.get('/api/health', { schema: { tags: ['ops'], summary: 'Liveness' } }, async () => ({ status: 'ok' }));
  app.get('/api/ready', { schema: { tags: ['ops'], summary: 'Readiness (database + redis)' } }, async (_req, reply) => {
    const [db, rd] = await Promise.all([pingDb(), redis.ping().then((r) => r === 'PONG').catch(() => false)]);
    const ok = db && rd;
    reply.code(ok ? 200 : 503);
    return {
      status: ok ? 'ready' : 'degraded',
      checks: { database: db, redis: rd },
      llm: { mode: config.LLM_MODE, provider: app.llm.providerId, model: app.llm.model, autoMocked: config.llmAutoMocked },
    };
  });

  await app.register(
    async (v1) => {
      await v1.register(authRoutes);
      await v1.register(platformRoutes);
      await v1.register(platformDataRoutes);
      await v1.register(orgRoutes);
      await v1.register(knowledgeRoutes);
      await v1.register(intelligenceRoutes);
      await v1.register(leadRoutes);
      await v1.register(outreachRoutes);
      await v1.register(dashboardRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
