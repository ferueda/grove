import { execa } from 'execa';
import type { Writable } from 'node:stream';

export interface RunHooksOptions {
  stdout?: Writable;
  stderr?: Writable;
}

export async function runHooks(commands: string[], workDir: string, opts: RunHooksOptions = {}): Promise<void> {
  for (const command of commands) {
    try {
      const isWin = process.platform === 'win32';
      const shell = isWin ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh';
      const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
      
      const child = execa(shell, args, { 
        cwd: workDir, 
        stdout: opts.stdout ? 'pipe' : 'ignore',
        stderr: opts.stderr ? 'pipe' : 'ignore',
        windowsVerbatimArguments: isWin
      });
      
      if (opts.stdout) {
        child.stdout?.pipe(opts.stdout, { end: false });
      }
      if (opts.stderr) {
        child.stderr?.pipe(opts.stderr, { end: false });
      }

      await child;
    } catch (err: any) {
      const exitCode = err.exitCode ?? -1;
      const msg = `🌳 hook command failed: "${command}" (exit ${exitCode}): ${err.message}\n`;
      if (opts.stderr) {
        opts.stderr.write(msg);
      } else {
        process.stderr.write(msg);
      }
    }
  }
}
