#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { buildAnswerContext } from './copilot-local-lib.mjs';

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const indexPath = readArg('--index', 'generated/copilot-knowledge-index.json');
const query = readArg('--query');
const language = readArg('--lang', 'en');
const limit = Number(readArg('--limit', '3'));
const json = process.argv.includes('--json');

if (!query) {
  console.error('Missing required --query value');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const context = buildAnswerContext(query, index, language, Number.isFinite(limit) ? limit : 3);
context.indexPath = indexPath;

if (json) {
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
} else {
  console.log(`Query: ${context.query}`);
  console.log(`Language: ${context.language}`);
  console.log(`Answer mode: ${context.answerPolicy.mode}`);
  console.log('Citations:');
  for (const citation of context.citations) {
    console.log(`- ${citation.title}: ${citation.url}`);
  }
  console.log('\nPrompt:');
  console.log(context.prompt);
}
