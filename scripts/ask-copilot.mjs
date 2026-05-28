#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildAnswerContext } from './copilot-local-lib.mjs';

function readArg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

export function loadAssistantEnv(env = process.env, cwd = process.cwd()) {
  for (const file of defaultEnvFiles(cwd)) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1].startsWith('#')) continue;
      if (env[match[1]] !== undefined) continue;
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

function defaultEnvFiles(cwd) {
  return [
    path.join(cwd, '.env'),
    path.join(cwd, '.env.staging'),
    path.join(cwd, '.env.prod'),
    path.join(cwd, '..', '.env'),
    path.join(cwd, '..', '.env.staging'),
    path.join(cwd, '..', '.env.prod'),
  ];
}

export function loadAssistantEnvFile(file, env = process.env) {
  if (!existsSync(file)) throw new Error(`Env file not found: ${file}`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

export function readConfig(env = process.env, cwd = process.cwd(), envFile = null) {
  if (envFile) {
    loadAssistantEnvFile(path.resolve(cwd, envFile), env);
  }
  loadAssistantEnv(env, cwd);
  const provider = env.APP_ASSISTANT_PROVIDER || 'openai-compatible';
  const baseUrl = env.APP_ASSISTANT_BASE_URL;
  const model = env.APP_ASSISTANT_MODEL;
  const apiKey = env.APP_ASSISTANT_API_KEY;
  const api = normalizeApi(env.APP_ASSISTANT_API);
  if (provider !== 'openai-compatible') {
    throw new Error(`Unsupported APP_ASSISTANT_PROVIDER: ${provider}`);
  }
  if (!baseUrl || !model || !apiKey) {
    throw new Error('APP_ASSISTANT_BASE_URL, APP_ASSISTANT_MODEL, and APP_ASSISTANT_API_KEY are required.');
  }
  return { provider, baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey, api };
}

export async function callOpenAICompatible({ baseUrl, model, apiKey }, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(chatCompletionsUrl(baseUrl), {
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
  return parseProviderResponse(response);
}

export async function callOpenAICompatibleResponses({ baseUrl, model, apiKey }, context) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const response = await fetch(responsesUrl(baseUrl), {
    method: 'POST',
    signal: controller.signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      connection: 'close',
    },
    body: JSON.stringify({
      model,
      input: [
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
  return parseProviderResponse(response);
}

async function parseProviderResponse(response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Provider request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Provider returned non-JSON response: ${text.slice(0, 200)}`);
  }
  return extractModelText(payload);
}

export function extractModelText(payload) {
  const outputText = payload.output_text?.trim();
  if (outputText) return outputText;

  const chatText = payload.choices?.[0]?.message?.content?.trim();
  if (chatText) return chatText;

  const outputParts = payload.output
    ?.flatMap((item) => item.content || [])
    ?.map((part) => part.text || part.output_text || '')
    ?.filter(Boolean);
  return outputParts?.join('\n').trim() || '';
}

export function chatCompletionsUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}/chat/completions`;
}

export function responsesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}/responses`;
}

function normalizeApi(value) {
  const normalized = (value || 'chat-completions').toLowerCase();
  if (['chat-completions', 'chat_completions', 'chat'].includes(normalized)) return 'chat-completions';
  if (['responses', 'response'].includes(normalized)) return 'responses';
  throw new Error(`Unsupported assistant API: ${value}`);
}

export async function runAskCopilot(argv = process.argv) {
  const indexPath = readArg(argv, '--index', 'generated/copilot-knowledge-index.json');
  const query = readArg(argv, '--query');
  const language = readArg(argv, '--lang', 'en');
  const limit = Number(readArg(argv, '--limit', '3'));
  const dryRunAnswer = readArg(argv, '--dry-run-answer');
  const envFile = readArg(argv, '--env-file');
  const cliApi = readArg(argv, '--api');
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
        api: normalizeApi(process.env.APP_ASSISTANT_API),
      }
    : readConfig(process.env, process.cwd(), envFile);
  const api = cliApi ? normalizeApi(cliApi) : config.api;
  const answer = dryRunAnswer || await callOpenAICompatibleApi(api, config, context);
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
      api,
    },
    indexPath,
    json,
  };
}

function callOpenAICompatibleApi(api, config, context) {
  if (api === 'responses') return callOpenAICompatibleResponses(config, context);
  return callOpenAICompatible(config, context);
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
