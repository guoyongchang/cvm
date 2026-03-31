import { spawn as cpSpawn } from 'node:child_process';

export const IS_WIN = process.platform === 'win32';

// ── ANSI colors ────────────────────────────────────────────────────────────

const esc = (code: string) => (s: string) => `\x1b[${code}m${s}\x1b[0m`;
export const bold = esc('1');
export const dim = esc('2');
export const green = esc('32');
export const red = esc('31');
export const cyan = esc('36');
export const yellow = esc('33');

// ── Process helpers ────────────────────────────────────────────────────────

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function spawn(cmd: string, args: string[], opts?: { cwd?: string }): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = cpSpawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: IS_WIN,
    });
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout?.on('data', (d: Buffer) => stdout.push(d.toString()));
    child.stderr?.on('data', (d: Buffer) => stderr.push(d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: stdout.join(''), stderr: stderr.join('') }));
  });
}

export function spawnLive(cmd: string, args: string[], opts?: { cwd?: string }): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = cpSpawn(cmd, args, {
      cwd: opts?.cwd,
      stdio: 'inherit',
      shell: IS_WIN,
    });

    const sigHandler = (sig: NodeJS.Signals) => { child.kill(sig); };
    process.on('SIGINT', sigHandler);
    process.on('SIGTERM', sigHandler);

    child.on('error', reject);
    child.on('close', (code) => {
      process.removeListener('SIGINT', sigHandler);
      process.removeListener('SIGTERM', sigHandler);
      resolve(code ?? 1);
    });
  });
}

// ── Semver ─────────────────────────────────────────────────────────────────

export function semverCompare(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    return { parts: core.split('.').map(Number), pre: pre ?? null };
  };
  const sa = parse(a);
  const sb = parse(b);
  for (let i = 0; i < Math.max(sa.parts.length, sb.parts.length); i++) {
    const diff = (sa.parts[i] ?? 0) - (sb.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Pre-release has lower precedence than release
  if (sa.pre && !sb.pre) return -1;
  if (!sa.pre && sb.pre) return 1;
  if (sa.pre && sb.pre) return sa.pre.localeCompare(sb.pre);
  return 0;
}

// ── Spinner ────────────────────────────────────────────────────────────────

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinner(message: string) {
  let i = 0;
  const timer = setInterval(() => {
    process.stderr.write(`\r${cyan(FRAMES[i++ % FRAMES.length])} ${message}`);
  }, 80);
  const cleanup = () => {
    clearInterval(timer);
    process.stderr.write('\r\x1b[K');
  };
  process.on('exit', cleanup);
  return {
    stop(final?: string) {
      cleanup();
      process.removeListener('exit', cleanup);
      if (final) console.log(final);
    },
  };
}
