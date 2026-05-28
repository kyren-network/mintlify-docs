import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { callOpenAICompatible } from '../scripts/ask-copilot.mjs';

const node = process.execPath;

function runScript(script, args = []) {
  return execFileSync(node, [script, ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runScriptWithEnv(script, args = [], env = {}) {
  return execFileSync(node, [script, ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function startMockOpenAICompatibleServer() {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ request, body: parsed });
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: 'Check whether the API key is present and active. Do not share the full key. See the cited troubleshooting page.',
            },
          },
        ],
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
        requests,
      });
    });
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

test('Phase 5B builder creates a reusable knowledge index artifact', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-index-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  const output = runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);
  const index = JSON.parse(readFileSync(outputPath, 'utf8'));

  assert.match(output, /Copilot knowledge index built/);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.generator, 'kyren-pay-docs/scripts/build-copilot-index.mjs');
  assert.ok(index.generatedAt);
  assert.ok(index.sourceCount >= 120);
  assert.ok(index.chunkCount >= index.sourceCount);
  assert.ok(index.chunks.some((chunk) => chunk.url === '/troubleshooting/api-401'));
  assert.ok(index.chunks.every((chunk) => chunk.id && chunk.url && chunk.title && chunk.language && chunk.text));
});

test('Phase 5B query CLI retrieves from the built knowledge index', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-query-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);

  const output = runScript('scripts/query-copilot-index.mjs', [
    '--index',
    outputPath,
    '--lang',
    'zh',
    '--query',
    'Webhook 签名验证失败',
    '--json',
  ]);
  const result = JSON.parse(output);

  assert.equal(result.query, 'Webhook 签名验证失败');
  assert.equal(result.language, 'zh');
  assert.ok(result.results.length <= 3);
  assert.equal(result.results[0].url, '/zh/troubleshooting/webhook-signature-fails');
  assert.ok(result.results[0].citation.url);
  assert.ok(result.results[0].citation.title);
});

test('retrieval evaluator can validate a built index artifact', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-eval-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);

  const output = runScript('scripts/evaluate-copilot-retrieval.mjs', ['--index', outputPath, '--json']);
  const result = JSON.parse(output);

  assert.equal(result.totalCases, 30);
  assert.equal(result.failures, 0);
  assert.equal(result.indexPath, outputPath);
});

test('Phase 5C answer context CLI returns citations and answer policy', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-context-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);

  const output = runScript('scripts/build-copilot-answer-context.mjs', [
    '--index',
    outputPath,
    '--lang',
    'en',
    '--query',
    'My API call returns 401. What should I check?',
    '--json',
  ]);
  const context = JSON.parse(output);

  assert.equal(context.schemaVersion, 1);
  assert.equal(context.query, 'My API call returns 401. What should I check?');
  assert.equal(context.language, 'en');
  assert.equal(context.answerPolicy.mode, 'answer_from_docs');
  assert.ok(context.contextChunks.length >= 1);
  assert.ok(context.contextChunks.length <= 3);
  assert.ok(context.citations.some((citation) => citation.url === '/troubleshooting/api-401'));
  assert.ok(context.instructions.mustNot.some((rule) => /API keys/i.test(rule)));
  assert.ok(context.prompt.includes('[Source 1]'));
});

test('Phase 5C answer context flags support handoff questions', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-context-support-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);

  const output = runScript('scripts/build-copilot-answer-context.mjs', [
    '--index',
    outputPath,
    '--lang',
    'zh',
    '--query',
    '为什么不能结算？',
    '--json',
  ]);
  const context = JSON.parse(output);

  assert.equal(context.answerPolicy.mode, 'support_handoff');
  assert.match(context.answerPolicy.reason, /account-specific|账户|帳戶/);
  assert.ok(context.citations.some((citation) => citation.url === '/zh/troubleshooting/settlement-eligibility'));
  assert.ok(context.instructions.mustNot.some((rule) => /settlement|结算|結算/i.test(rule)));
});

test('Phase 5D OpenAI-compatible adapter sends answer context and returns model text', async () => {
  const server = await startMockOpenAICompatibleServer();

  try {
    const answer = await callOpenAICompatible({
      baseUrl: server.baseUrl,
      model: 'test-model',
      apiKey: 'test-key',
    }, {
      prompt: '[Source 1] API request returns 401\nURL: /troubleshooting/api-401\nCheck auth headers.',
    });

    assert.match(answer, /API key/i);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].request.headers.authorization, 'Bearer test-key');
    assert.equal(server.requests[0].body.model, 'test-model');
    assert.ok(server.requests[0].body.messages.some((message) => message.content.includes('[Source 1]')));
  } finally {
    await server.close();
  }
});

test('Phase 5D ask CLI returns cited answer JSON from a mock provider', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'kyren-copilot-ask-dry-'));
  const outputPath = join(tempDir, 'knowledge-index.json');
  runScript('scripts/build-copilot-index.mjs', ['--out', outputPath]);

  const output = runScriptWithEnv('scripts/ask-copilot.mjs', [
    '--index',
    outputPath,
    '--lang',
    'en',
    '--query',
    'My API call returns 401. What should I check?',
    '--json',
    '--dry-run-answer',
    'Check whether the API key is present and active.',
  ], {
    APP_ASSISTANT_PROVIDER: 'openai-compatible',
    APP_ASSISTANT_BASE_URL: 'http://127.0.0.1:1',
    APP_ASSISTANT_MODEL: 'test-model',
    APP_ASSISTANT_API_KEY: 'test-key',
  });
  const result = JSON.parse(output);

  assert.equal(result.provider.provider, 'openai-compatible');
  assert.equal(result.provider.model, 'test-model');
  assert.match(result.answer, /API key/i);
  assert.ok(result.citations.some((citation) => citation.url === '/troubleshooting/api-401'));
});

test('local validation scripts are committed source files', () => {
  assert.equal(existsSync(new URL('../scripts/validate-copilot-sources.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/evaluate-copilot-retrieval.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/build-copilot-index.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/query-copilot-index.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/build-copilot-answer-context.mjs', import.meta.url)), true);
  assert.equal(existsSync(new URL('../scripts/ask-copilot.mjs', import.meta.url)), true);
});
