import { execa } from 'execa';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';

export async function setupRepo() {
  const tmp = realpathSync(await mkdtemp(join(tmpdir(), 'grove-test-')));
  const remoteDir = join(tmp, 'remote.git');
  const repoDir = join(tmp, 'repo');
  const groveDir = join(tmp, 'grove');

  await execa('git', ['init', '--bare', remoteDir]);
  
  await execa('git', ['init', repoDir]);
  await execa('git', ['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
  
  const initialFile = join(repoDir, 'README.md');
  await execa('node', ['-e', `require("fs").writeFileSync("${initialFile}", "hello\\n")`]);
  await execa('git', ['add', 'README.md'], { cwd: repoDir });
  
  // Need to set git config for tests
  await execa('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  
  await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir });
  await execa('git', ['branch', '-M', 'main'], { cwd: repoDir });
  await execa('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });

  return { tmpDir: tmp, repoDir, groveDir, remoteDir };
}
