import { Bonjour, type Service } from "bonjour-service";
import { TIPO_SERVICO } from "./config";

/**
 * Spike 2 (M0, ARCH §2): fica escutando a rede local por outros terminais
 * anunciando via mDNS (rodar anunciar.ts em outra máquina/processo).
 *
 * Uso: npm run descobrir
 */
const bonjour = new Bonjour();
const inicioEm = Date.now();
const vistos = new Set<string>();

console.log(`[descobrir] procurando serviços _${TIPO_SERVICO}._tcp.local na rede...`);

const browser = bonjour.find({ type: TIPO_SERVICO });

function formatar(servico: Service): string {
  const enderecos = servico.addresses?.join(", ") ?? "(sem endereço ainda)";
  const terminalId = servico.txt?.terminalId ?? servico.name;
  return `nome="${servico.name}" terminalId="${terminalId}" host=${servico.host} porta=${servico.port} enderecos=[${enderecos}]`;
}

browser.on("up", (servico: Service) => {
  const decorridoMs = Date.now() - inicioEm;
  const primeiraVez = !vistos.has(servico.fqdn);
  vistos.add(servico.fqdn);
  console.log(
    `[descobrir] ${primeiraVez ? "ENCONTRADO" : "atualizado"} (+${decorridoMs}ms desde o início) — ${formatar(servico)}`
  );
});

browser.on("down", (servico: Service) => {
  console.log(`[descobrir] SAIU DO AR — nome="${servico.name}" host=${servico.host}`);
});

function encerrar() {
  console.log("\n[descobrir] encerrando...");
  bonjour.destroy();
  process.exit(0);
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
