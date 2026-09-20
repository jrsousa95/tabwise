/** Parser mínimo de `--key value` — o bastante pra este spike, sem puxar dependência extra. */
export function parseArgs(argv: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (!current?.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      result[key] = next;
      i++;
    } else {
      result[key] = "true";
    }
  }
  return result;
}
