import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

/** ARCH §2, decisão 2 — fallback manual de IP/porta quando a descoberta mDNS falha (rede bloqueia multicast). */
export interface ManualHost {
  readonly host: string;
  readonly port: number;
}

export function loadManualHost(dataDir: string): ManualHost | null {
  const filePath = manualHostFilePath(dataDir);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed?.host === "string" && typeof parsed?.port === "number") {
      return { host: parsed.host, port: parsed.port };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveManualHost(dataDir: string, host: string, port: number): void {
  writeFileSync(manualHostFilePath(dataDir), JSON.stringify({ host, port }), "utf8");
}

export function clearManualHost(dataDir: string): void {
  const filePath = manualHostFilePath(dataDir);
  if (existsSync(filePath)) unlinkSync(filePath);
}

function manualHostFilePath(dataDir: string): string {
  return path.join(dataDir, "manual-host.json");
}
