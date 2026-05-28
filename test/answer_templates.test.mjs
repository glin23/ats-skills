import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAnswerTemplate } from '../shared/answer_templates.mjs';

test('renderAnswerTemplate fills known tokens and blanks unknown ones', () => {
  const out = renderAnswerTemplate('Hi {{COMPANY_PRETTY}}, I study {{MAJOR}} at {{SCHOOL}}. {{NONEXISTENT}}', {
    profile: { education: { major: 'Business', school: 'Babson College' } },
    companyPretty: 'Acme',
  });
  assert.equal(out, 'Hi Acme, I study Business at Babson College.');
});

test('WORK_AUTH_SUMMARY reflects F-1 future-sponsorship honestly', () => {
  const out = renderAnswerTemplate('{{WORK_AUTH_SUMMARY}}', {
    profile: { work_authorization: { visa_status: 'F-1 OPT eligible', requires_sponsorship_future: true } },
  });
  assert.match(out, /F-1 OPT eligible/);
  assert.match(out, /may require future sponsorship/);
});

test('renderAnswerTemplate tolerates empty/no-token input', () => {
  assert.equal(renderAnswerTemplate('', {}), '');
  assert.equal(renderAnswerTemplate('no tokens here', {}), 'no tokens here');
});
