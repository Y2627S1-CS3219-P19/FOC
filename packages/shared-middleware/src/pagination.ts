import { z } from 'zod';

/** One pagination convention for every list endpoint: ?page=1&limit=20 -> { data, page, limit, total }. */
export function paginationSchema(maxLimit = 100, defaultLimit = 20) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  });
}

export interface Page<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}
