#!/usr/bin/env node
import {
  assertFilesExist,
  extractCopilotGroups,
  loadPublicSources,
  readDocsConfig,
} from './copilot-local-lib.mjs';

const root = process.cwd();
const config = readDocsConfig(root);
const groups = extractCopilotGroups(config);
const sources = loadPublicSources(root);
const errors = [];

if (groups.length !== 3) {
  errors.push(`Expected 3 localized Copilot navigation groups, found ${groups.length}.`);
}

for (const group of groups) {
  if (group.pages.length !== 7) {
    errors.push(`${group.language} Copilot group should contain 7 pages, found ${group.pages.length}.`);
  }
  const missing = assertFilesExist(root, group.pages);
  if (missing.length) {
    errors.push(`${group.language} Copilot group references missing pages: ${missing.join(', ')}`);
  }
}

const sourceFiles = new Set(sources.map((source) => source.file));
for (const expected of [
  'copilot/retrieval-index.mdx',
  'copilot/chunking-and-citations.mdx',
  'copilot/retrieval-evaluation.mdx',
  'copilot/local-validation.mdx',
  'zh/copilot/retrieval-index.mdx',
  'zh/copilot/chunking-and-citations.mdx',
  'zh/copilot/retrieval-evaluation.mdx',
  'zh/copilot/local-validation.mdx',
  'zh-Hant/copilot/retrieval-index.mdx',
  'zh-Hant/copilot/chunking-and-citations.mdx',
  'zh-Hant/copilot/retrieval-evaluation.mdx',
  'zh-Hant/copilot/local-validation.mdx',
]) {
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
for (const group of groups) {
  console.log(`${group.language}: ${group.pages.length} Copilot pages`);
}
console.log(`Indexed source files: ${sources.length}`);
