#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildKnowledgeIndex } from './copilot-local-lib.mjs';

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const out = readArg('--out', 'generated/copilot-knowledge-index.json');
if (!out) {
  console.error('Missing value for --out');
  process.exit(1);
}

const index = buildKnowledgeIndex(process.cwd());
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`);

console.log('Copilot knowledge index built');
console.log(`Output: ${out}`);
console.log(`Sources: ${index.sourceCount}`);
console.log(`Chunks: ${index.chunkCount}`);
