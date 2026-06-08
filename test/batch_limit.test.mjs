import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMaxRows, limitRows, resolveMaxRows } from '../shared/batch_limit.mjs';

test('resolveMaxRows defaults to uncapped when no env or --max is present', () => {
  assert.equal(resolveMaxRows({ argv: ['node', 'script'], env: {} }), null);
  assert.equal(formatMaxRows(null), 'all');
});

test('resolveMaxRows honors explicit caps and all/unlimited sentinels', () => {
  assert.equal(resolveMaxRows({ argv: ['node', 'script', '--max', '25'], env: {} }), 25);
  assert.equal(resolveMaxRows({ argv: ['node', 'script'], env: { MRWEIRDO_MAX_AUTO_APPLY: '7' } }), 7);
  assert.equal(resolveMaxRows({ argv: ['node', 'script', '--max', 'all'], env: { MRWEIRDO_MAX_AUTO_APPLY: '7' } }), null);
  assert.equal(resolveMaxRows({ argv: ['node', 'script'], env: { MRWEIRDO_MAX_AUTO_APPLY: '0' } }), null);
});

test('limitRows only slices when a positive cap exists', () => {
  assert.deepEqual(limitRows([1, 2, 3], null), [1, 2, 3]);
  assert.deepEqual(limitRows([1, 2, 3], 2), [1, 2]);
});
