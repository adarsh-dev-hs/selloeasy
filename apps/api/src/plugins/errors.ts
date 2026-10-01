import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import fp from 'fastify-plugin';
import { HttpError } from '../lib/errors';

/** Global RFC 7807 error handler. */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const base = { instance: req.url, requestId: req.id };
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send({
          type: 'about:blank',
          title: 'Validation failed',
          status: 400,
          code: 'validation_error',
          detail: 'The request does not match the expected schema.',
          errors: err.validation.map((v) => ({
            path: (v.instancePath || '').replace(/^\//, '').replace(/\//g, '.'),
            message: v.message,
          })),
          ...base,
        });
    }
    if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause.issues }, 'Response serialization failed');
      return reply.code(500).type('application/problem+json').send({ title: 'Internal Server Error', status: 500, code: 'serialization_error', ...base });
    }
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ err }, err.message);
      return reply
        .code(err.status)
        .type('application/problem+json')
        .send({ type: 'about:blank', title: err.message, status: err.status, code: err.code, details: err.details, ...base });
    }
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) req.log.error({ err }, 'Unhandled error');
    return reply
      .code(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: status >= 500 ? 'Internal Server Error' : err.message,
        status,
        code: err.code ?? (status >= 500 ? 'internal_error' : 'error'),
        ...base,
      });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).type('application/problem+json').send({ title: 'Route not found', status: 404, code: 'route_not_found', instance: req.url });
  });
});
