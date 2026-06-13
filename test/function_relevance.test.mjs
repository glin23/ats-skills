import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessFunctionRelevance,
  functionRelevanceBlockReason,
  FUNCTION_RELEVANCE_TOO_DISTANT_REASON,
} from '../shared/function_relevance.mjs';

const opsPmIntent = {
  search_intent: {
    function_area: ['Operations', 'Product Management'],
    role_categories: [
      { title_pattern: 'Product Management Intern', priority: 'high' },
      { title_pattern: 'Business Operations Intern', priority: 'high' },
      { title_pattern: 'Strategy Intern', priority: 'medium' },
    ],
    target_function_anchor: {
      self_reported_target_functions: ['Operations', 'Product Management'],
      adjacent_functions: ['BizOps', 'Strategy', 'APM', 'Program Management'],
      excluded_functions: ['Software Engineering', 'Nursing', 'Design', 'Data'],
    },
  },
};

const sweIntent = {
  search_intent: {
    function_area: ['Software Engineering'],
    role_categories: [
      { title_pattern: 'Software Engineering Intern', priority: 'high' },
      { title_pattern: 'Backend Engineer Intern', priority: 'medium' },
      { title_pattern: 'QA Intern', priority: 'low' },
    ],
    target_function_anchor: {
      self_reported_target_functions: ['Software Engineering'],
      adjacent_functions: ['Backend', 'Frontend', 'Full-Stack', 'Platform', 'DevOps', 'QA', 'Mobile'],
      excluded_functions: ['Marketing', 'Accounting', 'Nursing', 'Design', 'Consulting'],
    },
  },
};

function statusFor(title, intent) {
  return assessFunctionRelevance({ title }, intent).status;
}

test('Ops/PM anchor allows direct and adjacent functions but blocks distant high-confidence families', () => {
  assert.notEqual(statusFor('Business Operations Intern', opsPmIntent), 'too_distant');
  assert.notEqual(statusFor('Program Management Intern', opsPmIntent), 'too_distant');
  assert.equal(statusFor('Software Engineering Intern', opsPmIntent), 'too_distant');
  assert.equal(statusFor('Nursing Intern', opsPmIntent), 'too_distant');
  assert.equal(statusFor('UX Design Intern', opsPmIntent), 'too_distant');
  assert.equal(statusFor('Data Analyst Intern', opsPmIntent), 'too_distant');
});

test('SWE anchor allows technical adjacent roles but blocks distant high-confidence families', () => {
  assert.notEqual(statusFor('Backend Engineer Intern', sweIntent), 'too_distant');
  assert.notEqual(statusFor('QA Intern', sweIntent), 'too_distant');
  assert.equal(statusFor('Marketing Intern', sweIntent), 'too_distant');
  assert.equal(statusFor('Accounting Intern', sweIntent), 'too_distant');
  assert.equal(statusFor('Nursing Intern', sweIntent), 'too_distant');
  assert.equal(statusFor('Product Designer Intern', sweIntent), 'too_distant');
  assert.equal(statusFor('Management Consulting Intern', sweIntent), 'too_distant');
});

test('unknown long-tail anchors soft-pass instead of being hard-killed', () => {
  const nursingIntent = {
    search_intent: {
      function_area: ['Nursing'],
      role_categories: [{ title_pattern: 'Nursing Intern', priority: 'high' }],
      target_function_anchor: {
        self_reported_target_functions: ['Nursing'],
        adjacent_functions: ['Clinical Care'],
      },
    },
  };
  const result = assessFunctionRelevance({ title: 'Software Engineering Intern' }, nursingIntent);
  assert.equal(result.status, 'unknown');
  assert.equal(functionRelevanceBlockReason({ title: 'Software Engineering Intern' }, nursingIntent), null);
});

test('ambiguous titles stay unknown, never too_distant', () => {
  for (const title of ['Business Analyst Intern', 'Product Analyst Intern', 'Operations Engineer Intern']) {
    const result = assessFunctionRelevance({ title }, opsPmIntent);
    assert.equal(result.status, 'unknown', title);
    assert.equal(functionRelevanceBlockReason({ title }, opsPmIntent), null, title);
  }
});

test('multiple target anchors take the union and allow either direction', () => {
  const pmAndDataIntent = {
    search_intent: {
      function_area: ['Product Management', 'Data'],
      target_function_anchor: {
        self_reported_target_functions: ['Product Management', 'Data'],
        adjacent_functions: ['APM', 'Analytics'],
        excluded_functions: ['Nursing', 'Design'],
      },
      role_categories: [
        { title_pattern: 'Product Management Intern', priority: 'high' },
        { title_pattern: 'Data Analyst Intern', priority: 'high' },
      ],
    },
  };
  assert.notEqual(statusFor('Product Management Intern', pmAndDataIntent), 'too_distant');
  assert.notEqual(statusFor('Data Analyst Intern', pmAndDataIntent), 'too_distant');
  assert.equal(functionRelevanceBlockReason({ title: 'Nursing Intern' }, pmAndDataIntent), FUNCTION_RELEVANCE_TOO_DISTANT_REASON);
});
