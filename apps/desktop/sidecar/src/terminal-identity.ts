import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Identidade provisória do terminal (M3): um UUID gerado no primeiro boot e
 * persistido em disco, reaproveitado nos boots seguintes — só o suficiente
 * pra preencher `terminalId` nos eventos deste terminal. O cadastro/
 * pareamento de terminal de verdade (credencial emitida pelo backend,
 * vinculada ao estabelecimento) é do M9 (ARCH §9); isso aqui é só um valor
 * local estável até lá, mesmo padrão do limite fixo provisório do M5.
 */
export function loadOrCreateTerminalId(dataDir: string): string {
  const filePath = path.join(dataDir, "terminal-id");
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8").trim();
    if (existing.length > 0) return existing;
  }
  const id = randomUUID();
  writeFileSync(filePath, id, "utf8");
  return id;
}
