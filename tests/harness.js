'use strict';
// Shared assertion harness (CommonJS). The .mjs twin is harness.mjs — keep the
// two in step; they exist only because this repo has both module flavours.
//
// Every test file ends with report(). It prints a machine-readable line that
// tests/run.js parses, so the aggregate count is derived from what actually
// ran rather than from a number written down by hand.

const path = require('path');

const REPO = path.resolve(__dirname, '..');

let passed = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) { passed += 1; return true; }
  failures.push(name + (extra ? '\n        ' + extra : ''));
  return false;
}

function report(label) {
  console.log('##RESULT## passed=' + passed + ' failed=' + failures.length);
  if (failures.length) {
    console.log('FAILURES in ' + label + ':');
    failures.forEach(f => console.log('  x ' + f));
    process.exit(1);
  }
  console.log('ok - ' + label + ' (' + passed + ' assertions)');
}

// Resolve a path inside the repo, so no test carries an absolute path.
const repoPath = (...parts) => path.join(REPO, ...parts);

module.exports = { check, report, repoPath, REPO };
