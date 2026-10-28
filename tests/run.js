'use strict';
// Test runner for the VPXS YML Builder.
//
// Why this exists: every logic test written for this project before 2026-08-21
// lived in a scratch directory and was deleted with it. Two sessions' worth
// (119 assertions) were lost that way. Tests live here now.
//
// No dependencies, no framework. Each test file is a normal Node script that
// asserts with tests/harness.js (or .mjs) and ends with report(). This runner
// spawns each one in its own process so a crash in one cannot take out the
// rest, then adds up what actually ran.
//
//   node tests/run.js            run everything
//   node tests/run.js picker     run only files matching "picker"

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = __dirname;
const GENERATED = path.join(TESTS, '..', 'fixtures', 'generated', 'pup-zip64.zip');

const filter = process.argv[2] || '';

// Large fixtures are generated rather than committed — see make-fixtures.mjs.
if (!fs.existsSync(GENERATED)) {
  process.stdout.write('generating large fixtures... ');
  const made = spawnSync(process.execPath, [path.join(TESTS, 'make-fixtures.mjs')], {
    encoding: 'utf8'
  });
  if (made.status !== 0) {
    console.log('FAILED');
    console.log(made.stdout || '');
    console.log(made.stderr || '');
    process.exit(1);
  }
  console.log('done');
}

const files = fs.readdirSync(TESTS)
  .filter(f => /\.test\.(js|mjs)$/.test(f))
  .filter(f => !filter || f.includes(filter))
  .sort();

if (!files.length) {
  console.log(filter ? 'no test files match "' + filter + '"' : 'no test files found');
  process.exit(1);
}

let totalPassed = 0;
let totalFailed = 0;
const broken = [];

// The browser tests drive a real Chrome, and a hung browser must not hang CI
// with it. A file that runs past this is killed and reported as errored.
const FILE_TIMEOUT_MS = 180000;

for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(TESTS, file)], {
    encoding: 'utf8',
    cwd: path.join(TESTS, '..'),
    timeout: FILE_TIMEOUT_MS
  });

  const out = (result.stdout || '') + (result.stderr || '');
  const match = out.match(/##RESULT## passed=(\d+) failed=(\d+)/);

  if (!match) {
    // The file never reached report() — it threw, timed out, or it is not using the harness.
    broken.push(file);
    const why = result.error && result.error.code === 'ETIMEDOUT'
      ? 'timed out after ' + (FILE_TIMEOUT_MS / 1000) + ' s'
      : 'did not report; exit ' + result.status;
    console.log('ERROR  ' + file + '  (' + why + ')');
    console.log(out.trim().split('\n').map(l => '       ' + l).join('\n'));
    continue;
  }

  const passed = Number(match[1]);
  const failed = Number(match[2]);
  totalPassed += passed;
  totalFailed += failed;

  const label = failed ? 'FAIL  ' : 'ok    ';
  console.log(label + file.padEnd(32) + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
  if (failed) {
    console.log(out.split('FAILURES in')[1] ? '       ' + out.split('FAILURES in')[1].trim() : '');
  }
}

console.log('');
console.log('files: ' + files.length + '   assertions passed: ' + totalPassed +
            '   failed: ' + totalFailed + (broken.length ? '   errored files: ' + broken.length : ''));

if (totalFailed || broken.length) process.exit(1);
console.log('all green');
