import { Bonjour, type Service } from "bonjour-service";

/**
 * M9 (ARCH §2, decisão 2) — descoberta mDNS entre terminais, reaproveitando
 * o `bonjour-service` já validado no Spike 2 (`spikes/spike-2-mdns/`).
 */
const SERVICE_TYPE = "tabwise";

export interface Peer {
  readonly terminalId: string;
  readonly host: string;
  readonly port: number;
}

const peers = new Map<string, Peer>();
let bonjour: Bonjour | null = null;

function ipv4Address(service: Service): string | undefined {
  return service.addresses?.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)) ?? service.addresses?.[0];
}

export function startDiscovery(terminalId: string, port: number): void {
  bonjour = new Bonjour();
  bonjour.publish({ name: terminalId, type: SERVICE_TYPE, port, txt: { terminalId } });

  const browser = bonjour.find({ type: SERVICE_TYPE });
  browser.on("up", (service: Service) => {
    const remoteTerminalId = (service.txt as Record<string, string> | undefined)?.terminalId;
    const host = ipv4Address(service);
    if (!remoteTerminalId || remoteTerminalId === terminalId || !host) return;
    peers.set(remoteTerminalId, { terminalId: remoteTerminalId, host, port: service.port });
  });
  browser.on("down", (service: Service) => {
    const remoteTerminalId = (service.txt as Record<string, string> | undefined)?.terminalId;
    if (remoteTerminalId) peers.delete(remoteTerminalId);
  });
}

/** ARCH §2, decisão 3 — "host" é só prioridade; qualquer terminal alcançável entra na lista igualmente. */
export function listPeers(): Peer[] {
  return [...peers.values()];
}

export function stopDiscovery(): void {
  bonjour?.destroy();
  bonjour = null;
}
