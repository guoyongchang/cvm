import { readConfig } from './config.js';
import { PACKAGE_NAME } from './paths.js';
import { spawn } from '../util.js';

let _registryUrl: string | null = null;

export async function resolveRegistry(): Promise<string> {
  if (_registryUrl) return _registryUrl;

  const config = readConfig();
  if (config.registry) {
    _registryUrl = config.registry;
    return _registryUrl;
  }

  try {
    const result = await spawn('npm', ['config', 'get', 'registry']);
    const url = result.stdout.trim().replace(/\/+$/, '');
    _registryUrl = url || 'https://registry.npmjs.org';
  } catch {
    _registryUrl = 'https://registry.npmjs.org';
  }
  return _registryUrl;
}

interface PackageInfo {
  versions: string[];
  tags: Record<string, string>;
}

let _packageInfoCache: PackageInfo | null = null;

export async function fetchPackageInfo(): Promise<PackageInfo> {
  if (_packageInfoCache) return _packageInfoCache;

  const registry = await resolveRegistry();
  const url = `${registry}/${PACKAGE_NAME}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Registry request failed: ${res.status} ${res.statusText}`);
  const data = await res.json() as { versions?: Record<string, unknown>; 'dist-tags'?: Record<string, string> };

  _packageInfoCache = {
    versions: Object.keys(data.versions ?? {}),
    tags: data['dist-tags'] ?? {},
  };
  return _packageInfoCache;
}

export async function fetchVersionList(): Promise<string[]> {
  return (await fetchPackageInfo()).versions;
}

export async function fetchDistTags(): Promise<Record<string, string>> {
  return (await fetchPackageInfo()).tags;
}

export async function resolveVersion(input: string): Promise<string> {
  // Strict semver: digits.digits.digits with optional pre-release suffix
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(input)) return input;

  const tags = await fetchDistTags();
  const resolved = tags[input];
  if (!resolved) {
    throw new Error(`Unknown version alias "${input}". Available tags: ${Object.keys(tags).join(', ')}`);
  }
  return resolved;
}
