import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** M9 (ARCH §5) — credencial emitida por `POST /register` no backend, persistida localmente entre boots. */
export interface CloudCredential {
  readonly establishmentId: string;
  readonly credential: string;
}

export function loadCloudCredential(dataDir: string): CloudCredential | null {
  const filePath = credentialFilePath(dataDir);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed?.establishmentId === "string" && typeof parsed?.credential === "string") {
      return { establishmentId: parsed.establishmentId, credential: parsed.credential };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCloudCredential(dataDir: string, credential: CloudCredential): void {
  writeFileSync(credentialFilePath(dataDir), JSON.stringify(credential), "utf8");
}

function credentialFilePath(dataDir: string): string {
  return path.join(dataDir, "cloud-credential.json");
}
