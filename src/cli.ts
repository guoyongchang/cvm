import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { ensureDirs, CVM_DIR, SHIM_PATH } from './core/paths.js';
import { install, uninstall, use, current, listInstalled } from './core/versions.js';
import { fetchPackageInfo } from './core/registry.js';
import { installShim, getPathInstruction, getShellProfileHint } from './core/shim.js';
import { applyProxy, revertPatch, patchStatus } from './core/patcher.js';
import { semverCompare, bold, green, dim, cyan, yellow, red } from './util.js';

declare const __VERSION__: string;

function handleError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(red(`Error: ${msg}`));
  process.exit(1);
}

function findExistingClaude(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim().split('\n')[0] || null;
  } catch { return null; }
}

export function run(argv: string[]): void {
  const program = new Command();

  program
    .name('cvm')
    .version(__VERSION__)
    .description('Claude Code Version Manager');

  // ── setup ──────────────────────────────────────────────────────────────

  program
    .command('setup')
    .description('Initialize CVM directories and install the claude shim')
    .action(() => {
      try {
        ensureDirs();
        installShim();
        console.log(green('✓ CVM initialized'));
        console.log();
        console.log(`  CVM home:  ${CVM_DIR}`);
        console.log(`  Shim:      ${SHIM_PATH}`);
        console.log();
        console.log(`Add this to ${getShellProfileHint()}:`);
        console.log();
        console.log(`  ${bold(getPathInstruction())}`);
        console.log();

        const existing = findExistingClaude();
        if (existing) {
          console.log(yellow(`Note: existing ${existing} found. The CVM shim will take priority once PATH is configured.`));
        }
      } catch (e) { handleError(e); }
    });

  // ── install ────────────────────────────────────────────────────────────

  program
    .command('install <version>')
    .description('Install a Claude Code version (e.g., "latest", "2.1.87")')
    .option('-f, --force', 'Reinstall even if already installed')
    .action(async (version: string, opts: { force?: boolean }) => {
      try {
        await install(version, opts.force);
      } catch (e) { handleError(e); }
    });

  // ── uninstall ──────────────────────────────────────────────────────────

  program
    .command('uninstall <version>')
    .description('Remove an installed version')
    .option('-f, --force', 'Remove even if active or has patches')
    .action((version: string, opts: { force?: boolean }) => {
      try {
        uninstall(version, opts.force);
      } catch (e) { handleError(e); }
    });

  // ── use ────────────────────────────────────────────────────────────────

  program
    .command('use <version>')
    .description('Switch to an installed version')
    .action((version: string) => {
      try {
        use(version);
      } catch (e) { handleError(e); }
    });

  // ── current ────────────────────────────────────────────────────────────

  program
    .command('current')
    .description('Show the active version')
    .action(() => {
      const v = current();
      if (v) console.log(v);
      else console.log(dim('No active version'));
    });

  // ── list ───────────────────────────────────────────────────────────────

  program
    .command('list')
    .alias('ls')
    .description('List installed versions')
    .option('-r, --remote', 'List available versions from the registry')
    .option('-l, --last <n>', 'Show only the last N remote versions', '20')
    .action(async (opts: { remote?: boolean; last: string }) => {
      try {
        if (opts.remote) {
          const { versions, tags } = await fetchPackageInfo();
          const tagMap = new Map(Object.entries(tags).map(([k, v]) => [v, k]));
          const sorted = versions.sort(semverCompare);
          const last = parseInt(opts.last, 10) || 20;
          const shown = sorted.slice(-last);

          console.log(`Showing last ${shown.length} of ${sorted.length} versions:\n`);
          for (const v of shown) {
            const tag = tagMap.get(v);
            console.log(`  ${v}${tag ? cyan(` (${tag})`) : ''}`);
          }
          console.log();
        } else {
          const installed = listInstalled();
          if (installed.length === 0) {
            console.log(dim('No versions installed. Run: cvm install latest'));
            return;
          }
          for (const v of installed) {
            const marker = v.active ? green(' * ') : '   ';
            const patch = v.patched ? yellow(' [patched]') : '';
            console.log(`${marker}${v.version}${patch}`);
          }
        }
      } catch (e) { handleError(e); }
    });

  // ── patch ──────────────────────────────────────────────────────────────

  const patch = program
    .command('patch')
    .description('Manage proxy patches for installed versions');

  patch
    .command('proxy <url>')
    .description('Replace all Anthropic API domains with a proxy URL')
    .option('-V, --version <version>', 'Target version (default: active)')
    .action((url: string, opts: { version?: string }) => {
      try {
        applyProxy(url, opts.version);
      } catch (e) { handleError(e); }
    });

  patch
    .command('revert')
    .description('Revert patch and restore original files')
    .option('-V, --version <version>', 'Target version (default: active)')
    .action((opts: { version?: string }) => {
      try {
        revertPatch(opts.version);
      } catch (e) { handleError(e); }
    });

  patch
    .command('status')
    .description('Show patch status for a version')
    .option('-V, --version <version>', 'Target version (default: active)')
    .action((opts: { version?: string }) => {
      patchStatus(opts.version);
    });

  program.parse(argv);
}
