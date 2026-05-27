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

export function retrieve(query, sources, language, limit = 3) {
  const queryTokens = tokenize(query);
  const queryText = query.toLowerCase();
  const preferred = sources.filter((source) => source.language === language);
  const fallback = language === 'en' ? [] : sources.filter((source) => source.language === 'en');
  const candidates = [...preferred, ...fallback];
  return candidates
    .map((source) => {
      const haystack = `${source.title} ${source.url} ${source.text}`.toLowerCase();
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

export function assertFilesExist(root, pages) {
  return pages.filter((page) => !existsSync(path.join(root, pageToFile(page))));
}
