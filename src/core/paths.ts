import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

export const CVM_DIR = process.env.CVM_DIR || join(homedir(), '.cvm');
export const VERSIONS_DIR = join(CVM_DIR, 'versions');
export const BIN_DIR = join(CVM_DIR, 'bin');
export const ACTIVE_LINK = join(CVM_DIR, 'active');
export const CONFIG_FILE = join(CVM_DIR, 'config.json');
export const SHIM_PATH = join(BIN_DIR, 'claude');

export const PACKAGE_NAME = '@anthropic-ai/claude-code';

export function versionDir(version: string): string {
  return join(VERSIONS_DIR, version);
}

export function versionPackageDir(version: string): string {
  return join(VERSIONS_DIR, version, 'node_modules', '@anthropic-ai', 'claude-code');
}

export function ensureDirs(): void {
  for (const dir of [VERSIONS_DIR, BIN_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}
