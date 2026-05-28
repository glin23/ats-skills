const INTERN_RE = /\b(intern|internship|co-?op)\b/i;
const PART_TIME_RE = /\b(part[\s-]?time|working student|student assistant|student worker|campus ambassador|brand ambassador)\b/i;
const NEW_GRAD_RE = /\b(new\s?grad|new\s?graduate|university\s?grad|university\s?graduate|early\s?career|recent\s?graduate)\b/i;
const SENIOR_RE = /\b(senior|staff|principal|director|vp |head of |chief )\b/i;
const FULL_TIME_RE = /\b(full[\s-]?time|fulltime|permanent|regular employee)\b/i;
// Structured employment_type / schedule values that describe a *permanent*
// role. Used only to flag a conflict (intern-titled but employment looks
// permanent); never to hard-reclassify, because many real internships report
// full-time HOURS via these same fields.
const PERMANENT_EMPLOYMENT_RE = /\b(full[\s-]?time|fulltime|permanent|regular)\b/i;
// Any signal that a role really is short-term / student-oriented. If present
// anywhere (title or structured fields) there is no conflict to surface.
const TEMP_SIGNAL_RE = /\b(intern|internship|co-?op|temp|temporary|contract|seasonal|fixed[\s-]?term|part[\s-]?time|working student|student)\b/i;

export function normalizeRoleType(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (v === 'internship') return 'intern';
  if (v === 'full_time' || v === 'fulltime' || v === 'new_grad' || v === 'new_grad_ft') return 'new_grad_FT';
  if (v === 'part_time' || v === 'parttime') return 'part_time';
  if (v === 'intern' || v === 'new_grad_FT') return v;
  return null;
}

export function roleTypesFromSearchIntent(search = {}, envTargets = process.env.MRWEIRDO_ROLE_TYPE_TARGETS) {
  const explicit = envTargets
    ? envTargets.split(',')
    : (search.role_type_targets || search.target_role_types || []);
  const normalized = explicit.map(normalizeRoleType).filter(Boolean);
  if (normalized.length) return [...new Set(normalized)];

  const seniority = search.seniority || 'intern';
  // Legacy profiles sometimes used "both" before the questionnaire had a
  // hard role-type multi-select. Do not silently widen auto-submit to
  // full-time; new-grad/full-time must now be selected explicitly.
  if (seniority === 'both') return ['intern', 'part_time'];
  if (seniority === 'intern_or_part_time') return ['intern', 'part_time'];
  const one = normalizeRoleType(seniority);
  return one ? [one] : ['intern'];
}

export function classifyRoleType(job = {}) {
  const title = String(job.title || '');
  const employment = String(
    job.employment_type || job.employmentType || job.schedule || job.commitment || ''
  ).toLowerCase();
  const combined = `${title} ${employment}`;
  const explicitIntern = INTERN_RE.test(combined);
  const explicitFullTime = FULL_TIME_RE.test(combined);

  if (PART_TIME_RE.test(combined)) return 'part_time';
  if (NEW_GRAD_RE.test(combined)) return 'new_grad_FT';
  if (explicitFullTime && !explicitIntern) return 'other';
  if (explicitIntern) return 'intern';
  return 'other';
}

export function deriveRoleTypeFromJob(job = {}) {
  const stored = normalizeRoleType(job.role_type_match);
  const derived = classifyRoleType(job) || 'other';
  if ((stored === 'intern' || stored === 'part_time') && derived !== stored) return derived;
  return stored || derived;
}

export function passesAllowedRoleType(job = {}, allowedRoleTypes = ['intern', 'part_time']) {
  const roleType = classifyRoleType(job);
  if (!allowedRoleTypes.includes(roleType)) return false;
  const title = String(job.title || '');
  if (SENIOR_RE.test(title)) return false;
  return true;
}

// Cross-check the structured employment fields against the title to surface
// (but NOT block) suspicious postings. The title remains the strong signal:
// roleType is whatever classifyRoleType decided. A conflict is raised only
// when an intern/co-op-TITLED role carries an employment_type/schedule that
// looks PERMANENT and there is NO temp/intern/student signal anywhere. This
// preserves the legitimate "full-time-HOURS internship" case: such postings
// still carry an intern signal in the title (and usually employment_type
// "Intern"/"Internship"), so the TEMP_SIGNAL_RE in the title cancels the
// flag for the genuine ones — only employment_type values like a bare
// "FullTime"/"Permanent"/"Regular" on an intern title trip the flag for a
// human glance.
export function roleTypeConflict(job = {}) {
  const roleType = classifyRoleType(job);
  const title = String(job.title || '');
  const employment = String(
    job.employment_type || job.employmentType || job.schedule || job.commitment || ''
  );

  if (roleType !== 'intern') {
    return { roleType, conflict: false, reason: '' };
  }

  // Title says intern. Does the structured employment field look permanent
  // while NOTHING (title or employment field) carries a temp/student signal?
  const employmentLooksPermanent = PERMANENT_EMPLOYMENT_RE.test(employment);
  const hasTempSignalInEmployment = TEMP_SIGNAL_RE.test(employment);

  if (employmentLooksPermanent && !hasTempSignalInEmployment) {
    return {
      roleType,
      conflict: true,
      reason: `intern-titled role has permanent employment_type "${employment.trim()}" with no intern/temp signal; verify it is a true internship (not a permanent full-time role an F-1 student cannot take)`,
    };
  }

  return { roleType, conflict: false, reason: '' };
}
