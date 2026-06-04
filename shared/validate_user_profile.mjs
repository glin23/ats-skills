#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atsHome } from './paths.mjs';
import { roleTypesFromSearchIntent } from './role_types.mjs';

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function typeOfNullable(value, type) {
  return value == null || typeof value === type;
}

function pushIssue(issues, severity, file, path, message) {
  issues.push({ severity, file, path, message });
}

export function validateProfileBundle(home = atsHome()) {
  const profilePath = join(home, 'profile.json');
  const intentPath = join(home, 'search_intent.json');
  const essayPath = join(home, 'essay_profile.json');
  const issues = [];
  const warnings = [];

  if (!existsSync(profilePath)) {
    pushIssue(issues, 'error', profilePath, '', 'profile.json is missing');
  }
  if (!existsSync(intentPath)) {
    pushIssue(issues, 'error', intentPath, '', 'search_intent.json is missing');
  }

  const profileRead = existsSync(profilePath) ? readJson(profilePath) : { ok: false };
  const intentRead = existsSync(intentPath) ? readJson(intentPath) : { ok: false };
  const essayRead = existsSync(essayPath) ? readJson(essayPath) : { ok: true, value: null };

  if (existsSync(profilePath) && !profileRead.ok) {
    pushIssue(issues, 'error', profilePath, '', `profile.json is invalid JSON: ${profileRead.error}`);
  }
  if (existsSync(intentPath) && !intentRead.ok) {
    pushIssue(issues, 'error', intentPath, '', `search_intent.json is invalid JSON: ${intentRead.error}`);
  }
  if (existsSync(essayPath) && !essayRead.ok) {
    pushIssue(issues, 'error', essayPath, '', `essay_profile.json is invalid JSON: ${essayRead.error}`);
  }

  const profile = profileRead.value || {};
  const auth = profile.work_authorization || {};
  if (profileRead.ok && existsSync(profilePath)) {
    const canonical = [
      ['visa_status', 'string'],
      ['authorized_to_work_us', 'boolean'],
      ['requires_sponsorship_now', 'boolean'],
      ['requires_sponsorship_future', 'boolean'],
    ];
    if (!profile.work_authorization || typeof profile.work_authorization !== 'object') {
      pushIssue(issues, 'error', profilePath, 'work_authorization', 'work_authorization object is required');
    } else {
      for (const [key, type] of canonical) {
        if (!hasOwn(auth, key)) {
          pushIssue(issues, 'error', profilePath, `work_authorization.${key}`, `missing canonical key ${key}`);
        } else if (!typeOfNullable(auth[key], type)) {
          pushIssue(issues, 'error', profilePath, `work_authorization.${key}`, `${key} must be ${type} or null`);
        }
      }
      if (hasOwn(auth, 'status') || hasOwn(auth, 'needs_sponsor') || hasOwn(auth, 'sponsor_when')) {
        pushIssue(
          issues,
          'error',
          profilePath,
          'work_authorization',
          'legacy keys status/needs_sponsor/sponsor_when are not enough; use visa_status, authorized_to_work_us, requires_sponsorship_now, requires_sponsorship_future'
        );
      }
    }

    const legal = profile.legal_attestations || {};
    for (const key of ['conflicting_obligations', 'no_prohibited_possessor_status']) {
      if (hasOwn(legal, key) && !typeOfNullable(legal[key], 'boolean')) {
        pushIssue(issues, 'error', profilePath, `legal_attestations.${key}`, `${key} must be boolean or null`);
      }
    }

    if (!profile.resume_path) {
      pushIssue(warnings, 'warning', profilePath, 'resume_path', 'resume_path is empty; uploads may fail');
    }
    const personal = profile.personal || {};
    if (!personal.address_zip && !personal.zip && !personal.postal_code) {
      pushIssue(
        warnings,
        'warning',
        profilePath,
        'personal.address_zip',
        'address_zip is empty; zip/postal-code-gated forms will be skipped until the user adds a real value'
      );
    }
  }

  const intent = intentRead.value || {};
  const searchIntent = intent.search_intent || intent || {};
  if (intentRead.ok && existsSync(intentPath)) {
    const roleTargets = roleTypesFromSearchIntent(searchIntent);
    if (!roleTargets.length) {
      pushIssue(issues, 'error', intentPath, 'search_intent.role_type_targets', 'role_type_targets must include intern, part_time, and/or new_grad_FT');
    }
    const geo = searchIntent.geographic_preference || {};
    if (!geo.primary_country) {
      pushIssue(issues, 'error', intentPath, 'search_intent.geographic_preference.primary_country', 'primary_country is required');
    }
    if (!Array.isArray(geo.countries_open_to) || geo.countries_open_to.length === 0) {
      pushIssue(issues, 'error', intentPath, 'search_intent.geographic_preference.countries_open_to', 'countries_open_to must be a non-empty array');
    }
    if (!geo.relocation_policy) {
      pushIssue(issues, 'error', intentPath, 'search_intent.geographic_preference.relocation_policy', 'relocation_policy is required');
    }
  }

  return {
    ok: issues.length === 0,
    home,
    files: { profile: profilePath, search_intent: intentPath, essay_profile: essayPath },
    issues,
    warnings,
  };
}

function printHuman(result) {
  console.log(`# Mr. Weirdo profile validation`);
  console.log(`ok: ${result.ok}`);
  console.log(`home: ${result.home}`);
  for (const issue of result.issues) {
    console.log(`- FAIL ${issue.path || issue.file}: ${issue.message}`);
  }
  for (const warning of result.warnings) {
    console.log(`- WARN ${warning.path || warning.file}: ${warning.message}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const homeFlag = process.argv.indexOf('--home');
  const home = homeFlag >= 0 ? process.argv[homeFlag + 1] : atsHome();
  const result = validateProfileBundle(home);
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exit(result.ok ? 0 : 1);
}
