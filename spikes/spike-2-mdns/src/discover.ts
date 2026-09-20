import { Bonjour, type Service } from "bonjour-service";
import { SERVICE_TYPE } from "./config";

/**
 * Spike 2 (M0, ARCH §2): fica escutando a rede local por outros terminais
 * anunciando via mDNS (rodar announce.ts em outra máquina/processo).
 *
 * Uso: npm run discover
 */
const bonjour = new Bonjour();
const startedAt = Date.now();
const seen = new Set<string>();

console.log(`[discover] procurando serviços _${SERVICE_TYPE}._tcp.local na rede...`);

const browser = bonjour.find({ type: SERVICE_TYPE });

function format(service: Service): string {
  const addresses = service.addresses?.join(", ") ?? "(sem endereço ainda)";
  const terminalId = service.txt?.terminalId ?? service.name;
  return `nome="${service.name}" terminalId="${terminalId}" host=${service.host} porta=${service.port} enderecos=[${addresses}]`;
}

browser.on("up", (service: Service) => {
  const elapsedMs = Date.now() - startedAt;
  const firstTime = !seen.has(service.fqdn);
  seen.add(service.fqdn);
  console.log(`[discover] ${firstTime ? "ENCONTRADO" : "atualizado"} (+${elapsedMs}ms desde o início) — ${format(service)}`);
});

browser.on("down", (service: Service) => {
  console.log(`[discover] SAIU DO AR — nome="${service.name}" host=${service.host}`);
});

function shutdown() {
  console.log("\n[discover] encerrando...");
  bonjour.destroy();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
