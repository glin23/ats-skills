// notion_setup.mjs — create the ats-skills Notion DB + schema for a new user.
// Views are NOT created here (Notion REST does not publicly support view create);
// SKILL.md guides Claude to use the mcp__notion__notion-create-view MCP tool after.
//
// Usage:
//   node shared/onboarding/notion_setup.mjs <parent_page_id>
//     → creates "📋 岗位追踪" DB under parent page
//     → prints {db_id, data_source_id, properties: {...}} to stdout
//
//   node shared/onboarding/notion_setup.mjs ping
//     → just check NOTION_API_KEY works

import { loadEnv } from '../paths.mjs';

loadEnv();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_VERSION = '2022-06-28';
const API_BASE = 'https://api.notion.com/v1';

async function notionFetch(method, path, body) {
  if (!NOTION_API_KEY) throw new Error('NOTION_API_KEY not set in env or ~/.mrweirdo-jobs/.env');
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(`Notion ${method} /${path} ${res.status}: ${JSON.stringify(payload).slice(0, 400)}`);
  }
  return payload;
}

// Schema mirrors HANDOFF.md §9. Matches notion_sync.mjs upsert payload exactly.
function buildSchema() {
  return {
    '公司': { title: {} },
    '职位': { rich_text: {} },
    'Apply URL': { url: {} },
    '地点': { rich_text: {} },
    '来源': { rich_text: {} },
    '状态': {
      select: {
        options: [
          { name: '🤖 AI sourced', color: 'purple' },
          { name: '✅ Approved', color: 'green' },
          { name: '🔵 未投', color: 'blue' },
          { name: '⚠️ 跳过未投', color: 'yellow' },
          { name: '✅ 已投', color: 'green' },
          { name: '✅ 已确认', color: 'green' },
          { name: '🔥 面试中', color: 'red' },
          { name: '❌ Rejected', color: 'gray' },
        ],
      },
    },
    // v0.3 AI scorer fields
    fit_score: { number: { format: 'number' } },
    key_gaps: { rich_text: {} },
    role_type_match: {
      select: {
        options: [
          { name: 'intern', color: 'blue' },
          { name: 'new_grad_FT', color: 'green' },
          { name: 'other', color: 'gray' },
        ],
      },
    },
    skip_reason: {
      select: {
        options: [
          { name: 'Wrong Role', color: 'red' },
          { name: 'Wrong Location', color: 'red' },
          { name: 'No Sponsor', color: 'red' },
          { name: 'Salary', color: 'yellow' },
          { name: 'Other', color: 'gray' },
        ],
      },
    },
    user_note: { rich_text: {} },
    dim_scores: { rich_text: {} },
    // v0.8 salary fields
    salary_min: { number: { format: 'number' } },
    salary_max: { number: { format: 'number' } },
    salary_currency: {
      select: {
        options: [
          { name: 'USD', color: 'green' },
          { name: 'EUR', color: 'blue' },
          { name: 'GBP', color: 'purple' },
          { name: 'CAD', color: 'red' },
          { name: 'AUD', color: 'orange' },
          { name: 'SGD', color: 'pink' },
          { name: 'INR', color: 'yellow' },
          { name: 'CNY', color: 'red' },
          { name: 'Other', color: 'gray' },
        ],
      },
    },
    salary_interval: {
      select: {
        options: [
          { name: 'hour', color: 'gray' },
          { name: 'year', color: 'green' },
          { name: 'month', color: 'blue' },
          { name: 'week', color: 'yellow' },
        ],
      },
    },
    hourly_rate: { number: { format: 'number' } },
    'ats 平台': {
      select: {
        options: [
          { name: 'greenhouse', color: 'green' },
          { name: 'ashby', color: 'purple' },
          { name: 'lever', color: 'red' },
          { name: 'smartrecruiters', color: 'blue' },
          { name: 'icims', color: 'yellow' },
          { name: 'jobvite', color: 'orange' },
          { name: 'handshake', color: 'pink' },
          { name: 'workday', color: 'gray' },
          { name: 'recruitee', color: 'brown' },
          { name: 'personio', color: 'default' },
          { name: 'bamboohr', color: 'green' },
          { name: 'rippling', color: 'blue' },
          { name: 'other', color: 'gray' },
        ],
      },
    },
    // v0.9 quota fields
    apply_quota_limit: { number: { format: 'number' } },
    apply_quota_period: {
      select: {
        options: [
          { name: 'semester', color: 'red' },
          { name: 'year', color: 'orange' },
          { name: 'lifetime', color: 'purple' },
        ],
      },
    },
    apply_quota_note: { rich_text: {} },
    // v1.0 confirmation loop fields
    submitted_at: { date: {} },
    confirmed_at: { date: {} },
    confirmation_email_id: { rich_text: {} },
  };
}

export async function createJobTrackingDb(parentPageId) {
  const payload = {
    parent: { type: 'page_id', page_id: parentPageId },
    icon: { type: 'emoji', emoji: '📋' },
    title: [{ type: 'text', text: { content: '岗位追踪' } }],
    properties: buildSchema(),
  };
  const db = await notionFetch('POST', 'databases', payload);
  return {
    db_id: db.id,
    data_source_id: db.data_sources?.[0]?.id || null,
    title: db.title?.[0]?.plain_text || '岗位追踪',
    parent_page_id: parentPageId,
    properties: Object.keys(db.properties || {}),
  };
}

export async function ping() {
  // Best effort: list users requires no DB. Returns the integration's bot user.
  const me = await notionFetch('GET', 'users/me');
  return { ok: true, integration: me?.name || me?.bot?.owner?.user?.name || '(unknown)', id: me?.id };
}

// ---------- CLI ----------
const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'ping') {
      console.log(JSON.stringify(await ping(), null, 2));
    } else if (cmd && cmd.length >= 32) {
      // Treat as parent page id
      const result = await createJobTrackingDb(cmd);
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error('Usage:');
      console.error('  node shared/onboarding/notion_setup.mjs ping');
      console.error('  node shared/onboarding/notion_setup.mjs <parent_page_id>');
      process.exit(1);
    }
  } catch (e) {
    console.error('notion_setup failed:', e.message);
    process.exit(1);
  }
}
