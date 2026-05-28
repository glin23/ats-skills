#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.env.MRWEIRDO_REPO_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.MRWEIRDO_HOME || path.join(homedir(), '.mrweirdo-jobs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function runNode(args, env = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function rowList(rows = []) {
  return rows.map((row) => `<li>#${escapeHtml(row.id)} ${escapeHtml(row.company)} — ${escapeHtml(row.title)} <span>fit ${escapeHtml(row.fit_score)} · ${escapeHtml(row.ats_platform)}</span></li>`).join('\n');
}

const target = Math.max(1, Number(argValue('--target', process.env.MRWEIRDO_TARGET_APPLICATIONS || '100')));
const outputArg = argValue('--output');
const roleTargets = argValue('--role-targets') || process.env.MRWEIRDO_ROLE_TYPE_TARGETS || '';

const diagnosticsRun = runNode(['shared/queue_diagnostics.mjs', '--json'], {
  MRWEIRDO_MAX_AUTO_APPLY: String(target),
  ...(roleTargets ? { MRWEIRDO_ROLE_TYPE_TARGETS: roleTargets } : {}),
});
if (diagnosticsRun.code !== 0) {
  process.stderr.write(diagnosticsRun.stderr || diagnosticsRun.stdout);
  process.exit(diagnosticsRun.code);
}

const diagnostics = JSON.parse(diagnosticsRun.stdout);
const readyNow = diagnostics.eligible || 0;
const rescore = diagnostics.near_misses?.rescore_candidates_fit_one_below || { count: 0, examples: [] };
const platform = diagnostics.near_misses?.platform_expansion_candidates || { count: 0, examples: [], by_platform: {} };
const afterRescore = readyNow + (rescore.count || 0);
const afterPlatform = afterRescore + (platform.count || 0);
const stillNeededAfterReview = Math.max(0, target - afterRescore);
const stillNeededAfterAllKnown = Math.max(0, target - afterPlatform);

const plan = {
  generated_at: new Date().toISOString(),
  target_applications: target,
  min_fit: diagnostics.min_fit,
  role_targets: diagnostics.allowed_role_types,
  ready_now: readyNow,
  shortfall_now: Math.max(0, target - readyNow),
  expansion: {
    human_rescore_fit_one_below: {
      count: rescore.count || 0,
      projected_ready_if_all_accepted: afterRescore,
      remaining_after_all_accepted: stillNeededAfterReview,
      examples: rescore.examples || [],
    },
    unsupported_ats_fit_above_threshold: {
      count: platform.count || 0,
      by_platform: platform.by_platform || {},
      projected_ready_if_supported: afterPlatform,
      remaining_after_supported: stillNeededAfterAllKnown,
      examples: platform.examples || [],
    },
    additional_sourcing_needed_after_known_pool: stillNeededAfterAllKnown,
  },
  recommended_sequence: [
    'Run a small real batch first and inspect the submitted/skip report before scaling.',
    'Apply the ready-now pool only after the real batch succeeds cleanly.',
    `Manually review the ${rescore.count || 0} fit-${(diagnostics.min_fit || 5) - 1} candidates before raising any scores to ${diagnostics.min_fit}.`,
    'Do not enable unsupported ATS platforms for auto-submit until their drivers pass dogfood tests.',
    stillNeededAfterAllKnown > 0
      ? `Discover and score at least ${stillNeededAfterAllKnown} additional supported-ATS target-role rows to reach ${target}.`
      : `The known pool can theoretically reach ${target} after review/platform expansion, but only ready-now rows should auto-submit unattended.`,
  ],
  diagnostics,
};

if (hasArg('--json') && !outputArg) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const reportsDir = path.join(home, 'reports');
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const outputPath = outputArg || path.join(reportsDir, `capacity-plan-${stamp}.html`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mr. Weirdo Jobs Capacity Plan</title>
  <style>
    :root { color-scheme: light; --border:#d8dee8; --text:#172033; --muted:#5b6678; --bg:#f7f9fc; --card:#ffffff; --accent:#1358a8; }
    body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: var(--bg); }
    body > header { padding: 28px 32px 18px; background: var(--card); border-bottom: 1px solid var(--border); }
    h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: 0; }
    .meta, p, li span { color: var(--muted); }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 12px; padding: 18px 32px; }
    .metric { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }
    .metric strong { display: block; font-size: 24px; }
    main { padding: 0 32px 32px; display: grid; gap: 18px; }
    section { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    h2 { margin: 0 0 8px; font-size: 18px; letter-spacing: 0; }
    ol, ul { margin: 8px 0 0; padding-left: 22px; }
    li { margin: 4px 0; }
    code { background: #eef2f7; border-radius: 4px; padding: 1px 4px; }
    @media (max-width: 900px) {
      body > header, main { padding-left: 16px; padding-right: 16px; }
      .summary { grid-template-columns: 1fr 1fr; padding: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Mr. Weirdo Jobs Capacity Plan</h1>
    <div class="meta">Generated ${escapeHtml(new Date(plan.generated_at).toLocaleString())} · Target ${escapeHtml(target)} · Role targets ${escapeHtml(plan.role_targets.join(', '))}</div>
  </header>
  <div class="summary">
    <div class="metric"><strong>${escapeHtml(target)}</strong><span>Target</span></div>
    <div class="metric"><strong>${escapeHtml(readyNow)}</strong><span>Ready now</span></div>
    <div class="metric"><strong>${escapeHtml(rescore.count || 0)}</strong><span>Fit-${escapeHtml((diagnostics.min_fit || 5) - 1)} review</span></div>
    <div class="metric"><strong>${escapeHtml(stillNeededAfterAllKnown)}</strong><span>Still needs sourcing</span></div>
  </div>
  <main>
    <section>
      <h2>Recommended Sequence</h2>
      <ol>${plan.recommended_sequence.map((step) => `<li>${escapeHtml(step)}</li>`).join('\n')}</ol>
    </section>
    <section>
      <h2>Human Re-score Candidates</h2>
      <p>If every fit-${escapeHtml((diagnostics.min_fit || 5) - 1)} candidate were accepted, the ready pool would become ${escapeHtml(afterRescore)} and still need ${escapeHtml(stillNeededAfterReview)} more rows for the target.</p>
      <ul>${rowList(rescore.examples) || '<li>No examples.</li>'}</ul>
    </section>
    <section>
      <h2>Unsupported ATS Candidates</h2>
      <p>Count by platform: <code>${escapeHtml(JSON.stringify(platform.by_platform || {}))}</code>. These should not auto-submit until the driver is proven.</p>
      <ul>${rowList(platform.examples) || '<li>No examples.</li>'}</ul>
    </section>
  </main>
</body>
</html>
`;

fs.writeFileSync(outputPath, html);
if (hasArg('--json')) console.log(JSON.stringify(plan, null, 2));
console.log(outputPath);
