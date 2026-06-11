import { execa } from "execa";
import { GitCommandError, GitNotFoundError } from "../errors.js";

export async function runGit(cwd: string | undefined, args: string[]): Promise<string> {
  try {
    const { stdout } = await execa("git", args, cwd ? { cwd } : undefined);
    return stdout.trim();
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new GitNotFoundError();
    }
    const stderr = error.stderr || error.message || "Unknown git error";
    throw new GitCommandError(`git ${args.join(" ")} failed`, stderr);
  }
}
