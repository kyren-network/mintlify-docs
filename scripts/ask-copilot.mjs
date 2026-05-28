#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildAnswerContext } from './copilot-local-lib.mjs';

function readArg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export function loadAssistantEnv(env = process.env, cwd = process.cwd()) {
  for (const file of [path.join(cwd, '.env'), path.join(cwd, '..', '.env')]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      if (env[match[1]] !== undefined) continue;
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

export function readConfig(env = process.env, cwd = process.cwd()) {
  loadAssistantEnv(env, cwd);
  const provider = env.APP_ASSISTANT_PROVIDER || 'openai-compatible';
  const baseUrl = env.APP_ASSISTANT_BASE_URL;
  const model = env.APP_ASSISTANT_MODEL;
  const apiKey = env.APP_ASSISTANT_API_KEY;
  if (provider !== 'openai-compatible') {
    throw new Error(`Unsupported APP_ASSISTANT_PROVIDER: ${provider}`);
  }
  if (!baseUrl || !model || !apiKey) {
    throw new Error('APP_ASSISTANT_BASE_URL, APP_ASSISTANT_MODEL, and APP_ASSISTANT_API_KEY are required.');
  }
  return { provider, baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey };
}

export async function callOpenAICompatible({ baseUrl, model, apiKey }, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: [
            'You are Kyren Copilot, a merchant documentation assistant.',
            'Answer only from the supplied context.',
            'Use the required answer language.',
            'Do not ask for secrets or promise operational approvals.',
            'Cite public documentation pages from the allowed citation list.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: context.prompt,
        },
      ],
    }),
  }).finally(() => clearTimeout(timeout));
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const payload = JSON.parse(text);
  return payload.choices?.[0]?.message?.content?.trim() || '';
}

export async function runAskCopilot(argv = process.argv) {
  const indexPath = readArg(argv, '--index', 'generated/copilot-knowledge-index.json');
  const query = readArg(argv, '--query');
  const language = readArg(argv, '--lang', 'en');
  const limit = Number(readArg(argv, '--limit', '3'));
  const dryRunAnswer = readArg(argv, '--dry-run-answer');
  const json = argv.includes('--json');

  if (!query) {
    throw new Error('Missing required --query value');
  }

  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  const context = buildAnswerContext(query, index, language, Number.isFinite(limit) ? limit : 3);
  const config = dryRunAnswer
    ? {
        provider: process.env.APP_ASSISTANT_PROVIDER || 'openai-compatible',
        baseUrl: process.env.APP_ASSISTANT_BASE_URL || 'dry-run',
        model: process.env.APP_ASSISTANT_MODEL || 'dry-run',
      }
    : readConfig();
  const answer = dryRunAnswer || await callOpenAICompatible(config, context);
  return {
    query,
    language,
    answer,
    answerPolicy: context.answerPolicy,
    citations: context.citations,
    contextChunks: context.contextChunks,
    provider: {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
    },
    indexPath,
    json,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runAskCopilot(process.argv);
    if (result.json) {
      const { json: _json, ...payload } = result;
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      console.log(`Answer mode: ${result.answerPolicy.mode}`);
      console.log('\nAnswer:');
      console.log(result.answer);
      console.log('\nCitations:');
      for (const citation of result.citations) {
        console.log(`- ${citation.title}: ${citation.url}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
