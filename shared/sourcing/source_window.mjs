/**
 * Return a rotating window over a source list.
 *
 * The source lists are local checked-in directories. A run-level offset lets
 * discovery inspect a different slice each time instead of repeatedly crawling
 * the same first N tenants/slugs.
 */
export function sourceWindow(items, { limit = null, offset = 0 } = {}) {
  const source = Array.isArray(items) ? items : [];
  if (source.length === 0) return [];

  const numericLimit = Number(limit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0 || numericLimit >= source.length) {
    return source.slice();
  }

  const size = Math.floor(numericLimit);
  const start = normalizedOffset(offset, source.length);
  const rotated = source.slice(start).concat(source.slice(0, start));
  return rotated.slice(0, size);
}

export function normalizedOffset(offset, length) {
  if (!Number.isFinite(Number(offset)) || length <= 0) return 0;
  return ((Math.floor(Number(offset)) % length) + length) % length;
}

