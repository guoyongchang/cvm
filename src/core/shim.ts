import { writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SHIM_PATH, CVM_DIR, BIN_DIR, ACTIVE_LINK } from './paths.js';
import { IS_WIN } from '../util.js';

export function resolveEntryPoint(packageDir: string): string {
  const pkgPath = join(packageDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const bin = pkg.bin;
    let entry: string | undefined;
    if (typeof bin === 'string') {
      entry = bin;
    } else if (bin && typeof bin === 'object') {
      entry = bin.claude ?? Object.values(bin)[0] as string;
    }
    if (entry) return entry.replace(/^\.\//, '');
  }
  return 'cli.js';
}

// ── Bash shim (Linux / macOS / WSL / Git Bash) ────────────────────────────

function generateBashShim(entryPoint: string): string {
  // Embed the resolved CVM_DIR so the shim is self-contained
  return `#!/bin/bash
# CVM shim - Claude Code Version Manager
CVM_DIR="\${CVM_DIR:-${CVM_DIR}}"
ACTIVE="$CVM_DIR/active"

if [ ! -L "$ACTIVE" ] && [ ! -d "$ACTIVE" ]; then
  echo "cvm: no active Claude Code version. Run: cvm install latest" >&2
  exit 1
fi

exec node "$ACTIVE/${entryPoint}" "$@"
`;
}

// ── Windows CMD shim ──────────────────────────────────────────────────────

function generateCmdShim(entryPoint: string): string {
  return `@echo off\r
rem CVM shim - Claude Code Version Manager\r
if defined CVM_DIR (set "CVM_RESOLVED=%CVM_DIR%") else (set "CVM_RESOLVED=%USERPROFILE%\\.cvm")\r
set "ACTIVE=%CVM_RESOLVED%\\active"\r
if not exist "%ACTIVE%" (\r
  echo cvm: no active Claude Code version. Run: cvm install latest >&2\r
  exit /b 1\r
)\r
node "%ACTIVE%\\${entryPoint}" %*\r
`;
}

// ── Windows PowerShell shim ───────────────────────────────────────────────

function generatePs1Shim(entryPoint: string): string {
  return `# CVM shim - Claude Code Version Manager
$cvmDir = if ($env:CVM_DIR) { $env:CVM_DIR } else { Join-Path $HOME ".cvm" }
$active = Join-Path $cvmDir "active"

if (-not (Test-Path $active)) {
  Write-Error "cvm: no active Claude Code version. Run: cvm install latest"
  exit 1
}

& node (Join-Path $active "${entryPoint}") @args
`;
}

// ── Install ───────────────────────────────────────────────────────────────

export function installShim(entryPoint?: string): void {
  mkdirSync(BIN_DIR, { recursive: true });

  // If no entry point specified, try to resolve from current active version
  if (!entryPoint) {
    const activePkg = join(ACTIVE_LINK, 'package.json');
    if (existsSync(activePkg)) {
      entryPoint = resolveEntryPoint(ACTIVE_LINK);
    } else {
      entryPoint = 'cli.js';
    }
  }

  // Always write bash shim
  writeFileSync(SHIM_PATH, generateBashShim(entryPoint));
  if (!IS_WIN) {
    chmodSync(SHIM_PATH, 0o755);
  }

  if (IS_WIN) {
    writeFileSync(SHIM_PATH + '.cmd', generateCmdShim(entryPoint));
    writeFileSync(SHIM_PATH + '.ps1', generatePs1Shim(entryPoint));
  }
}

export function getPathInstruction(): string {
  if (IS_WIN) {
    return `$env:Path = "$HOME\\.cvm\\bin;" + $env:Path  # PowerShell (session)\n` +
      `# To persist: [Environment]::SetEnvironmentVariable("Path", "$HOME\\.cvm\\bin;" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`;
  }
  return `export PATH="$HOME/.cvm/bin:$PATH"`;
}

export function getShellProfileHint(): string {
  if (IS_WIN) return 'your PowerShell profile ($PROFILE)';
  return '~/.bashrc or ~/.zshrc';
}
