#!/usr/bin/env node
/**
 * inject-web-favicon.mjs
 * Copies favicon assets from public/ to dist/ and injects multi-resolution
 * <link rel="icon"> tags into dist/index.html for SPA web builds.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

if (!fs.existsSync(distDir)) {
  console.error('dist/ directory not found. Run expo export first.');
  process.exit(1);
}

for (const file of ['favicon.svg', 'favicon.png', 'favicon.ico', 'apple-touch-icon.png']) {
  const src = path.join(publicDir, file);
  const dest = path.join(distDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

const indexPath = path.join(distDir, 'index.html');
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf8');
  const faviconLinks = [
    '    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
    '    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png" />',
    '    <link rel="shortcut icon" href="/favicon.ico" />',
    '    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '    <meta name="theme-color" content="#003087" />',
  ].join('\n');

  if (!html.includes('href="/favicon.svg"')) {
    html = html.replace('</title>', `</title>\n${faviconLinks}`);
    fs.writeFileSync(indexPath, html, 'utf8');
  }
}

console.log('✅ Injected multi-resolution favicons into dist/index.html and dist/.');
