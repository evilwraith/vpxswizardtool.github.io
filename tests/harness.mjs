// Shared assertion harness (ESM). CommonJS twin is harness.js — keep in step.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');

let passed = 0;
const failures = [];

export function check(name, condition, extra) {
  if (condition) { passed += 1; return true; }
  failures.push(name + (extra ? '\n        ' + extra : ''));
  return false;
}

export function report(label) {
  console.log('##RESULT## passed=' + passed + ' failed=' + failures.length);
  if (failures.length) {
    console.log('FAILURES in ' + label + ':');
    failures.forEach(f => console.log('  x ' + f));
    process.exit(1);
  }
  console.log('ok - ' + label + ' (' + passed + ' assertions)');
}

export const repoPath = (...parts) => path.join(REPO, ...parts);
