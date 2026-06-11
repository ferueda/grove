import pc from "picocolors";
import { GroveError, GitCommandError } from "@ferueda/grove";

let debugEnabled = false;
let jsonEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function setJson(enabled: boolean): void {
  jsonEnabled = enabled;
}

export function handleError(err: unknown): never {
  if (jsonEnabled) {
    const errorObj: any = { error: err instanceof Error ? err.message : String(err) };
    if (err instanceof GroveError) {
      errorObj.code = err.code;
    }
    process.stdout.write(JSON.stringify(errorObj, null, 2) + "\n");
    process.exit(1);
  }

  if (err instanceof GroveError) {
    console.error(pc.red(`[${err.code}] ${err.message}`));
    if (debugEnabled) {
      if (err instanceof GitCommandError && err.stderr) {
        console.error(pc.gray(`git stderr: ${err.stderr}`));
      }
      if (err.stack) {
        console.error(pc.gray(err.stack));
      }
    }
  } else if (err instanceof Error) {
    console.error(pc.red(err.message));
    if (debugEnabled && err.stack) {
      console.error(pc.gray(err.stack));
    }
  } else {
    console.error(pc.red(String(err)));
  }

  process.exitCode = 1;
  throw err;
}
