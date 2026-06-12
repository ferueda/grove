import { execa } from "execa";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";

export interface RepoFixture {
  tmpDir: string;
  repoDir: string;
  groveDir: string;
}

export interface RemoteRepoFixture extends RepoFixture {
  remoteDir: string;
}

async function initFixtureDirs(prefix: string): Promise<RepoFixture> {
  const tmp = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  return {
    tmpDir: tmp,
    repoDir: join(tmp, "repo"),
    groveDir: join(tmp, "grove"),
  };
}

/** Filesystem-only fixture for path resolution tests (no Git repo). */
export async function setupPathFixture(): Promise<RepoFixture> {
  return initFixtureDirs("grove-path-");
}

/** Local Git repo with an initial commit on `main` (no remote or push). */
export async function setupLocalRepo(): Promise<RepoFixture> {
  const fixture = await initFixtureDirs("grove-local-");
  const { repoDir } = fixture;

  await execa("git", ["init", repoDir]);
  await writeFile(join(repoDir, "README.md"), "hello\n");
  await execa("git", ["add", "README.md"], { cwd: repoDir });
  await execa("git", ["config", "user.name", "Test"], { cwd: repoDir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  await execa("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });
  await execa("git", ["branch", "-M", "main"], { cwd: repoDir });

  return fixture;
}

/** Full remote-capable fixture: bare origin, push, and tracking branch. */
export async function setupRepo(): Promise<RemoteRepoFixture> {
  const fixture = await initFixtureDirs("grove-test-");
  const { repoDir, tmpDir } = fixture;
  const remoteDir = join(tmpDir, "remote.git");

  await execa("git", ["init", "--bare", remoteDir]);
  await execa("git", ["init", repoDir]);
  await execa("git", ["remote", "add", "origin", remoteDir], { cwd: repoDir });
  await writeFile(join(repoDir, "README.md"), "hello\n");
  await execa("git", ["add", "README.md"], { cwd: repoDir });
  await execa("git", ["config", "user.name", "Test"], { cwd: repoDir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
  await execa("git", ["commit", "-m", "Initial commit"], { cwd: repoDir });
  await execa("git", ["branch", "-M", "main"], { cwd: repoDir });
  await execa("git", ["push", "-u", "origin", "main"], { cwd: repoDir });

  return { ...fixture, remoteDir };
}
