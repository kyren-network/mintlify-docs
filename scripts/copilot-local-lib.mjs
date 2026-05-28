import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const LANGUAGES = ['en', 'zh', 'zh-Hant'];

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'playwright-report', 'scripts', 'tests']);
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'api', 'are', 'as', 'but', 'can', 'do', 'for', 'how', 'i', 'is', 'it', 'my', 'of', 'or',
  'should', 'the', 'to', 'use', 'what', 'when', 'why', 'with', '吗', '什么', '应该', '應該', '怎麼', '怎么',
]);

export function readDocsConfig(root = process.cwd()) {
  return JSON.parse(readFileSync(path.join(root, 'docs.json'), 'utf8'));
}

export function pageToFile(page) {
  return `${page}.mdx`;
}

export function pageToUrl(page) {
  return `/${page}`;
}

export function urlToFile(url) {
  if (!url.startsWith('/') || url.startsWith('/api-reference/')) return null;
  return `${url.slice(1)}.mdx`;
}

export function detectLanguage(file) {
  if (file.startsWith('zh-Hant/')) return 'zh-Hant';
  if (file.startsWith('zh/')) return 'zh';
  return 'en';
}

export function parseFrontmatter(content) {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end === -1) return {};
  const frontmatter = {};
  for (const line of content.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return frontmatter;
}

export function stripMdx(content) {
  return content
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_>#|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractSections(content) {
  const withoutFrontmatter = content.replace(/^---[\s\S]*?\n---\n/, '');
  const sections = [];
  let current = { heading: 'Overview', lines: [] };
  for (const line of withoutFrontmatter.split('\n')) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      if (current.lines.join('\n').trim()) sections.push(current);
      current = { heading: heading[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('\n').trim()) sections.push(current);
  return sections.length ? sections : [{ heading: 'Overview', lines: [withoutFrontmatter] }];
}

export function listMdxFiles(root = process.cwd(), dir = '.') {
  const files = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const rel = dir === '.' ? entry.name : path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMdxFiles(root, rel));
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      files.push(rel);
    }
  }
  return files.sort();
}

export function loadPublicSources(root = process.cwd()) {
  return listMdxFiles(root).map((file) => {
    const content = readFileSync(path.join(root, file), 'utf8');
    const frontmatter = parseFrontmatter(content);
    const page = file.replace(/\.mdx$/, '');
    return {
      file,
      url: pageToUrl(page),
      title: frontmatter.title || page.split('/').at(-1),
      language: frontmatter.language || detectLanguage(file),
      text: stripMdx(content),
      frontmatter,
    };
  });
}

function stableId(...parts) {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export function buildChunksFromSource(source, content) {
  return extractSections(content)
    .map((section, index) => {
      const text = stripMdx(section.lines.join('\n'));
      if (!text) return null;
      const sourcePath = source.file;
      return {
        id: stableId(source.url, section.heading, String(index), text),
        sourcePath,
        url: source.url,
        title: source.title,
        section: section.heading,
        language: source.language,
        productArea: source.frontmatter.product_area || null,
        intent: source.frontmatter.intent || null,
        audience: source.frontmatter.audience || null,
        visibility: source.frontmatter.visibility || 'public',
        lastVerifiedAt: source.frontmatter.last_verified_at || null,
        sourceOwner: source.frontmatter.source_owner || null,
        text,
        tokens: tokenize(`${source.title} ${section.heading} ${text}`),
        citation: {
          url: source.url,
          title: source.title,
          section: section.heading,
        },
      };
    })
    .filter(Boolean);
}

export function buildKnowledgeIndex(root = process.cwd()) {
  const sources = listMdxFiles(root).map((file) => {
    const content = readFileSync(path.join(root, file), 'utf8');
    const frontmatter = parseFrontmatter(content);
    const page = file.replace(/\.mdx$/, '');
    const source = {
      file,
      url: pageToUrl(page),
      title: frontmatter.title || page.split('/').at(-1),
      language: frontmatter.language || detectLanguage(file),
      frontmatter,
    };
    return { ...source, chunks: buildChunksFromSource(source, content) };
  });
  const chunks = sources.flatMap((source) => source.chunks);
  return {
    schemaVersion: 1,
    generator: 'kyren-pay-docs/scripts/build-copilot-index.mjs',
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    chunkCount: chunks.length,
    languages: LANGUAGES,
    sources: sources.map(({ chunks: _chunks, ...source }) => source),
    chunks,
  };
}

export function extractCopilotGroups(config) {
  const groups = [];
  for (const lang of config.navigation.languages || []) {
    for (const tab of lang.tabs || []) {
      for (const group of tab.groups || []) {
        if (/Copilot/.test(group.group)) {
          groups.push({ language: lang.language, group: group.group, pages: group.pages || [] });
        }
      }
    }
  }
  return groups;
}

export function parseEvaluationCases(content) {
  const cases = [];
  let language = null;
  for (const line of content.split('\n')) {
    const heading = line.match(/^## (English|Simplified Chinese|Traditional Chinese) test questions/);
    if (heading) {
      language = heading[1] === 'English' ? 'en' : heading[1] === 'Simplified Chinese' ? 'zh' : 'zh-Hant';
      continue;
    }
    if (!language || !line.startsWith('| ') || line.includes('---') || /Test question|测试问题|測試問題/.test(line)) {
      continue;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const required = cells[1].match(/\]\(([^)]+)\)/);
    if (required) {
      cases.push({
        language,
        question: cells[0],
        requiredUrl: required[1],
        mustAvoid: cells[3],
      });
    }
  }
  return cases;
}

export function tokenize(input) {
  const normalized = input
    .toLowerCase()
    .replace(/checkout session/g, 'checkout_session')
    .replace(/api\.php/g, 'api_php')
    .replace(/submit\.php/g, 'submit_php')
    .replace(/mapi\.php/g, 'mapi_php');
  const ascii = normalized.match(/[a-z0-9_]+/g) || [];
  const cjk = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const phraseTokens = [];
  const phraseMap = [
    [/没有收到|未收到|did not receive/, 'webhook-not-received'],
    [/簽名|签名|signature/, 'webhook-signature-fails'],
    [/付款|paid|積分|积分|credited|credits/, 'paid-but-not-credited'],
    [/币种|幣種|currency/, 'checkout-session-fails'],
    [/结算|結算|settlement/, 'settlement-eligibility'],
    [/支持|支援|support/, 'support-escalation'],
  ];
  for (const [pattern, token] of phraseMap) {
    if (pattern.test(normalized)) phraseTokens.push(token);
  }
  return [...ascii, ...cjk, ...phraseTokens].filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function sourceBoost(source, queryTokens, query) {
  let boost = 0;
  if (source.url.includes('/troubleshooting/')) boost += 3;
  if (source.language !== 'en') boost += 2;
  if (source.language === 'en' && /[\u4e00-\u9fff]/.test(query)) boost -= 8;
  if (source.url.includes('/copilot/support-escalation') && /support|支持|支援/.test(query)) boost += 5;
  if (source.url.includes('/epay-migration/signature') && /sign|签名|簽名/.test(query)) boost += 5;
  if (source.url.includes('/epay-migration/api-php') && /refund|api_php|退款/.test(query)) boost += 5;
  if (source.url.endsWith('/start-here') && /integration path|choose|选择|選擇|集成|整合/.test(query)) boost += 5;
  if (source.url.includes('/settlement-eligibility') && /settlement|结算|結算/.test(query)) boost += 5;
  if (source.url.includes('/paid-but-not-credited') && /付款|paid|積分|积分|credited|credits/.test(query)) boost += 20;
  if (source.url.includes('/webhook-not-received') && /没有收到|未收到|did not receive/.test(query)) boost += 20;
  if (source.url.includes('/webhook-signature-fails') && /簽名|签名|signature/.test(query)) boost += 20;
  for (const token of queryTokens) {
    if (source.url.toLowerCase().includes(token.replace('_', '-'))) boost += 4;
    if (source.title.toLowerCase().includes(token.replace('_', ' '))) boost += 3;
  }
  return boost;
}

function textForRetrieval(item) {
  return `${item.title} ${item.section || ''} ${item.url} ${item.text || ''}`.toLowerCase();
}

export function retrieve(query, sources, language, limit = 3) {
  const queryTokens = tokenize(query);
  const queryText = query.toLowerCase();
  const preferred = sources.filter((source) => source.language === language);
  const fallback = language === 'en' ? [] : sources.filter((source) => source.language === 'en');
  const candidates = [...preferred, ...fallback];
  return candidates
    .map((source) => {
      const haystack = textForRetrieval(source);
      let score = sourceBoost(source, queryTokens, queryText);
      for (const token of queryTokens) {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        score += (haystack.match(new RegExp(escaped, 'g')) || []).length;
      }
      return { ...source, score };
    })
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit);
}

export function retrieveFromIndex(query, index, language, limit = 3) {
  const chunks = (index.chunks || []).filter((chunk) => chunk.intent !== 'retrieval_evaluation');
  return retrieve(query, chunks, language, Math.max(limit * 4, limit))
    .reduce((unique, chunk) => {
      if (!unique.some((item) => item.url === chunk.url)) unique.push(chunk);
      return unique;
    }, [])
    .slice(0, limit);
}

export function buildAnswerContext(query, index, language = 'en', limit = 3) {
  const chunks = retrieveFromIndex(query, index, language, limit);
  const citations = chunks
    .reduce((items, chunk) => {
      if (!items.some((item) => item.url === chunk.url)) {
        items.push({
          url: chunk.url,
          title: chunk.title,
          section: chunk.section,
          language: chunk.language,
        });
      }
      return items;
    }, [])
    .slice(0, 3);
  const answerPolicy = classifyAnswerPolicy(query, chunks);
  const instructions = answerInstructions(language);
  return {
    schemaVersion: 1,
    generator: 'kyren-pay-docs/scripts/build-copilot-answer-context.mjs',
    generatedAt: new Date().toISOString(),
    query,
    language,
    answerPolicy,
    contextChunks: chunks.map((chunk, index) => ({
      rank: index + 1,
      id: chunk.id,
      url: chunk.url,
      title: chunk.title,
      section: chunk.section,
      language: chunk.language,
      score: chunk.score,
      text: chunk.text,
      citation: chunk.citation,
    })),
    citations,
    instructions,
    prompt: buildAnswerPrompt(query, language, answerPolicy, chunks, citations, instructions),
  };
}

function classifyAnswerPolicy(query, chunks) {
  const text = `${query}\n${chunks.map((chunk) => `${chunk.url} ${chunk.title} ${chunk.text}`).join('\n')}`.toLowerCase();
  if (/settlement|结算|結算|payout|kyc|kyb|approve|approval|审核|審核/.test(text)) {
    return {
      mode: 'support_handoff',
      reason: 'This question may depend on account-specific review, operational approval, or private merchant configuration.',
    };
  }
  return {
    mode: 'answer_from_docs',
    reason: 'The retrieved public documentation contains safe merchant-facing guidance for this question.',
  };
}

function answerInstructions(language) {
  const localizedStyle = {
    en: 'Answer in English.',
    zh: '使用简体中文回答。',
    'zh-Hant': '使用繁體中文回答。',
  };
  return {
    answerLanguage: localizedStyle[language] || localizedStyle.en,
    must: [
      'Use only the provided context chunks and public citations.',
      'Start with the most likely answer or next concrete check.',
      'Cite 1-3 public documentation pages from the citation list.',
      'When support handoff is required, explain what information to prepare without asking for secrets.',
    ],
    mustNot: [
      'Do not ask for full API keys, Webhook secrets, card data, or private credentials.',
      'Do not promise refund, settlement, payout, KYC, or KYB approval or timing.',
      'Do not invent undocumented dashboard screens or API behavior.',
      'Do not convert decimal string fields into floating-point JSON numbers.',
    ],
  };
}

function buildAnswerPrompt(query, language, answerPolicy, chunks, citations, instructions) {
  const sourceText = chunks
    .map((chunk, index) => `[Source ${index + 1}] ${chunk.title} - ${chunk.section}\nURL: ${chunk.url}\n${chunk.text}`)
    .join('\n\n');
  const citationText = citations.map((citation, index) => `${index + 1}. ${citation.title}: ${citation.url}`).join('\n');
  return [
    `User language: ${language}`,
    `Answer mode: ${answerPolicy.mode}`,
    `Policy reason: ${answerPolicy.reason}`,
    `Language instruction: ${instructions.answerLanguage}`,
    '',
    'User question:',
    query,
    '',
    'Context:',
    sourceText,
    '',
    'Allowed citations:',
    citationText,
    '',
    'Rules:',
    ...instructions.must.map((rule) => `- ${rule}`),
    ...instructions.mustNot.map((rule) => `- ${rule}`),
  ].join('\n');
}

export function assertFilesExist(root, pages) {
  return pages.filter((page) => !existsSync(path.join(root, pageToFile(page))));
}
