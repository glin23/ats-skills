// resume_parser.mjs — extract structured profile fields from a PDF resume
// using Anthropic native PDF support. Output matches shared/profile.template.json.
//
// Usage: node shared/onboarding/resume_parser.mjs <resume.pdf>
//        → prints JSON {personal, education, work_authorization, ...} to stdout

import { readFile } from 'node:fs/promises';
import { loadEnv } from '../paths.mjs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-5-20250929';

const PARSE_PROMPT = `You are extracting structured profile fields from a resume PDF for use in job application auto-fill.

Output a JSON object with this exact schema (use null for any field not on the resume — do not guess):

{
  "personal": {
    "first_name": string,
    "last_name": string,
    "preferred_name": string|null,
    "email": string,
    "phone": string,
    "phone_country": string|null,
    "linkedin": string|null,
    "github": string|null,
    "website": string|null,
    "address": {
      "city": string|null,
      "state": string|null,
      "country": string|null,
      "zip": string|null
    }
  },
  "education": {
    "school": string,
    "degree": string,
    "major": string,
    "minor": string|null,
    "graduation_date": string,
    "gpa": string|null,
    "honors": string|null
  },
  "work_authorization": {
    "status": "citizen"|"permanent_resident"|"f1_opt"|"f1_cpt"|"h1b"|"other"|null,
    "needs_sponsor": boolean|null,
    "sponsor_when": string|null
  },
  "demographics": {
    "gender": string|null,
    "race": string|null,
    "veteran": boolean|null,
    "disability": boolean|null
  },
  "experience_summary": [
    { "company": string, "title": string, "dates": string, "key_skills": [string] }
  ],
  "skills": [string],
  "languages": [string]
}

Rules:
- Output ONLY the JSON. No prose, no markdown fence.
- For phone_country, use the +XX prefix if visible, else null.
- For graduation_date, use the format "May 2027" or "2026-05" as it appears on the resume.
- For work_authorization, infer ONLY if explicit (e.g., "F-1 visa" / "US Citizen" written on resume). Otherwise null.
- For demographics, only fill if EXPLICITLY on the resume; default to null.
- experience_summary: include up to 5 most recent roles with 3-5 key_skills each.
- skills: top 15 hard skills (programming languages, tools, frameworks).
`;

export async function parseResumePdf(pdfPath) {
  loadEnv();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in env or ~/.ats-skills/.env');

  const pdfBytes = await readFile(pdfPath);
  const pdfBase64 = pdfBytes.toString('base64');

  const body = {
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          { type: 'text', text: PARSE_PROMPT },
        ],
      },
    ],
  };

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  }

  const text = payload?.content?.[0]?.text || '';
  return extractJson(text);
}

function extractJson(text) {
  let cleaned = text.trim();
  const fence = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) cleaned = fence[1].trim();
  if (!cleaned.startsWith('{')) {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  }
  return JSON.parse(cleaned);
}

// ---------- CLI ----------
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node shared/onboarding/resume_parser.mjs <resume.pdf>');
    process.exit(1);
  }
  try {
    const profile = await parseResumePdf(pdfPath);
    console.log(JSON.stringify(profile, null, 2));
  } catch (e) {
    console.error('Resume parse failed:', e.message);
    process.exit(1);
  }
}
