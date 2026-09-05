'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyDescriptionOverride,
  scoreRoutingBoundary,
} = require('../lib/routing-boundary');

test('applyDescriptionOverride changes only the targeted catalog entry', () => {
  const catalog = [
    { name: 'thinking-scientific-method', description: 'old' },
    { name: 'thinking-five-whys-plus', description: 'keep' },
  ];
  assert.deepEqual(
    applyDescriptionOverride(catalog, 'thinking-scientific-method', 'new'),
    [
      { name: 'thinking-scientific-method', description: 'new' },
      { name: 'thinking-five-whys-plus', description: 'keep' },
    ],
  );
  assert.equal(catalog[0].description, 'old');
});

test('scoreRoutingBoundary reports strict accuracy and five-whys preservation', () => {
  const results = [
    { case_id: 's1', arm_id: 'current', expected: 'thinking-scientific-method', chosen: 'thinking-five-whys-plus' },
    { case_id: 'f1', arm_id: 'current', expected: 'thinking-five-whys-plus', chosen: 'thinking-five-whys-plus' },
    { case_id: 's1', arm_id: 'boundary', expected: 'thinking-scientific-method', chosen: 'thinking-scientific-method' },
    { case_id: 'f1', arm_id: 'boundary', expected: 'thinking-five-whys-plus', chosen: 'thinking-five-whys-plus' },
  ];
  const score = scoreRoutingBoundary(results);
  assert.equal(score.by_arm.current.strict_accuracy, 0.5);
  assert.equal(score.by_arm.boundary.strict_accuracy, 1);
  assert.equal(score.by_arm.boundary.five_whys_accuracy, 1);
  assert.equal(score.boundary_pass, true);
});
