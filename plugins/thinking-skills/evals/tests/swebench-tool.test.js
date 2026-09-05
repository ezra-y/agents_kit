'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mapSwebenchVerifiedToolRow } = require('../datasets/swebench-tool');

test('mapSwebenchVerifiedToolRow preserves checkout metadata for one implementation owner', () => {
  const mapped = mapSwebenchVerifiedToolRow({
    instance_id: 'org__repo-123',
    repo: 'org/repo',
    base_commit: 'abc123',
    problem_statement: 'A deeply nested behavior is wrong.',
    patch: [
      'diff --git a/pkg/core/owner.py b/pkg/core/owner.py',
      'diff --git a/tests/test_owner.py b/tests/test_owner.py',
    ].join('\n'),
  });
  assert.equal(mapped.base_commit, 'abc123');
  assert.deepEqual(mapped.gold_files, ['pkg/core/owner.py']);
  assert.equal(mapped.license, 'MIT');
  assert.equal(mapped.mode, 'swe-tool-localize');
});

test('mapSwebenchVerifiedToolRow rejects multi-owner and shallow-owner tasks', () => {
  assert.equal(mapSwebenchVerifiedToolRow({
    instance_id: 'multi',
    repo: 'org/repo',
    base_commit: 'abc123',
    problem_statement: 'Issue',
    patch: [
      'diff --git a/pkg/a.py b/pkg/a.py',
      'diff --git a/pkg/b.py b/pkg/b.py',
    ].join('\n'),
  }), null);
  assert.equal(mapSwebenchVerifiedToolRow({
    instance_id: 'shallow',
    repo: 'org/repo',
    base_commit: 'abc123',
    problem_statement: 'Issue',
    patch: 'diff --git a/owner.py b/owner.py',
  }), null);
});
