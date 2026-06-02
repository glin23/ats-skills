export function hasUsableApplyUrl(jobOrUrl) {
  const raw = typeof jobOrUrl === 'string'
    ? jobOrUrl
    : (jobOrUrl?.apply_url || jobOrUrl?.url || '');
  const value = String(raw || '').trim();
  if (!/^https?:\/\//i.test(value)) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

