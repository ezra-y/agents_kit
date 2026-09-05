'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { writeJson } = require('../lib/io.js');

test('writeJson API is (file, obj) — path.join for filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vj-'));
  const file = path.join(dir, 'judge-reliability-test.json');
  writeJson(file, { agreement: { percent: 1 }, n: 0 });
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(loaded.agreement.percent, 1);
  assert.strictEqual(loaded.n, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('validate-judge module still exports agreement and biasDetection', () => {
  const vj = require('../validate-judge.js');
  assert.strictEqual(typeof vj.agreement, 'function');
  assert.strictEqual(typeof vj.biasDetection, 'function');
});
