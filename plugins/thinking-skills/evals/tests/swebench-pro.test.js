'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractSourceFiles,
  mapSwebenchProRow,
} = require('../datasets/swebench-pro');

test('extractSourceFiles keeps implementation files and removes tests and docs', () => {
  const patch = [
    'diff --git a/src/auth.js b/src/auth.js',
    'diff --git a/test/auth.test.js b/test/auth.test.js',
    'diff --git a/docs/auth.md b/docs/auth.md',
  ].join('\n');
  assert.deepEqual(extractSourceFiles(patch), ['src/auth.js']);
});

test('mapSwebenchProRow emits bounded implementation-file localization tasks', () => {
  const mapped = mapSwebenchProRow({
    repo: 'org/project',
    instance_id: 'org__project-1',
    problem_statement: 'Authentication retries lose the rotated token.',
    patch: 'diff --git a/src/auth/session.ts b/src/auth/session.ts\n',
  });
  assert.equal(mapped.repo, 'org/project');
  assert.deepEqual(mapped.gold_files, ['src/auth/session.ts']);
  assert.equal(mapped.mode, 'swe-localize');
  assert.match(mapped.prompt, /ANSWER: <path\/to\/file\.ext>/);

  const bounded = mapSwebenchProRow({
    repo: 'org/project',
    instance_id: 'org__project-2',
    problem_statement: 'Two implementation files change.',
    patch: [
      'diff --git a/src/a.ts b/src/a.ts',
      'diff --git a/src/b.ts b/src/b.ts',
    ].join('\n'),
  });
  assert.deepEqual(bounded.gold_files, ['src/a.ts', 'src/b.ts']);

  const tooBroad = mapSwebenchProRow({
    repo: 'org/project',
    instance_id: 'org__project-3',
    problem_statement: 'Many implementation files change.',
    patch: Array.from(
      { length: 4 },
      (_, i) => `diff --git a/src/${i}.ts b/src/${i}.ts`,
    ).join('\n'),
  });
  assert.equal(tooBroad, null);
});
