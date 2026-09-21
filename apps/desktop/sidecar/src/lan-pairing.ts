import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * M9 (ARCH §7) — token compartilhado que autentica o servidor de sync LAN
 * entre terminais do mesmo estabelecimento (impede qualquer outro
 * dispositivo na rede Wi-Fi do bar de ler/injetar eventos).
 *
 * Sem tela de login nenhuma pra "emitir" pareamento, o fluxo é local: o
 * primeiro terminal gera um token sozinho no boot; o dono lê esse token na
 * tela de Pareamento (owner-only) e digita no segundo terminal, que então
 * adota o mesmo token. Nunca trafega pela rede — só entre a UI e o
 * usuário, exatamente como um código de pareamento físico.
 */
export function loadOrCreateLanToken(dataDir: string): string {
  const filePath = tokenFilePath(dataDir);
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf8").trim();
    if (existing.length > 0) return existing;
  }
  const token = randomBytes(16).toString("hex");
  writeFileSync(filePath, token, "utf8");
  return token;
}

/** Chamado quando o operador digita o token lido de outro terminal — este terminal passa a usar o mesmo. */
export function adoptLanToken(dataDir: string, token: string): void {
  writeFileSync(tokenFilePath(dataDir), token, "utf8");
}

function tokenFilePath(dataDir: string): string {
  return path.join(dataDir, "lan-token");
}
