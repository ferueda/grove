import pc from "picocolors";
import { GroveError, GitCommandError } from "@ferueda/grove";
import { errorEnvelope } from "./json-output.js";
import { exitCodeForError } from "./exit-codes.js";

let debugEnabled = false;
let jsonEnabled = false;

export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
}

export function setJson(enabled: boolean): void {
  jsonEnabled = enabled;
}

export function isJsonMode(): boolean {
  return jsonEnabled;
}

export function handleError(err: unknown): never {
  const exitCode = exitCodeForError(err);

  if (jsonEnabled) {
    const code = err instanceof GroveError ? err.code : "UNKNOWN_ERROR";
    const message = err instanceof Error ? err.message : String(err);
    const details: Record<string, unknown> = {};
    if (err instanceof GitCommandError && err.stderr) {
      details.stderr = err.stderr;
    }
    process.stdout.write(JSON.stringify(errorEnvelope(code, message, details)) + "\n");
    process.exit(exitCode);
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

  process.exit(exitCode);
}
