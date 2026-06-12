const QUIET = process.env.MRWEIRDO_QUIET === '1';

export function progress(stage, message, detail = null) {
  if (QUIET) return;
  const suffix = detail == null
    ? ''
    : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  process.stderr.write(`[mrweirdo] ${stage} ${message}${suffix}\n`);
}

export async function sleepWithProgress(ms, {
  stage = 'wait',
  label = 'waiting',
  intervalMs = 15000,
  next = '',
} = {}) {
  const total = Math.max(0, Number(ms) || 0);
  if (total <= 0) return;

  const started = Date.now();
  let nextLogAt = 0;
  while (Date.now() - started < total) {
    const elapsed = Date.now() - started;
    const remaining = Math.max(0, total - elapsed);
    if (elapsed >= nextLogAt) {
      const seconds = Math.ceil(remaining / 1000);
      progress(stage, `${label} ${seconds}s${next ? `; next: ${next}` : ''}`);
      nextLogAt += Math.max(1000, intervalMs);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining)));
  }
}
