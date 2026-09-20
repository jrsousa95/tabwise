import os from "node:os";
import { Bonjour } from "bonjour-service";
import { parseArgs } from "./args";
import { PORTA_PADRAO, TIPO_SERVICO } from "./config";

/**
 * Spike 2 (M0, ARCH §2): um terminal anunciando sua presença na rede local
 * via mDNS/Bonjour, pra outro terminal (rodando descobrir.ts, na mesma
 * rede ou em outra máquina) achar automaticamente — sem digitar IP.
 *
 * Uso:
 *   npm run anunciar -- --nome T1 --porta 4550
 */
const args = parseArgs(process.argv.slice(2));
const nome = args.nome ?? os.hostname();
const porta = Number(args.porta ?? PORTA_PADRAO);

const bonjour = new Bonjour();

const iniciadoEm = new Date().toISOString();
const servico = bonjour.publish({
  name: nome,
  type: TIPO_SERVICO,
  port: porta,
  txt: { terminalId: nome, iniciadoEm },
});

servico.on("up", () => {
  console.log(`[anunciar] "${nome}" publicado — _${TIPO_SERVICO}._tcp.local na porta ${porta}`);
  console.log("[anunciar] Ctrl+C pra encerrar (envia goodbye packet e sai do ar imediatamente).");
});

servico.on("error", (erro) => {
  console.error("[anunciar] erro ao publicar:", erro);
  process.exitCode = 1;
});

function encerrar() {
  console.log("\n[anunciar] encerrando (unpublish)...");
  bonjour.unpublishAll(() => {
    bonjour.destroy();
    process.exit(0);
  });
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
