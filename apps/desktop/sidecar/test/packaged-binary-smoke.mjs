#!/usr/bin/env node
/**
 * M12 (ARCH §9 item 4, §10) — smoke test end-to-end contra o binário SEA
 * empacotado de verdade (não `node dist/index.js`). O Spike 1 (M0) só
 * validou `/health` nesse binário; este script cobre o fluxo de negócio
 * completo — bootstrap de operador, login, cardápio, mesa, comanda, item,
 * fechamento e resumo de caixa — confirmando que `node:sqlite` e toda a
 * lógica do MVP funcionam no binário standalone, não só o esqueleto do
 * sidecar. Roda em qualquer SO (usado localmente no Mac antes de confiar
 * nele em CI); a validação "é Windows de verdade" vem do runner do
 * workflow, não deste script.
 *
 * Uso: node test/packaged-binary-smoke.mjs <caminho-do-executavel>
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const exePath = process.argv[2];
if (!exePath) {
  console.error("uso: node packaged-binary-smoke.mjs <caminho-do-executavel-do-sidecar>");
  process.exit(1);
}

const PORT = 4720;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return res.json();
    } catch {
      // ainda subindo
    }
    await sleep(300);
  }
  throw new Error("sidecar não respondeu /health a tempo");
}

async function postJson(pathName, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

async function getJson(pathName) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathName}`);
  return res.json();
}

async function delJson(pathName) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathName}`, { method: "DELETE" });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

/** Mesmo formato fixo em hex de `packages/sync-engine/src/hlc.ts` (`l` físico + `c` lógico) — o campo é TEXT ordenável por comparação de string, então uma linha inserida direto no SQLite precisa seguir a mesma largura pra ordenar certo entre os eventos reais do sidecar. */
function serializeHlc(l, c) {
  return `${l.toString(16).padStart(16, "0")}-${c.toString(16).padStart(8, "0")}`;
}

function spawnSidecar(dataDir) {
  const child = spawn(exePath, [], {
    env: { ...process.env, TABWISE_PORT: String(PORT), TABWISE_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[sidecar stdout] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[sidecar stderr] ${d}`));
  return child;
}

// No Windows real (achado no CI do M12), `child.kill()` não espera o SO
// liberar o handle do arquivo do SQLite antes de retornar. Espera o
// processo terminar de verdade (shutdown handler do sidecar fecha o
// `db.close()` sozinho) antes de mexer no arquivo por fora ou apagar o dataDir.
async function stopSidecar(child) {
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    child.kill();
    setTimeout(resolve, 3000);
  });
}

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "tabwise-packaged-smoke-"));
  let child = spawnSidecar(dataDir);

  try {
    const health = await waitForHealth();
    console.log(`[packaged-binary-smoke] /health OK — platform=${health.platform} arch=${health.arch}`);

    console.log("[packaged-binary-smoke] bootstrap de operador (node:sqlite escrevendo pela primeira vez)...");
    const owner = await postJson("/operators", { name: "Ana", role: "owner", pin: "1234" });
    assert.equal(owner.status, 201, `esperado 201, veio ${owner.status}: ${JSON.stringify(owner.data)}`);

    console.log("[packaged-binary-smoke] login...");
    const login = await postJson("/session/login", { pin: "1234" });
    assert.equal(login.status, 200);

    console.log("[packaged-binary-smoke] cardápio (categoria + produto)...");
    const category = await postJson("/categories", { name: "Bebidas" });
    assert.equal(category.status, 201);
    const product = await postJson("/products", { name: "Cerveja", priceCents: 1000, categoryId: category.data.id, active: true });
    assert.equal(product.status, 201);

    console.log("[packaged-binary-smoke] mesa + comanda + item + fechamento...");
    const table = await postJson("/tables", { identifier: "Mesa 1" });
    assert.equal(table.status, 201);
    const order = await postJson("/orders", { source: "table", tableId: table.data.id });
    assert.equal(order.status, 201);
    const item = await postJson(`/orders/${order.data.id}/items`, { productId: product.data.id, quantity: 2 });
    assert.equal(item.status, 201);
    const close = await postJson(`/orders/${order.data.id}/close`, {
      serviceFeePercent: 10,
      splits: [{ amountCents: 2200, paymentMethod: "cash", cashReceivedCents: 2200 }],
    });
    assert.equal(close.status, 200, `esperado 200, veio ${close.status}: ${JSON.stringify(close.data)}`);

    console.log("[packaged-binary-smoke] resumo de caixa (PRD 6.1)...");
    const summary = await getJson("/cash-register/summary");
    assert.equal(summary.closedOrdersCount, 1);
    assert.equal(summary.totalSoldCents, 2200);

    console.log("[packaged-binary-smoke] renomear/remover mesa, categoria, produto (PRD 2.8/3.4/3.5)...");
    const renameCategory = await postJson(`/categories/${category.data.id}/rename`, { name: "Bebidas geladas" });
    assert.equal(renameCategory.status, 200, `esperado 200, veio ${renameCategory.status}: ${JSON.stringify(renameCategory.data)}`);

    const removeCategoryInUse = await delJson(`/categories/${category.data.id}`);
    assert.equal(removeCategoryInUse.status, 409, "categoria com produto vinculado não deveria poder ser removida");

    const renameProduct = await postJson(`/products/${product.data.id}/rename`, { name: "Cerveja long neck" });
    assert.equal(renameProduct.status, 200, `esperado 200, veio ${renameProduct.status}: ${JSON.stringify(renameProduct.data)}`);

    const removeProduct = await delJson(`/products/${product.data.id}`);
    assert.equal(removeProduct.status, 204, `esperado 204, veio ${removeProduct.status}: ${JSON.stringify(removeProduct.data)}`);

    const removeCategoryNowEmpty = await delJson(`/categories/${category.data.id}`);
    assert.equal(removeCategoryNowEmpty.status, 204, "categoria sem produtos deveria poder ser removida");

    const secondTable = await postJson("/tables", { identifier: "Mesa 2" });
    assert.equal(secondTable.status, 201);
    const renameTable = await postJson(`/tables/${secondTable.data.id}/rename`, { identifier: "Mesa 2B", capacity: 6 });
    assert.equal(renameTable.status, 200, `esperado 200, veio ${renameTable.status}: ${JSON.stringify(renameTable.data)}`);

    const secondOrder = await postJson("/orders", { source: "table", tableId: secondTable.data.id });
    assert.equal(secondOrder.status, 201);
    const removeTableOccupied = await delJson(`/tables/${secondTable.data.id}`);
    assert.equal(removeTableOccupied.status, 409, "mesa com comanda aberta não deveria poder ser removida");

    // PRD 2.6 (removida em 2026-09-22) — a UI/API que criava
    // `tables_grouped`/`table_group_dissolved` não existe mais, mas
    // instalações existentes já têm esses eventos gravados (log
    // append-only) e `rowToEvent`/`project` (packages/sync-engine)
    // continuam obrigados a revalidá-los sem quebrar. Como não há mais
    // rota que grave esses eventos, simula uma instalação antiga gravando
    // as duas linhas direto no SQLite do binário empacotado — bypassando
    // a API removida, do mesmo jeito que os dados de uma instalação real já
    // existente chegariam — e confirma que o `GET /state` real (via HTTP,
    // passando pelo processo empacotado de verdade) continua respondendo
    // 200 depois de reler o log inteiro.
    console.log("[packaged-binary-smoke] releitura de eventos antigos de junção de mesas (PRD 2.6)...");
    await stopSidecar(child);
    const dbPath = path.join(dataDir, "tabwise.db");
    const groupId = randomUUID();
    const db = new DatabaseSync(dbPath);
    try {
      const insert = db.prepare(
        `INSERT INTO events (id, hlc, aggregate_type, aggregate_id, type, payload, operator_id, terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const legacyOperatorId = randomUUID();
      const legacyTerminalId = randomUUID();
      const baseTime = Date.now();
      insert.run(
        randomUUID(),
        serializeHlc(baseTime, 0),
        "table_group",
        groupId,
        "tables_grouped",
        JSON.stringify({ tableIds: [randomUUID(), randomUUID()] }),
        legacyOperatorId,
        legacyTerminalId,
        baseTime
      );
      insert.run(
        randomUUID(),
        serializeHlc(baseTime, 1),
        "table_group",
        groupId,
        "table_group_dissolved",
        JSON.stringify({}),
        legacyOperatorId,
        legacyTerminalId,
        baseTime
      );
    } finally {
      db.close();
    }

    child = spawnSidecar(dataDir);
    await waitForHealth();
    const stateRes = await fetch(`http://127.0.0.1:${PORT}/state`);
    assert.equal(stateRes.status, 200, `GET /state esperado 200, veio ${stateRes.status}`);
    const state = await stateRes.json();
    assert.ok(Array.isArray(state.orders), "GET /state deveria continuar devolvendo `orders` normalmente");
    assert.ok(Array.isArray(state.tableGroups), "GET /state deveria continuar devolvendo `tableGroups` (só projeção interna, sem UI)");
    assert.equal(
      state.tableGroups.some((g) => g.id === groupId),
      false,
      "grupo já dissolvido não deveria aparecer em tableGroups, mesmo lido via GET /state real"
    );

    console.log("[packaged-binary-smoke] TUDO OK — node:sqlite e a lógica de negócio completa funcionam no binário empacotado.");
  } finally {
    await stopSidecar(child);
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`[packaged-binary-smoke] aviso: não foi possível limpar ${dataDir} (${cleanupError.message}) — não afeta o resultado do teste.`);
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`[packaged-binary-smoke] FALHOU: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
);
