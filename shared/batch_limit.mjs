export function argValue(argv = process.argv, name = '--max') {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : null;
}

export function parseMaxRows(value, fallback = null) {
  if (value == null || String(value).trim() === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  if (['all', 'unlimited', 'none', 'no-limit', '0'].includes(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  if (n === 0) return null;
  return Math.max(1, Math.floor(n));
}

export function resolveMaxRows({
  argv = process.argv,
  env = process.env,
  argName = '--max',
  envName = 'MRWEIRDO_MAX_AUTO_APPLY',
  fallback = null,
} = {}) {
  const fromArg = argValue(argv, argName);
  if (fromArg != null) return parseMaxRows(fromArg, fallback);
  return parseMaxRows(env[envName], fallback);
}

export function formatMaxRows(maxRows) {
  return maxRows == null ? 'all' : String(maxRows);
}

export function limitRows(rows, maxRows) {
  return maxRows == null ? rows : rows.slice(0, maxRows);
}
