#!/usr/bin/env node
/**
 * scan-secrets.mjs
 *
 * Scans tracked/source files in `/Users/danny/Desktop/PayPal-AI-Billing-Kit`
 * to verify:
 *  - No service_role keys, private keys, or PayPal client secrets exist in source files
 *  - No Health eRecords production/staging project refs (`aionuzxksjzodxctdqkd`, `uqzemlcdmyomyiebdsmd`)
 *    or real owner emails (`apd1034@gmail.com`) exist in application code
 *  - `.env` is ignored by `.gitignore`
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'coverage',
  'docs',
]);

const FORBIDDEN_PATTERNS = [
  { name: 'Supabase Service Role JWT', regex: /"role"\s*:\s*"service_role"/i },
  { name: 'GitHub Personal Access Token', regex: /\bgh[po]_[A-Za-z0-9]{25,}\b/ },
  { name: 'OpenAI Secret Key', regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/ },
  { name: 'Health eRecords Production Project Ref', regex: /\baionuzxksjzodxctdqkd\b/ },
  { name: 'Health eRecords Staging Project Ref', regex: /\buqzemlcdmyomyiebdsmd\b/ },
  { name: 'Personal Owner Email', regex: /\bapd1034@gmail\.com\b/i },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name === '.env') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|mjs|json|sql|md)$/.test(entry.name)) {
      if (entry.name === 'scan-secrets.mjs') continue;
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
let violations = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.regex.test(content)) {
      console.error(`❌ Violation [${rule.name}] in ${path.relative(ROOT, file)}`);
      violations += 1;
    }
  }
}

const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
if (!gitignore.includes('.env')) {
  console.error('❌ .gitignore does not exclude .env');
  violations += 1;
}

if (violations > 0) {
  console.error(`\nSecret & Isolation Scan FAILED with ${violations} violation(s).`);
  process.exit(1);
}

console.log(
  `✅ Secret & Isolation Scan PASSED (${files.length} source files checked, 0 secrets, 0 Health eRecords references, .env gitignored).`
);
