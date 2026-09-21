#!/usr/bin/env node
/**
 * M12 (PRD 7.4, ARCH §9 item 4) — cenários sintéticos de concorrência
 * multi-terminal, exigidos antes do lançamento comercial do plano pago
 * (usuários do plano free, 1 terminal, nunca geram esses cenários em
 * produção). Sobe dois processos sidecar reais, isolados (portas e
 * data-dirs próprios, nunca a porta 4550 do usuário), pareados por LAN, e
 * dispara ações concorrentes de verdade — não é um teste do motor de
 * reconciliação isolado (isso já existe em
 * `packages/sync-engine/test/arch-4.2-table-conflict.test.ts`), é o
 * sistema completo (HTTP + sync LAN real) sob concorrência.
 *
 * Sidecar não usa vitest de propósito (convenção do projeto — validado
 * por smoke test roteirizado); este script é esse smoke test, só que
 * formalizado como artefato reexecutável em vez de comandos avulsos.
 *
 * Uso: node test/concurrency-scenario.mjs   (precisa de `npm run build:bundle` antes)
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_ENTRY = path.join(__dirname, "..", "dist", "index.js");

const PORT_A = 4700;
const PORT_B = 4701;

function log(msg) {
  console.log(`[concurrency-scenario] ${msg}`);
}

function startSidecar(port, dataDir) {
  const child = spawn(process.execPath, [SIDECAR_ENTRY], {
    env: { ...process.env, PASSA_A_REGUA_PORT: String(port), PASSA_A_REGUA_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {}); // silencia stdout normal; erros ainda vão pro stderr do processo pai
  child.stderr.pipe(process.stderr);
  return child;
}

/** Só mata o PID exato que este script spawnou — mesma regra de segurança usada em toda a sessão. */
function stopSidecar(child) {
  if (child && !child.killed) child.kill();
}

async function waitForHealth(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // ainda subindo
    }
    await sleep(100);
  }
  throw new Error(`sidecar na porta ${port} não respondeu /health a tempo`);
}

async function waitUntil(fn, { timeoutMs = 15000, intervalMs = 500, description = "condição" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`timeout esperando por: ${description}${lastError ? ` (último erro: ${lastError.message})` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(port, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function getJson(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.json();
}

async function main() {
  const dataDirA = mkdtempSync(path.join(tmpdir(), "passa-a-regua-concurrency-a-"));
  const dataDirB = mkdtempSync(path.join(tmpdir(), "passa-a-regua-concurrency-b-"));
  let sidecarA;
  let sidecarB;

  try {
    log("subindo dois sidecars isolados (portas 4700/4701, longe da porta 4550 real)...");
    sidecarA = startSidecar(PORT_A, dataDirA);
    sidecarB = startSidecar(PORT_B, dataDirB);
    await Promise.all([waitForHealth(PORT_A), waitForHealth(PORT_B)]);
    log("ambos no ar.");

    log("bootstrap do dono em A + login...");
    await postJson(PORT_A, "/operators", { name: "Ana", role: "owner", pin: "1234" });
    await postJson(PORT_A, "/session/login", { pin: "1234" });

    log("pareando A e B (token LAN + host manual nos dois sentidos)...");
    const { token } = await getJson(PORT_A, "/pairing/lan-token");
    await postJson(PORT_A, "/pairing/manual-host", { host: "127.0.0.1", port: PORT_B });
    await postJson(PORT_B, "/pairing/lan-token", { token });
    await postJson(PORT_B, "/pairing/manual-host", { host: "127.0.0.1", port: PORT_A });

    log("esperando o sync LAN trazer o operador de A pra B...");
    await waitUntil(async () => (await getJson(PORT_B, "/state")).operators.length > 0, { description: "B receber o operador de A" });
    await postJson(PORT_B, "/session/login", { pin: "1234" });

    log("cadastrando mesa em A e esperando propagar pra B...");
    const table = (await postJson(PORT_A, "/tables", { identifier: "Mesa Concorrência" })).data;
    await waitUntil(async () => (await getJson(PORT_B, "/state")).tables.some((t) => t.id === table.id), {
      description: "mesa propagar de A pra B",
    });

    // === Cenário 1 (ARCH §4.2 literal): dois terminais abrem comanda pra
    // MESMA mesa ao mesmo tempo, sem se verem (nenhum aguarda o outro). ===
    log("CENÁRIO 1: A e B abrem comanda pra mesma mesa simultaneamente...");
    const [orderFromA, orderFromB] = await Promise.all([
      postJson(PORT_A, "/orders", { source: "table", tableId: table.id }),
      postJson(PORT_B, "/orders", { source: "table", tableId: table.id }),
    ]);
    assert.equal(orderFromA.status, 201, "A deveria conseguir abrir sua comanda (não viu a de B ainda)");
    assert.equal(orderFromB.status, 201, "B deveria conseguir abrir sua comanda (não viu a de A ainda)");
    const orderIdA = orderFromA.data.id;
    const orderIdB = orderFromB.data.id;
    assert.notEqual(orderIdA, orderIdB, "as duas comandas precisam ter ids diferentes (cada terminal gerou a sua)");

    log("esperando o sync LAN convergir e mesclar automaticamente (ARCH §4.2)...");
    await waitUntil(
      async () => {
        const state = await getJson(PORT_A, "/state");
        const a = state.orders.find((o) => o.id === orderIdA);
        const b = state.orders.find((o) => o.id === orderIdB);
        return a && b && (a.mergedInto !== undefined || b.mergedInto !== undefined);
      },
      { description: "merge automático acontecer em A", timeoutMs: 20000 }
    );

    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const a = state.orders.find((o) => o.id === orderIdA);
      const b = state.orders.find((o) => o.id === orderIdB);
      assert.ok(a && b, `terminal na porta ${port} precisa conhecer as duas comandas depois do sync`);
      const canonical = a.mergedInto === undefined ? a : b;
      const losing = a.mergedInto === undefined ? b : a;
      assert.equal(losing.mergedInto, canonical.id, `terminal ${port}: a perdedora precisa apontar pra canônica`);
      assert.equal(canonical.status, "open", `terminal ${port}: a canônica precisa continuar aberta`);
      assert.ok(
        state.mergeWarnings.some((w) => w.losingOrder === losing.id && w.canonicalOrder === canonical.id && w.tableId === table.id),
        `terminal ${port}: precisa ter o aviso de merge (ARCH §4.2, não pode ficar silencioso)`
      );
    }
    // Os dois terminais precisam concordar em QUEM é a canônica (convergência, não só "cada um mesclou algo").
    const finalStateA = await getJson(PORT_A, "/state");
    const finalStateB = await getJson(PORT_B, "/state");
    const canonicalIdFromA = finalStateA.orders.find((o) => o.mergedInto === undefined && [orderIdA, orderIdB].includes(o.id)).id;
    const canonicalIdFromB = finalStateB.orders.find((o) => o.mergedInto === undefined && [orderIdA, orderIdB].includes(o.id)).id;
    assert.equal(canonicalIdFromA, canonicalIdFromB, "A e B precisam concordar em qual comanda é a canônica");
    log(`CENÁRIO 1 OK — canônica: ${canonicalIdFromA}, mesclada: ${canonicalIdFromA === orderIdA ? orderIdB : orderIdA}`);

    // === Cenário 2: item lançado simultaneamente nos dois terminais na
    // MESMA comanda (já resolvida, sem conflito de mesa) — não pode perder item. ===
    log("CENÁRIO 2: A e B lançam item simultaneamente na mesma comanda (já convergida)...");
    const category = (await postJson(PORT_A, "/categories", { name: "Bebidas" })).data;
    const productBeer = (await postJson(PORT_A, "/products", { name: "Cerveja", priceCents: 1000, categoryId: category.id, active: true }))
      .data;
    await waitUntil(async () => (await getJson(PORT_B, "/state")).products.some((p) => p.id === productBeer.id), {
      description: "produto propagar de A pra B",
    });

    const [itemFromA, itemFromB] = await Promise.all([
      postJson(PORT_A, `/orders/${canonicalIdFromA}/items`, { productId: productBeer.id, quantity: 1 }),
      postJson(PORT_B, `/orders/${canonicalIdFromA}/items`, { productId: productBeer.id, quantity: 2 }),
    ]);
    assert.equal(itemFromA.status, 201);
    assert.equal(itemFromB.status, 201);

    await waitUntil(
      async () => {
        const state = await getJson(PORT_B, "/state");
        const order = state.orders.find((o) => o.id === canonicalIdFromA);
        return order && order.items.length >= 2;
      },
      { description: "os dois itens concorrentes aparecerem em B", timeoutMs: 20000 }
    );
    const orderAfterItems = (await getJson(PORT_A, "/state")).orders.find((o) => o.id === canonicalIdFromA);
    assert.equal(orderAfterItems.items.length, 2, "nenhum item concorrente pode se perder");
    log("CENÁRIO 2 OK — os dois itens lançados ao mesmo tempo sobreviveram ao sync.");

    // === Cenário 3 (PRD 7.1, NFR2): queda do "host" não trava o outro terminal. ===
    log("CENÁRIO 3: derrubando o terminal A — B precisa continuar funcionando sozinho...");
    stopSidecar(sidecarA);
    await sleep(1000);
    const standaloneAfterKill = await postJson(PORT_B, "/orders", { source: "standalone" });
    assert.equal(standaloneAfterKill.status, 201, "B precisa continuar aceitando novas comandas com A fora do ar");
    const healthB = await fetch(`http://127.0.0.1:${PORT_B}/health`);
    assert.ok(healthB.ok, "B precisa continuar respondendo normalmente");
    log("CENÁRIO 3 OK — B seguiu funcionando normalmente com A fora do ar.");

    log("TODOS OS CENÁRIOS PASSARAM.");
  } finally {
    stopSidecar(sidecarA);
    stopSidecar(sidecarB);
    rmSync(dataDirA, { recursive: true, force: true });
    rmSync(dataDirB, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(`[concurrency-scenario] FALHOU: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
);
