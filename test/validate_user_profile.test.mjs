import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateProfileBundle } from '../shared/validate_user_profile.mjs';

function tempHome() {
  return mkdtempSync(join(tmpdir(), 'mrweirdo-profile-'));
}

function writeBundle(home, auth) {
  writeFileSync(join(home, 'profile.json'), JSON.stringify({
    personal: { first_name: 'Test', last_name: 'Student', email: 'test@example.com' },
    education: { school: 'Example University', major: 'Business', graduation_date: '05/2027' },
    work_authorization: auth,
    legal_attestations: {
      conflicting_obligations: null,
      no_prohibited_possessor_status: null,
    },
    resume_path: join(home, 'resume.pdf'),
  }));
  writeFileSync(join(home, 'search_intent.json'), JSON.stringify({
    user_summary: {
      education_level: 'undergraduate',
      field_of_study: 'Business',
      school: 'Example University',
    },
    search_intent: {
      role_categories: [{ title_pattern: 'Marketing Intern', priority: 'high' }],
      seniority: 'intern',
      role_type_targets: ['intern'],
      geographic_preference: {
        primary_country: 'US',
        preferred_metros: ['Anywhere US'],
        countries_open_to: ['US'],
        relocation_policy: 'anywhere_primary_country',
        willing_to_relocate_for_internship: true,
        remote_acceptable: true,
      },
    },
    _meta: { generated_at: '2026-05-31T00:00:00Z', model: 'test', schema_version: 'test' },
  }));
}

test('validateProfileBundle accepts canonical work authorization keys', () => {
  const home = tempHome();
  writeBundle(home, {
    visa_status: 'F-1 OPT eligible',
    authorized_to_work_us: true,
    requires_sponsorship_now: false,
    requires_sponsorship_future: true,
  });
  const result = validateProfileBundle(home);
  assert.equal(result.ok, true);
});

test('validateProfileBundle rejects legacy work authorization-only shape', () => {
  const home = tempHome();
  writeBundle(home, {
    status: 'f1_opt',
    needs_sponsor: true,
    sponsor_when: 'future',
  });
  const result = validateProfileBundle(home);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join('\n'), /missing canonical key visa_status/);
  assert.match(result.issues.map((i) => i.message).join('\n'), /legacy keys/);
});
