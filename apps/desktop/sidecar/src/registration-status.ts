import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/**
 * PRD 8.1 — "mensagem clara de upgrade" quando a nuvem recusa definitivamente
 * este terminal (ex: limite de terminais do plano atingido). Persistido em
 * disco pra sobreviver a reload da UI; `cloud-sync-client.ts` escreve, a
 * tela de Pareamento lê via `GET /pairing/cloud-status`.
 */
export function saveRegistrationError(dataDir: string, message: string): void {
  writeFileSync(registrationErrorFilePath(dataDir), message, "utf8");
}

export function loadRegistrationError(dataDir: string): string | null {
  const filePath = registrationErrorFilePath(dataDir);
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8").trim();
  return content.length > 0 ? content : null;
}

export function clearRegistrationError(dataDir: string): void {
  const filePath = registrationErrorFilePath(dataDir);
  if (existsSync(filePath)) unlinkSync(filePath);
}

function registrationErrorFilePath(dataDir: string): string {
  return path.join(dataDir, "cloud-registration-error");
}
