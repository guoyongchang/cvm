import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { versionPackageDir } from './paths.js';
import { readConfig, updateConfig } from './config.js';
import { current } from './versions.js';
import { bold, dim, green, yellow } from '../util.js';

const TARGET_FILE = 'cli.js';

// ── Domain replacements ────────────────────────────────────────────────────
// URL strings are stable across all cc versions (not affected by minification).
// Order matters: staging before main (substring containment).

const DOMAIN_REPLACEMENTS = [
  { search: 'https://api-staging.anthropic.com', label: 'api-staging.anthropic.com' },
  { search: 'https://api.anthropic.com',         label: 'api.anthropic.com' },
  { search: 'https://platform.claude.com',       label: 'platform.claude.com' },
  { search: 'https://mcp-proxy.anthropic.com',   label: 'mcp-proxy.anthropic.com' },
];

// Domain check bypass: the minified variable name changes per version,
// but the function body is stable. We match just the body part.
const DOMAIN_CHECK_SEARCH = '=function(){return this.baseURL!=="https://api.anthropic.com"}';
const DOMAIN_CHECK_REPLACE = '=function(){return false}';

function replaceAndCount(content: string, search: string, replace: string): { result: string; count: number } {
  let count = 0;
  const result = content.replaceAll(search, () => { count++; return replace; });
  return { result, count };
}

// ── Proxy patch ────────────────────────────────────────────────────────────

export function applyProxy(baseUrl: string, version?: string): void {
  const v = version ?? current();
  if (!v) throw new Error('No active version. Run "cvm use <version>" first.');

  // Normalize: strip trailing slashes
  const url = baseUrl.replace(/\/+$/, '');

  // Validate URL
  try { new URL(url); } catch {
    throw new Error(`Invalid proxy URL: "${baseUrl}". Must be a valid URL (e.g., https://proxy.example.com).`);
  }

  const pkgDir = versionPackageDir(v);
  const targetPath = join(pkgDir, TARGET_FILE);
  const backupPath = targetPath + '.bak';

  if (!existsSync(targetPath)) {
    throw new Error(`${TARGET_FILE} not found at: ${targetPath}`);
  }

  // Idempotent: always patch from pristine backup
  const config = readConfig();
  const existingPatch = config.patches.find((p) => p.version === v);

  if (existsSync(backupPath)) {
    copyFileSync(backupPath, targetPath);
  } else if (existingPatch) {
    // Backup was deleted while config says patched — current file is already patched.
    // Cannot safely create a "pristine" backup from it.
    throw new Error(
      `Backup file missing but version ${v} is recorded as patched. ` +
      `The original ${TARGET_FILE} cannot be recovered. ` +
      `Run "cvm install ${v} --force" to reinstall a clean copy.`
    );
  } else {
    copyFileSync(targetPath, backupPath);
  }

  let content = readFileSync(targetPath, 'utf-8');
  const stats: Array<{ label: string; count: number }> = [];

  // 1. Domain check bypass (best-effort, before URL replacement)
  {
    const { result, count } = replaceAndCount(content, DOMAIN_CHECK_SEARCH, DOMAIN_CHECK_REPLACE);
    content = result;
    stats.push({ label: 'Domain check bypass', count });
  }

  // 2. URL replacements (order: staging → main → platform → mcp)
  for (const { search, label } of DOMAIN_REPLACEMENTS) {
    const { result, count } = replaceAndCount(content, search, url);
    content = result;
    stats.push({ label, count });
  }

  writeFileSync(targetPath, content);

  // Track in config
  updateConfig((c) => {
    c.patches = c.patches.filter((p) => p.version !== v);
    c.patches.push({ version: v, proxyUrl: url, appliedAt: new Date().toISOString() });
  });

  // Print summary
  console.log(`\n${green('✓')} Proxy patch applied to v${bold(v)} → ${bold(url)}\n`);
  for (const s of stats) {
    const status = s.count > 0 ? `${s.count} replacement(s)` : dim('not found (skipped)');
    console.log(`  ${s.label.padEnd(32)} ${status}`);
  }
  console.log();
}

// ── Revert ─────────────────────────────────────────────────────────────────

export function revertPatch(version?: string): void {
  const v = version ?? current();
  if (!v) throw new Error('No active version.');

  const config = readConfig();
  const record = config.patches.find((p) => p.version === v);
  if (!record) throw new Error(`No patch applied to version ${v}.`);

  const pkgDir = versionPackageDir(v);
  const backupPath = join(pkgDir, TARGET_FILE + '.bak');

  if (!existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupPath}`);
  }

  copyFileSync(backupPath, join(pkgDir, TARGET_FILE));

  updateConfig((c) => {
    c.patches = c.patches.filter((p) => p.version !== v);
  });

  console.log(green(`✓ Reverted patch on v${v}`));
}

// ── Status ─────────────────────────────────────────────────────────────────

export function patchStatus(version?: string): void {
  const v = version ?? current();
  if (!v) {
    console.log(dim('No active version.'));
    return;
  }

  const config = readConfig();
  const record = config.patches.find((p) => p.version === v);

  if (!record) {
    console.log(`v${v}: ${dim('no patch applied')}`);
    return;
  }

  const pkgDir = versionPackageDir(v);
  const filePath = join(pkgDir, TARGET_FILE);

  if (!existsSync(filePath)) {
    console.log(yellow(`v${v}: target file missing (version may have been removed)`));
    return;
  }

  const content = readFileSync(filePath, 'utf-8');

  // Count remaining original domains to verify patch effectiveness
  const remaining: Array<{ label: string; count: number }> = [];
  for (const { search, label } of DOMAIN_REPLACEMENTS) {
    const count = content.split(search).length - 1;
    remaining.push({ label, count });
  }

  console.log(`v${v}: patched → ${bold(record.proxyUrl)} (${dim(record.appliedAt)})\n`);
  console.log('  Remaining original domains:');
  for (const r of remaining) {
    const status = r.count === 0 ? green('0 (clean)') : yellow(`${r.count} remaining`);
    console.log(`    ${r.label.padEnd(32)} ${status}`);
  }
  console.log();
}
