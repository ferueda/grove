export function quoteForShell(str: string): string {
  // Simple single quote quoting
  return `'${str.replace(/'/g, "'\\''")}'`;
}
