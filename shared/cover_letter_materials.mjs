import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { lockFile } from './state_file_lock.mjs';

const UNSUPPORTED_COMPANY_FACT_RE = /\b(mission|values?|culture|product|platform|customers?|users?|market|industry[- ]leading|technology stack)\b/i;
const UNSUPPORTED_PERSONAL_FACT_RE = /\b(GPA|certified|certification|security clearance|authorized to work|work authorization|salary|compensation)\b/i;

export const COVER_LETTER_ALLOWED_SOURCES = [
  'resume/profile',
  'essay_profile',
  'answer_bank',
  'key_alignment',
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compact(value, max = 220) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value) {
  const slug = String(value || 'cover-letter')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
  return slug || 'cover-letter';
}

function normalizeStringList(value, { max = 5 } = {}) {
  let raw = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^\s*[\[{]/.test(trimmed)) {
      try {
        raw = JSON.parse(trimmed);
      } catch {
        raw = trimmed;
      }
    }
  }
  const arr = Array.isArray(raw)
    ? raw
    : String(raw || '').split(/\s+\/\s+|\n+|;\s*/);
  return arr
    .map((item) => clean(typeof item === 'object' ? JSON.stringify(item) : item))
    .filter(Boolean)
    .slice(0, max);
}

function nameFromProfile(profile = {}) {
  const personal = profile.personal || {};
  return clean(personal.full_name || [personal.first_name, personal.last_name].filter(Boolean).join(' '));
}

function educationLine(profile = {}) {
  const education = profile.education || {};
  const parts = [
    education.degree,
    education.major,
    education.school ? `at ${education.school}` : '',
  ].filter(Boolean);
  return clean(parts.join(' '));
}

function latestExperienceLine(profile = {}) {
  const exp = Array.isArray(profile.experience_summary) ? profile.experience_summary[0] : null;
  if (!exp) return '';
  return clean([exp.title, exp.company ? `at ${exp.company}` : '', exp.summary || exp.description || ''].join(' '));
}

function proofPointSentences(profile = {}, essayProfile = {}, answerBank = {}) {
  const out = [];
  const proofPoints = Array.isArray(essayProfile.proof_points) ? essayProfile.proof_points : [];
  for (const point of proofPoints) {
    const label = clean(point.label);
    const context = clean(point.context);
    const actions = normalizeStringList(point.actions, { max: 2 }).join('; ');
    const evidence = clean(point.evidence);
    const skills = normalizeStringList(point.skills, { max: 4 }).join(', ');
    const sentence = compact([
      label || context,
      actions ? `I worked on ${actions}` : '',
      evidence ? `with evidence in ${evidence}` : '',
      skills ? `using ${skills}` : '',
    ].filter(Boolean).join(', '), 260);
    if (sentence) out.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
  }

  const stories = Array.isArray(essayProfile.project_stories) ? essayProfile.project_stories : [];
  for (const story of stories) {
    const sentence = compact([
      clean(story.name) ? `In ${clean(story.name)}` : '',
      clean(story.what_user_did),
      clean(story.result_or_learning) ? `The result or learning was ${clean(story.result_or_learning)}` : '',
    ].filter(Boolean).join(', '), 260);
    if (sentence) out.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
  }

  const latest = latestExperienceLine(profile);
  if (latest) out.push(`My recent resume-backed experience includes ${compact(latest, 220)}.`);

  const favoriteProject = clean(answerBank.fallback_text?.favorite_project || '');
  if (favoriteProject) out.push(`One resume-backed project I can discuss is ${compact(favoriteProject, 180)}.`);

  return [...new Set(out)].slice(0, 3);
}

function positioningLine(profile = {}, essayProfile = {}) {
  const pitch = clean(essayProfile.candidate_positioning?.one_sentence_pitch);
  if (pitch) return pitch;
  const themes = normalizeStringList(essayProfile.candidate_positioning?.strongest_themes, { max: 3 });
  const edu = educationLine(profile);
  if (themes.length && edu) return `${edu}, with a focus on ${themes.join(', ')}`;
  if (edu) return edu;
  return '';
}

export function buildGroundedCoverLetter({ row = {}, profile = {}, essayProfile = {}, answerBank = {} } = {}) {
  const company = clean(row.company) || 'your organization';
  const title = clean(row.title) || 'this role';
  const candidateName = nameFromProfile(profile);
  const keyAlignment = normalizeStringList(row.key_alignment, { max: 3 });
  const positioning = positioningLine(profile, essayProfile);
  const proofPoints = proofPointSentences(profile, essayProfile, answerBank);
  const openingAngle = clean(essayProfile.cover_letter_defaults?.opening_angle);
  const closingAngle = clean(essayProfile.cover_letter_defaults?.closing_angle);

  const paragraphs = [];
  paragraphs.push('Dear Hiring Team,');
  paragraphs.push([
    `I am applying for the ${title} role at ${company}.`,
    openingAngle || positioning ? `My application is grounded in ${openingAngle || positioning}.` : '',
  ].filter(Boolean).join(' '));

  if (keyAlignment.length) {
    paragraphs.push(`The role appears aligned with my background for these resume- and scoring-backed reasons: ${keyAlignment.map((item) => compact(item, 180)).join('; ')}.`);
  } else {
    paragraphs.push('Without adding company-specific claims beyond the posting metadata, I would focus on bringing careful execution, clear communication, and fast learning to this role.');
  }

  if (proofPoints.length) {
    paragraphs.push(`The proof points I would bring are concrete: ${proofPoints.join(' ')}`);
  }

  if (closingAngle) {
    paragraphs.push(closingAngle);
  } else {
    paragraphs.push(`I would be glad to discuss how my resume-backed experience fits the ${title} role. Thank you for your consideration.`);
  }

  const body = paragraphs.filter(Boolean).join('\n\n');
  return {
    text: candidateName ? `${body}\n\nSincerely,\n${candidateName}` : body,
    company,
    title,
    key_alignment_used: keyAlignment.length > 0,
    sources: COVER_LETTER_ALLOWED_SOURCES,
  };
}

export function reviewGroundedCoverLetter({ draft = '', row = {}, profile = {} } = {}) {
  const issues = [];
  const keyAlignment = normalizeStringList(row.key_alignment, { max: 3 });
  if (!keyAlignment.length && UNSUPPORTED_COMPANY_FACT_RE.test(draft)) {
    issues.push({
      code: 'unsupported_company_fact_without_key_alignment',
      detail: 'Draft contains company-specific language but the row has no key_alignment evidence.',
    });
  }
  if (!profile.education?.gpa && /\bGPA\b/i.test(draft)) {
    issues.push({ code: 'unsupported_gpa_claim', detail: 'Draft mentions GPA but profile.education.gpa is empty.' });
  }
  if (UNSUPPORTED_PERSONAL_FACT_RE.test(draft) && !/\bGPA\b/i.test(draft)) {
    issues.push({
      code: 'sensitive_personal_fact_in_cover_letter',
      detail: 'Draft mentions a sensitive personal fact class that should not be asserted in a cover letter.',
    });
  }
  return { ok: issues.length === 0, issues };
}

function wrapLine(line, width = 88) {
  const words = clean(line).split(/\s+/).filter(Boolean);
  const out = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current.length + 1 + word.length) <= width) {
      current += ` ${word}`;
    } else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [''];
}

function escapePdfText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function renderSimplePdf(text) {
  const sourceLines = String(text || '').split(/\n+/);
  const lines = sourceLines.flatMap((line) => wrapLine(line, 92)).slice(0, 58);
  const commands = [
    'BT',
    '/F1 10 Tf',
    '72 742 Td',
    '13 TL',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T*']),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(commands, 'utf8')} >>\nstream\n${commands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'utf8');
}

function renderHtml({ row = {}, draft = '', review = {} } = {}) {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<title>Grounded Cover Letter</title>',
    '<style>body{font-family:Arial,sans-serif;line-height:1.45;max-width:720px;margin:40px auto;color:#111}pre{white-space:pre-wrap;font-family:inherit}</style>',
    '</head><body>',
    `<h1>${escapeHtml(row.company)} - ${escapeHtml(row.title)}</h1>`,
    '<pre>',
    escapeHtml(draft),
    '</pre>',
    `<p><strong>Truthfulness review:</strong> ${review.ok ? 'passed' : 'failed'}</p>`,
    '</body></html>',
  ].join('\n');
}

function hashObject(value) {
  return createHash('sha256').update(JSON.stringify(value || {})).digest('hex').slice(0, 16);
}

export function appendJsonl(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
}

export function writeCoverLetterArtifact({ row = {}, profile = {}, essayProfile = {}, answerBank = {}, home, now = new Date() } = {}) {
  if (!home) throw new Error('home required');
  const draft = buildGroundedCoverLetter({ row, profile, essayProfile, answerBank });
  const review = reviewGroundedCoverLetter({ draft: draft.text, row, profile });
  if (!review.ok) {
    return { ok: false, reason: 'truthfulness_review_failed', review, draft };
  }

  const materialsDir = join(home, 'materials');
  const coverDir = join(materialsDir, 'cover_letters');
  mkdirSync(coverDir, { recursive: true });
  const ts = now.toISOString();
  const stamp = ts.replace(/[-:.]/g, '').slice(0, 15);
  const base = `${String(row.id || row.row_id || 'row')}-${slugify(row.company)}-${slugify(row.title)}-${stamp}`;
  const htmlPath = join(coverDir, `${base}.html`);
  const pdfPath = join(coverDir, `${base}.pdf`);
  const html = renderHtml({ row, draft: draft.text, review });
  writeFileSync(htmlPath, html);
  writeFileSync(pdfPath, renderSimplePdf(draft.text));
  // Cover letters carry the applicant's real name; born locked (write-side
  // trigger, 设计稿 §13.4 写入侧上锁), not swept later.
  lockFile(htmlPath);
  lockFile(pdfPath);

  const metadata = {
    ts,
    row_id: Number(row.id || row.row_id || 0) || null,
    type: 'cover_letter',
    path: pdfPath,
    html_path: htmlPath,
    profile_version_hash: hashObject({ profile, essayProfile }),
    reviewed: true,
    used_in_submission: false,
    source: 'd1_onboard_auto',
    sources: draft.sources,
    key_alignment_used: draft.key_alignment_used,
    review,
  };
  appendJsonl(join(materialsDir, 'index.jsonl'), metadata);
  appendJsonl(join(home, 'feedback.jsonl'), {
    ts,
    event: 'cover_letter_generated',
    row_id: metadata.row_id,
    path: pdfPath,
    html_path: htmlPath,
    source: metadata.source,
    used_in_submission: false,
  });
  return { ok: true, path: pdfPath, html_path: htmlPath, metadata, draft, review };
}

export function markCoverLetterUsed({ home, rowId, path, resultFile = '', now = new Date() } = {}) {
  if (!home) throw new Error('home required');
  if (!path) return { ok: false, reason: 'path_required' };
  if (!existsSync(path)) return { ok: false, reason: 'path_missing', path };
  const ts = now.toISOString();
  const record = {
    ts,
    row_id: Number(rowId || 0) || null,
    type: 'cover_letter',
    path,
    reviewed: true,
    used_in_submission: true,
    source: 'd1_onboard_auto',
    result_file: resultFile || null,
  };
  appendJsonl(join(home, 'materials/index.jsonl'), record);
  appendJsonl(join(home, 'feedback.jsonl'), {
    ts,
    event: 'cover_letter_used_in_submission',
    row_id: record.row_id,
    path,
    result_file: resultFile || null,
    used_in_submission: true,
  });
  return { ok: true, record };
}

export function readJsonOptional(path, fallback = {}) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}
