import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { CONFIG_FILE } from './paths.js';
import type { CvmConfig } from '../types.js';

const DEFAULT_CONFIG: CvmConfig = {
  active: null,
  registry: null,
  patches: [],
};

export function readConfig(): CvmConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG, patches: [] };
  let raw: Record<string, any>;
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    raw = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    raw = {};
  }
  return {
    active: typeof raw.active === 'string' ? raw.active : null,
    registry: typeof raw.registry === 'string' ? raw.registry : null,
    patches: Array.isArray(raw.patches) ? raw.patches : [],
  };
}

export function writeConfig(config: CvmConfig): void {
  const tmp = CONFIG_FILE + '.tmp';
  const data = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(tmp, data);
  try {
    renameSync(tmp, CONFIG_FILE);
  } catch {
    // Windows: rename fails if target exists — write directly as fallback
    writeFileSync(CONFIG_FILE, data);
    try { unlinkSync(tmp); } catch {}
  }
}

export function updateConfig(fn: (config: CvmConfig) => void): void {
  const config = readConfig();
  fn(config);
  writeConfig(config);
}
