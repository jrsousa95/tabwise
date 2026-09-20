import os from "node:os";
import { Bonjour } from "bonjour-service";
import { parseArgs } from "./args";
import { DEFAULT_PORT, SERVICE_TYPE } from "./config";

/**
 * Spike 2 (M0, ARCH §2): um terminal anunciando sua presença na rede local
 * via mDNS/Bonjour, pra outro terminal (rodando discover.ts, na mesma
 * rede ou em outra máquina) achar automaticamente — sem digitar IP.
 *
 * Uso:
 *   npm run announce -- --name T1 --port 4550
 */
const args = parseArgs(process.argv.slice(2));
const name = args.name ?? os.hostname();
const port = Number(args.port ?? DEFAULT_PORT);

const bonjour = new Bonjour();

const startedAt = new Date().toISOString();
const service = bonjour.publish({
  name,
  type: SERVICE_TYPE,
  port,
  txt: { terminalId: name, startedAt },
});

service.on("up", () => {
  console.log(`[announce] "${name}" publicado — _${SERVICE_TYPE}._tcp.local na porta ${port}`);
  console.log("[announce] Ctrl+C pra encerrar (envia goodbye packet e sai do ar imediatamente).");
});

service.on("error", (error) => {
  console.error("[announce] erro ao publicar:", error);
  process.exitCode = 1;
});

function shutdown() {
  console.log("\n[announce] encerrando (unpublish)...");
  bonjour.unpublishAll(() => {
    bonjour.destroy();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
