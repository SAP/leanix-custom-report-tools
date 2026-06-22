import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const CLI_PATH = resolve(
  __dirname,
  '..',
  Object.values(pkg.bin as Record<string, string>)[0]
);
const INJECT_HELPER = resolve(__dirname, 'inject-prompts.mjs');

/**
 * Run the built CLI in a child process. Pass `answers` to pre-queue
 * interactive prompt responses via prompts.inject() (loaded as an --import
 * preload so the bundled CLI sees the same `prompts` module instance).
 */
export function runCli(
  args: string[],
  cwd?: string,
  answers?: unknown[]
): { stdout: string; stderr: string; exitCode: number } {
  const nodeArgs = [CLI_PATH, ...args];
  const env = { ...process.env };
  if (answers) {
    nodeArgs.unshift('--import', pathToFileURL(INJECT_HELPER).href);
    env.__TEST_PROMPTS_INJECT = JSON.stringify(answers);
  }
  try {
    const stdout = execFileSync('node', nodeArgs, {
      cwd,
      env,
      encoding: 'utf8'
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      exitCode: e.status || 1
    };
  }
}

/** Path to the built CLI — exported so tests can derive `templates/` next to it. */
export { CLI_PATH };
