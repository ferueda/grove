import { CommanderError } from "commander";
import { InvalidInputError } from "@ferueda/grove";

function flagToField(flag: string): string {
  const long = flag.trim().split(/[\s,|]/)[0]?.replace(/^--/, "") ?? flag;
  return long.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function parseMissingFields(err: CommanderError): string[] | undefined {
  if (err.code === "commander.missingMandatoryOptionValue") {
    const match = err.message.match(/required option '([^']+)'/);
    if (match?.[1]) return [flagToField(match[1])];
  }

  if (err.code === "commander.missingArgument") {
    const match = err.message.match(/missing required argument '([^']+)'/);
    if (match?.[1]) return [match[1]];
  }

  if (err.code === "commander.optionMissingArgument") {
    const match = err.message.match(/option '([^']+)' argument missing/);
    if (match?.[1]) return [flagToField(match[1])];
  }

  return undefined;
}

export function invalidInputFromCommander(err: CommanderError): InvalidInputError {
  const message = err.message.replace(/^error: /, "");
  const missing = parseMissingFields(err);
  const details: Record<string, unknown> = {
    source: "commander",
    commanderCode: err.code,
    ...(missing ? { missing } : {}),
  };
  return new InvalidInputError(message, details);
}

export function isCommanderError(err: unknown): err is CommanderError {
  return err instanceof CommanderError;
}
