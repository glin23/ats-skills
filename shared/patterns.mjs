// shared/patterns.mjs
// Analyzes ~/.ats-skills/feedback.jsonl for systematic biases and suggests
// profile.json updates. Inspired by Career-Ops patterns skill.
// Node 24 ESM, zero-dep.
//
// Does NOT modify profile.json — only returns suggestions for user to confirm.

import { readFileSync, existsSync } from 'node:fs';
import { loadRecent } from './feedback.mjs';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'as', 'it',
  'this', 'that', 'these', 'those', 'i', 'you', 'we', 'they', 'he', 'she',
  'my', 'your', 'our', 'their', 'his', 'her',
  'not', 'no', 'but', 'so', 'too', 'also', 'just', 'only', 'than', 'then',
  'role', 'roles', 'job', 'jobs', 'position', 'positions', 'wants', 'wanted',
  'need', 'needs', 'needed', 'looking', 'want', 'really', 'very', 'much',
  'lee', 'user', 'me', 'us', 'them',
]);

const MIN_PATTERN_COUNT = 3; // need at least 3 occurrences to call it a pattern

/**
 * Detect recurring patterns in feedback entries.
 * @param {Array<Object>} entries
 * @returns {Array<{pattern: string, suggestion: string, confidence: number, evidence: Array}>}
 */
export function analyzePatterns(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const patterns = [];

  // --- Pattern 1: Recurring skip_reason ---
  const reasonCounts = new Map();
  const reasonExamples = new Map();
  for (const e of entries) {
    if (!e.skip_reason) continue;
    reasonCounts.set(e.skip_reason, (reasonCounts.get(e.skip_reason) || 0) + 1);
    if (!reasonExamples.has(e.skip_reason)) reasonExamples.set(e.skip_reason, []);
    reasonExamples.get(e.skip_reason).push(e.company || 'unknown');
  }
  for (const [reason, count] of reasonCounts.entries()) {
    if (count < MIN_PATTERN_COUNT) continue;
    const confidence = Math.min(0.95, 0.5 + count * 0.1);
    patterns.push({
      pattern: `Recurring skip_reason "${reason}" (${count} occurrences)`,
      suggestion: suggestionForReason(reason, count),
      confidence: Number(confidence.toFixed(2)),
      evidence: reasonExamples.get(reason).slice(0, 5),
    });
  }

  // --- Pattern 2: Recurring keywords in user_note ---
  const keywordCounts = new Map();
  const keywordExamples = new Map();
  for (const e of entries) {
    if (!e.user_note) continue;
    const tokens = extractCandidatePhrases(e.user_note);
    for (const tok of tokens) {
      keywordCounts.set(tok, (keywordCounts.get(tok) || 0) + 1);
      if (!keywordExamples.has(tok)) keywordExamples.set(tok, []);
      keywordExamples.get(tok).push(e.company || 'unknown');
    }
  }
  for (const [kw, count] of keywordCounts.entries()) {
    if (count < MIN_PATTERN_COUNT) continue;
    const confidence = Math.min(0.9, 0.45 + count * 0.1);
    patterns.push({
      pattern: `Recurring keyword "${kw}" in user_note (${count} occurrences)`,
      suggestion: `Consider adding "${kw}" to target_filters.exclude_keywords`,
      confidence: Number(confidence.toFixed(2)),
      evidence: keywordExamples.get(kw).slice(0, 5),
    });
  }

  // --- Pattern 3: ATS clusters (if present) ---
  const atsCounts = new Map();
  for (const e of entries) {
    if (!e.ats) continue;
    atsCounts.set(e.ats, (atsCounts.get(e.ats) || 0) + 1);
  }
  for (const [ats, count] of atsCounts.entries()) {
    if (count < MIN_PATTERN_COUNT * 2) continue; // higher bar for ATS-level pattern
    patterns.push({
      pattern: `${count} skips concentrated on ATS "${ats}"`,
      suggestion: `Review ats-skills sourcing for "${ats}" — may be surfacing low-fit roles`,
      confidence: 0.6,
      evidence: [`${count} skips`],
    });
  }

  // Sort by confidence desc
  patterns.sort((a, b) => b.confidence - a.confidence);
  return patterns;
}

function suggestionForReason(reason, count) {
  const r = reason.toLowerCase();
  if (r.includes('role') || r.includes('seniority')) {
    return `Tighten target_filters.role_types — "${reason}" hit ${count}x; consider removing role types that don't match`;
  }
  if (r.includes('location') || r.includes('remote')) {
    return `Tighten target_filters.locations — "${reason}" hit ${count}x`;
  }
  if (r.includes('visa') || r.includes('sponsor')) {
    return `Set target_filters.visa_must_sponsor: true — "${reason}" hit ${count}x`;
  }
  if (r.includes('swe') || r.includes('engineer')) {
    return `Add engineering keywords to target_filters.exclude_keywords — "${reason}" hit ${count}x`;
  }
  return `Raise target_filters.min_fit_score or refine filters — "${reason}" hit ${count}x`;
}

function extractCandidatePhrases(text) {
  // Extract 1-3-word phrases, normalize case, drop stopwords.
  // Focus on capitalized phrases and known job-role terms.
  const phrases = new Set();
  const cleaned = String(text).replace(/[^A-Za-z0-9\s\-+/]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);

  // 2-3 grams
  for (let n = 3; n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const gram = words.slice(i, i + n).join(' ');
      if (looksLikeJobTerm(gram)) {
        phrases.add(normalizePhrase(gram));
      }
    }
  }
  // 1-grams: only allow if clearly a job role token (e.g. "SWE", "SDR")
  for (const w of words) {
    if (/^[A-Z]{2,5}$/.test(w) && !STOPWORDS.has(w.toLowerCase())) {
      phrases.add(w);
    }
  }
  return [...phrases];
}

function looksLikeJobTerm(gram) {
  const tokens = gram.split(' ');
  if (tokens.every((t) => STOPWORDS.has(t.toLowerCase()))) return false;
  // Require at least one capitalized token or known job suffix
  const hasCapital = tokens.some((t) => /^[A-Z]/.test(t));
  const hasJobSuffix = /\b(engineer|manager|analyst|designer|developer|recruiter|associate|intern|specialist|lead|architect|consultant|representative|rep)\b/i.test(gram);
  return hasCapital || hasJobSuffix;
}

function normalizePhrase(p) {
  return p
    .split(' ')
    .map((t) => (t.length <= 4 && t === t.toUpperCase() ? t : t[0].toUpperCase() + t.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Read recent feedback, run analyzePatterns, return suggestions.
 * Does NOT modify profile.json.
 * @param {string} [profilePath] - path to profile.json (currently unused; reserved for future cross-checks)
 * @returns {Promise<Array>}
 */
export async function suggestProfileUpdates(profilePath) {
  const entries = await loadRecent(100);
  const patterns = analyzePatterns(entries);
  // If profilePath provided and exists, we could cross-reference current filters
  // to avoid suggesting already-applied changes. For now, return raw patterns.
  if (profilePath && existsSync(profilePath)) {
    try {
      const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
      const existingExcludes = new Set(
        (profile.target_filters?.exclude_keywords || []).map((s) => s.toLowerCase())
      );
      return patterns.filter((p) => {
        // Drop suggestions that recommend adding a keyword already in exclude_keywords
        const m = p.suggestion.match(/"([^"]+)" to target_filters\.exclude_keywords/i);
        if (m && existingExcludes.has(m[1].toLowerCase())) return false;
        return true;
      });
    } catch {
      return patterns;
    }
  }
  return patterns;
}

// Optional CLI: node patterns.mjs [--analyze]
if (import.meta.url.endsWith(process.argv[1])) {
  const entries = await loadRecent(50);
  const patterns = analyzePatterns(entries);
  console.log(JSON.stringify(patterns, null, 2));
}
