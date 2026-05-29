#!/usr/bin/env node
import {
  loadPublicSources,
  readDocsConfig,
} from './copilot-local-lib.mjs';

const root = process.cwd();
const config = readDocsConfig(root);
const sources = loadPublicSources(root);
const errors = [];

const navigationText = JSON.stringify(config.navigation);
if (/Copilot/.test(navigationText) || /copilot\//.test(navigationText)) {
  errors.push('Copilot source pages must not be exposed in public documentation navigation.');
}

const sourceFiles = new Set(sources.map((source) => source.file));
const expectedSources = [
  'copilot/answer-boundaries.mdx',
  'copilot/question-routing.mdx',
  'copilot/support-escalation.mdx',
  'copilot/retrieval-index.mdx',
  'copilot/chunking-and-citations.mdx',
  'copilot/retrieval-evaluation.mdx',
  'copilot/local-validation.mdx',
  'zh/copilot/answer-boundaries.mdx',
  'zh/copilot/question-routing.mdx',
  'zh/copilot/support-escalation.mdx',
  'zh/copilot/retrieval-index.mdx',
  'zh/copilot/chunking-and-citations.mdx',
  'zh/copilot/retrieval-evaluation.mdx',
  'zh/copilot/local-validation.mdx',
  'zh-Hant/copilot/answer-boundaries.mdx',
  'zh-Hant/copilot/question-routing.mdx',
  'zh-Hant/copilot/support-escalation.mdx',
  'zh-Hant/copilot/retrieval-index.mdx',
  'zh-Hant/copilot/chunking-and-citations.mdx',
  'zh-Hant/copilot/retrieval-evaluation.mdx',
  'zh-Hant/copilot/local-validation.mdx',
];
for (const expected of expectedSources) {
  if (!sourceFiles.has(expected)) errors.push(`Expected indexed source file is missing: ${expected}`);
}

const forbiddenFiles = [...sourceFiles].filter((file) =>
  file.includes('playwright-report') ||
  file.startsWith('scripts/') ||
  file.startsWith('tests/') ||
  file.startsWith('docs/superpowers/')
);
if (forbiddenFiles.length) {
  errors.push(`Excluded files entered the source list: ${forbiddenFiles.join(', ')}`);
}

if (errors.length) {
  console.error('Copilot source validation failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Copilot source validation passed');
for (const language of ['en', 'zh', 'zh-Hant']) {
  const prefix = language === 'en' ? 'copilot/' : `${language}/copilot/`;
  const count = expectedSources.filter((file) => file.startsWith(prefix)).length;
  console.log(`${language}: ${count} private Copilot source files`);
}
console.log(`Indexed source files: ${sources.length}`);
