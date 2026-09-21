import { listPeers, type Peer } from "./discovery.js";
import { loadManualHost } from "./manual-host.js";

export interface SyncTarget {
  readonly host: string;
  readonly port: number;
}

/**
 * ARCH §2, decisão 3 — host manual primeiro (se configurado), depois
 * qualquer peer descoberto por mDNS. Compartilhado entre o loop de sync LAN
 * e o patrocínio de cadastro na nuvem (mesmo conjunto de terminais confiáveis).
 */
export function listLanSyncTargets(dataDir: string): SyncTarget[] {
  const manualHost = loadManualHost(dataDir);
  return [...(manualHost ? [manualHost] : []), ...listPeers().map((p: Peer) => ({ host: p.host, port: p.port }))];
}
