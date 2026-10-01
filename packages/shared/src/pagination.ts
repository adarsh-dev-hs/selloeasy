import { z } from 'zod';

/** Default page size for the leads grid (plan §11.2, ADR-0005). */
export const DEFAULT_PAGE_SIZE = 6;
export const MAX_PAGE_SIZE = 50;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number(),
    pageSize: z.number(),
    total: z.number(),
    totalPages: z.number(),
  });
}

export function toPage<T>(items: T[], total: number, q: PageQuery): Page<T> {
  return {
    items,
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
  };
}

export function offsetOf(q: PageQuery): number {
  return (q.page - 1) * q.pageSize;
}
