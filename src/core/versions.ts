import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
  readdirSync, symlinkSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  VERSIONS_DIR, ACTIVE_LINK, PACKAGE_NAME, versionDir, versionPackageDir, ensureDirs,
} from './paths.js';
import { readConfig, updateConfig } from './config.js';
import { resolveVersion } from './registry.js';
import { resolveEntryPoint, installShim } from './shim.js';
import { spawnLive, semverCompare, green, yellow, bold, dim, IS_WIN } from '../util.js';
import type { VersionInfo } from '../types.js';

const INSTALLING_MARKER = '.installing';

function unlinkSafe(path: string): void {
  try {
    unlinkSync(path);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function rmSafe(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function createActiveLink(target: string): void {
  unlinkSafe(ACTIVE_LINK);
  if (IS_WIN) {
    symlinkSync(target, ACTIVE_LINK, 'junction');
  } else {
    symlinkSync(target, ACTIVE_LINK);
  }
}

function isValidInstall(version: string): boolean {
  return existsSync(join(versionPackageDir(version), 'package.json'));
}

/** Check if a PID is still alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Ensure ~/.claude/settings.json disables auto-update */
function ensureClaudeSettings(): void {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  mkdirSync(claudeDir, { recursive: true });

  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        settings = parsed;
      }
    } catch {
      // Malformed JSON — start from a clean object
    }
  }

  if (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env)) {
    settings.env = {};
  }

  if (settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === '1') return;

  settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(dim('Set CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 in ~/.claude/settings.json'));
}

/** Remove version directories that have stale .installing markers (dead PID) */
function cleanupStaleInstalls(): void {
  if (!existsSync(VERSIONS_DIR)) return;
  for (const name of readdirSync(VERSIONS_DIR)) {
    const marker = join(versionDir(name), INSTALLING_MARKER);
    if (!existsSync(marker)) continue;

    // Read PID from marker; only clean up if the process is dead
    let pid = 0;
    try { pid = parseInt(readFileSync(marker, 'utf-8').trim(), 10); } catch {}
    if (pid > 0 && isProcessAlive(pid)) continue;

    console.log(yellow(`Cleaning up interrupted install: ${name}`));
    rmSafe(versionDir(name));
  }
}

export async function install(versionInput: string, force = false): Promise<void> {
  ensureDirs();
  cleanupStaleInstalls();

  const version = await resolveVersion(versionInput);
  const dir = versionDir(version);

  if (!force && isValidInstall(version)) {
    console.log(`Version ${bold(version)} is already installed.`);
    return;
  }

  if (force && existsSync(dir)) {
    rmSafe(dir);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, INSTALLING_MARKER), String(process.pid));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `cvm-v-${version}`, private: true }));

  console.log(`Installing ${PACKAGE_NAME}@${bold(version)}...`);
  const code = await spawnLive('npm', ['install', `${PACKAGE_NAME}@${version}`, '--no-package-lock'], { cwd: dir });

  if (code !== 0) {
    rmSafe(dir);
    throw new Error(`npm install failed with exit code ${code}`);
  }

  if (!isValidInstall(version)) {
    rmSafe(dir);
    throw new Error('Installation verification failed: package not found after install');
  }

  rmSafe(join(dir, INSTALLING_MARKER));
  ensureClaudeSettings();
  console.log(green(`✓ Installed ${version}`));

  const config = readConfig();
  if (!config.active) {
    use(version);
  }
}

export function uninstall(version: string, force = false): void {
  const dir = versionDir(version);
  if (!existsSync(dir)) {
    throw new Error(`Version ${version} is not installed.`);
  }

  const config = readConfig();
  if (config.active === version && !force) {
    throw new Error(`Version ${version} is currently active. Switch to another version first, or use --force.`);
  }

  const appliedPatches = config.patches.filter((p) => p.version === version);
  if (appliedPatches.length > 0 && !force) {
    throw new Error(
      `Version ${version} has patches applied. Use --force to remove anyway.`
    );
  }

  // Update config FIRST so the system stays consistent if rmSafe fails
  updateConfig((c) => {
    if (c.active === version) {
      c.active = null;
      unlinkSafe(ACTIVE_LINK);
    }
    c.patches = c.patches.filter((p) => p.version !== version);
  });

  rmSafe(dir);

  console.log(green(`✓ Uninstalled ${version}`));
}

export function use(version: string): void {
  if (!isValidInstall(version)) {
    throw new Error(`Version ${version} is not installed. Run: cvm install ${version}`);
  }

  const pkgDir = versionPackageDir(version);

  createActiveLink(pkgDir);

  const entry = resolveEntryPoint(pkgDir);
  installShim(entry);

  updateConfig((c) => { c.active = version; });

  console.log(green(`✓ Now using Claude Code ${bold(version)} (entry: ${entry})`));
}

export function current(): string | null {
  return readConfig().active;
}

export function listInstalled(): VersionInfo[] {
  if (!existsSync(VERSIONS_DIR)) return [];

  const config = readConfig();
  const patchedVersions = new Set(config.patches.map((p) => p.version));

  return readdirSync(VERSIONS_DIR)
    .filter((name) => isValidInstall(name))
    .sort(semverCompare)
    .map((version) => ({
      version,
      active: config.active === version,
      patched: patchedVersions.has(version),
    }));
}
