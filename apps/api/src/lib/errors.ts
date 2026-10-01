/**
 * Errors rendered as RFC 7807 `application/problem+json` (plan §18).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'You do not have permission to perform this action') =>
  new HttpError(403, message, 'forbidden');
/** Cross-tenant access returns 404 (not 403) so resource existence is not leaked (plan §8.1). */
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`, 'not_found');
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, 'conflict', details);
export const tooMany = (message: string) => new HttpError(429, message, 'too_many_requests');
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, message, 'unprocessable', details);
export const serviceUnavailable = (message: string) => new HttpError(503, message, 'service_unavailable');
