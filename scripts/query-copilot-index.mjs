#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { retrieveFromIndex } from './copilot-local-lib.mjs';

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
const results = retrieveFromIndex(query, index, language, Number.isFinite(limit) ? limit : 3).map((result) => ({
  id: result.id,
  url: result.url,
  title: result.title,
  section: result.section,
  language: result.language,
  score: result.score,
  text: result.text,
  citation: result.citation,
}));

const payload = {
  query,
  language,
  indexPath,
  results,
};

if (json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.log(`Query: ${query}`);
  console.log(`Language: ${language}`);
  console.log(`Index: ${indexPath}`);
  console.log('Top results:');
  for (const result of results) {
    console.log(`- ${result.url}#${result.section} (${result.language}, score ${result.score})`);
  }
}
