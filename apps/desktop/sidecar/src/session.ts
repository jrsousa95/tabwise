import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * Sessão de terminal (PRD 1.2): persistida em disco, sobrevive a restart do
 * app — só é limpa por logout explícito ou troca de operador, nunca por
 * timeout (decisão de produto já registrada no PRD). Guarda só o
 * `operatorId`; os dados do operador (nome, papel) vêm da projeção.
 */
export function loadSession(dataDir: string): { operatorId: string } | null {
  const filePath = sessionFilePath(dataDir);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed?.operatorId === "string" && parsed.operatorId.length > 0) {
      return { operatorId: parsed.operatorId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(dataDir: string, operatorId: string): void {
  writeFileSync(sessionFilePath(dataDir), JSON.stringify({ operatorId }), "utf8");
}

export function clearSession(dataDir: string): void {
  const filePath = sessionFilePath(dataDir);
  if (existsSync(filePath)) unlinkSync(filePath);
}

function sessionFilePath(dataDir: string): string {
  return path.join(dataDir, "session.json");
}
