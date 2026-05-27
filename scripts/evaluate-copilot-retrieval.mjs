#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadPublicSources,
  parseEvaluationCases,
  retrieve,
  urlToFile,
} from './copilot-local-lib.mjs';

const root = process.cwd();
const json = process.argv.includes('--json');
const sources = loadPublicSources(root).filter((source) => !source.url.endsWith('/copilot/retrieval-evaluation'));
const cases = parseEvaluationCases(readFileSync(path.join(root, 'copilot/retrieval-evaluation.mdx'), 'utf8'));
const sourceUrls = new Set(sources.map((source) => source.url));
const results = [];

for (const testCase of cases) {
  const requiredFile = urlToFile(testCase.requiredUrl);
  const requiredUrl = requiredFile ? `/${requiredFile.replace(/\.mdx$/, '')}` : testCase.requiredUrl;
  const topSources = retrieve(testCase.question, sources, testCase.language, 3);
  const topUrls = topSources.map((source) => source.url);
  const pass = topUrls.includes(requiredUrl) || (!requiredFile && sourceUrls.has(requiredUrl) === false);
  results.push({
    language: testCase.language,
    question: testCase.question,
    requiredSource: requiredUrl,
    pass,
    topSources: topSources.map((source) => ({
      url: source.url,
      title: source.title,
      score: source.score,
      language: source.language,
    })),
    failureLabel: pass ? null : 'missing_required_source',
  });
}

const failures = results.filter((result) => !result.pass);
const payload = {
  totalCases: results.length,
  failures: failures.length,
  cases: results,
};

if (json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.log(failures.length ? 'Copilot retrieval evaluation failed' : 'Copilot retrieval evaluation passed');
  console.log(`Total cases: ${results.length}`);
  console.log(`Failures: ${failures.length}`);
  for (const result of results) {
    console.log(`\n[${result.pass ? 'PASS' : 'FAIL'}] ${result.language}: ${result.question}`);
    console.log(`Required: ${result.requiredSource}`);
    console.log('Top-3:');
    for (const source of result.topSources) {
      console.log(`- ${source.url} (${source.language}, score ${source.score})`);
    }
  }
}

if (failures.length) process.exit(1);
