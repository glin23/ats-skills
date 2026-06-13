import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  markCoverLetterUsed,
  writeCoverLetterArtifact,
} from '../shared/cover_letter_materials.mjs';
import { onboardTestEnv } from './helpers.mjs';

function sampleProfile() {
  return {
    personal: {
      first_name: 'Alex',
      last_name: 'Chen',
      full_name: 'Alex Chen',
      email: 'alex@example.com',
    },
    education: {
      school: 'State University',
      degree: 'B.S.',
      major: 'Business Analytics',
    },
    experience_summary: [
      {
        title: 'Operations Project Intern',
        company: 'Campus Lab',
        summary: 'organized data checks and weekly stakeholder updates',
      },
    ],
  };
}

function sampleEssayProfile() {
  return {
    candidate_positioning: {
      one_sentence_pitch: 'business analytics student with operations project experience',
      strongest_themes: ['operations', 'analytics'],
    },
    proof_points: [
      {
        label: 'Operations dashboard',
        context: 'student project',
        actions: ['cleaned weekly data', 'summarized bottlenecks'],
        evidence: 'class project notes',
        skills: ['analysis', 'communication'],
      },
    ],
    cover_letter_defaults: {
      opening_angle: 'resume-backed operations and analytics work',
      closing_angle: '',
    },
  };
}

test('D1 cover letter generation uses allowed sources and avoids unsupported company facts without key_alignment', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-cover-letter-'));
  const result = writeCoverLetterArtifact({
    home,
    row: {
      id: 12,
      company: 'Acme',
      title: 'Operations Intern',
      key_alignment: '',
    },
    profile: sampleProfile(),
    essayProfile: sampleEssayProfile(),
    answerBank: {
      fallback_text: {
        why_company: 'Acme has a world-changing mission and product.',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.review.ok, true);
  assert.ok(existsSync(result.path));
  assert.ok(existsSync(result.html_path));
  assert.equal(readFileSync(result.path, 'utf8').slice(0, 4), '%PDF');
  const html = readFileSync(result.html_path, 'utf8');
  assert.match(html, /Operations Intern/);
  assert.match(html, /Operations dashboard/);
  assert.doesNotMatch(html, /world-changing mission|product|customers|platform|industry-leading/i);
  assert.deepEqual(result.metadata.sources, ['resume/profile', 'essay_profile', 'answer_bank', 'key_alignment']);

  const index = readFileSync(join(home, 'materials/index.jsonl'), 'utf8');
  const feedback = readFileSync(join(home, 'feedback.jsonl'), 'utf8');
  assert.match(index, /"source":"d1_onboard_auto"/);
  assert.match(index, /"used_in_submission":false/);
  assert.match(feedback, /cover_letter_generated/);

  const used = markCoverLetterUsed({ home, rowId: 12, path: result.path, resultFile: '/tmp/result.jsonl' });
  assert.equal(used.ok, true);
  const updatedIndex = readFileSync(join(home, 'materials/index.jsonl'), 'utf8');
  assert.match(updatedIndex, /"used_in_submission":true/);
});

test('materialize_cover_letter reads stored key_alignment for row-scoped evidence', () => {
  const home = mkdtempSync(join(tmpdir(), 'mrweirdo-cover-cli-'));
  const dbPath = join(home, 'jobs.db');
  const env = onboardTestEnv(home, { MRWEIRDO_DB_PATH: dbPath });
  writeFileSync(join(home, 'profile.json'), JSON.stringify(sampleProfile()));
  writeFileSync(join(home, 'essay_profile.json'), JSON.stringify(sampleEssayProfile()));
  execFileSync(process.execPath, ['shared/init_db_cli.mjs'], { cwd: process.cwd(), env });
  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO jobs(company, title, apply_url, status, key_alignment)
    VALUES ('Beta', 'Data Operations Intern', 'https://boards.greenhouse.io/beta/jobs/1', '🤖 AI sourced', ?)
  `).run('dashboard project aligns with data quality checks / stakeholder updates match operations role');
  const rowId = db.prepare('SELECT id FROM jobs').get().id;
  db.close();

  const stdout = execFileSync(process.execPath, [
    'shared/materialize_cover_letter.mjs',
    '--row-id',
    String(rowId),
    '--json',
  ], { cwd: process.cwd(), env, encoding: 'utf8' });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.metadata.key_alignment_used, true);
  const html = readFileSync(result.html_path, 'utf8');
  assert.match(html, /dashboard project aligns with data quality checks/);
});
