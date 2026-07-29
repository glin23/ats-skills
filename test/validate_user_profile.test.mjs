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

test('validateProfileBundle warns when zip is missing but does not block', () => {
  const home = tempHome();
  writeBundle(home, {
    visa_status: 'F-1 OPT eligible',
    authorized_to_work_us: true,
    requires_sponsorship_now: false,
    requires_sponsorship_future: true,
  });
  const result = validateProfileBundle(home);
  assert.equal(result.ok, true);
  assert.match(result.warnings.map((w) => w.message).join('\n'), /zip\/postal-code-gated forms/);
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

test('a hand-edited form_answer_policy that is nearly right is an error, not a silent null', () => {
  // 「defer」不是「defer_to_user」. 下游读不出这一格就当他没答过, 于是他答过的
  // 问题被再问一遍 —— 这正是新增这一格要防的那件事.
  const home = tempHome();
  writeBundle(home, {
    visa_status: 'student_visa_no_permission_yet',
    authorized_to_work_us: null,
    requires_sponsorship_now: null,
    requires_sponsorship_future: true,
    form_answer_policy: 'defer',
  });
  const result = validateProfileBundle(home);
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => `${i.path}: ${i.message}`).join('\n'), /form_answer_policy/);

  for (const value of [null, 'defer_to_user', 'answer_yes', 'answer_no']) {
    const good = tempHome();
    writeBundle(good, {
      visa_status: 'student_visa_no_permission_yet',
      authorized_to_work_us: null,
      requires_sponsorship_now: null,
      requires_sponsorship_future: true,
      form_answer_policy: value,
    });
    assert.equal(validateProfileBundle(good).ok, true, `${JSON.stringify(value)} must be accepted`);
  }
});
