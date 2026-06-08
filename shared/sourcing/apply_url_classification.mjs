import { hasUsableApplyUrl } from './usable_apply_url.mjs';

export const SUPPORTED_AUTO_PLATFORMS = new Set(['greenhouse', 'ashby', 'lever']);
export const KNOWN_UNSUPPORTED_PLATFORMS = new Set([
  'workday',
  'smartrecruiters',
  'icims',
  'jobvite',
  'handshake',
  'bamboohr',
  'rippling',
  'recruitee',
  'personio',
]);

export function platformFromUrl(url) {
  const raw = String(url || '');
  const u = raw.toLowerCase();
  if (u.includes('greenhouse.io') || /[?&](gh_jid|token)=/i.test(raw)) return 'greenhouse';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('myworkdayjobs.com')) return 'workday';
  if (u.includes('jobs.smartrecruiters.com') || u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('icims.com')) return 'icims';
  if (u.includes('jobs.jobvite.com')) return 'jobvite';
  if (u.includes('joinhandshake.com')) return 'handshake';
  if (u.includes('bamboohr.com')) return 'bamboohr';
  if (u.includes('ats.rippling.com')) return 'rippling';
  if (u.includes('recruitee.com')) return 'recruitee';
  if (u.includes('personio.com') || u.includes('jobs.personio.com')) return 'personio';
  return 'other';
}

export function discoveryApplyBucket(job = {}) {
  if (!hasUsableApplyUrl(job)) return 'unusable_apply_url';

  const source = String(job._discovery_source || job.search_source || job.source || '').toLowerCase();
  const platform = platformFromUrl(job.apply_url || job.url);
  if (SUPPORTED_AUTO_PLATFORMS.has(platform)) return 'auto_supported';
  if (job.manual_apply_required === true || source === 'yc_waas' || source === 'remoteok') return 'manual_only';
  if (KNOWN_UNSUPPORTED_PLATFORMS.has(platform)) return 'known_unsupported_ats';
  return 'unknown_or_custom_platform';
}

export function isAutoSupportedCandidate(job = {}) {
  return discoveryApplyBucket(job) === 'auto_supported';
}
