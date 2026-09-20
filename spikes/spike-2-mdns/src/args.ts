/** Parser mínimo de `--chave valor` — o bastante pra este spike, sem puxar dependência extra. */
export function parseArgs(argv: readonly string[]): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const atual = argv[i];
    if (!atual?.startsWith("--")) continue;
    const chave = atual.slice(2);
    const proximo = argv[i + 1];
    if (proximo !== undefined && !proximo.startsWith("--")) {
      resultado[chave] = proximo;
      i++;
    } else {
      resultado[chave] = "true";
    }
  }
  return resultado;
}
