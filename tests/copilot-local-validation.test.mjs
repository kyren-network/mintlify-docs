import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

const node = process.execPath;

function runScript(script, args = []) {
  return execFileSync(node, [script, ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('Copilot source validator reports indexed sources and language coverage', () => {
  const output = runScript('scripts/validate-copilot-sources.mjs');

  assert.match(output, /Copilot source validation passed/);
  assert.match(output, /en: 7 Copilot pages/);
  assert.match(output, /zh: 7 Copilot pages/);
  assert.match(output, /zh-Hant: 7 Copilot pages/);
  assert.match(output, /Indexed source files:/);
});

test('retrieval evaluator checks the Phase 5A evaluation set', () => {
  const output = runScript('scripts/evaluate-copilot-retrieval.mjs');

  assert.match(output, /Copilot retrieval evaluation passed/);
  assert.match(output, /Total cases: 30/);
  assert.match(output, /Failures: 0/);
  assert.match(output, /Top-3/);
});

test('retrieval evaluator can emit JSON results for CI consumers', () => {
  const output = runScript('scripts/evaluate-copilot-retrieval.mjs', ['--json']);
  const result = JSON.parse(output);

  assert.equal(result.totalCases, 30);
  assert.equal(result.failures, 0);
  assert.ok(Array.isArray(result.cases));
  assert.ok(result.cases.every((entry) => entry.pass === true));
  assert.ok(result.cases.every((entry) => entry.topSources.length <= 3));
});

test('local validation scripts are committed source files', () => {
  assert.equal(existsSync(new URL('../scripts/validate-copilot-sources.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/evaluate-copilot-retrieval.mjs', import.meta.url)), true);
});
