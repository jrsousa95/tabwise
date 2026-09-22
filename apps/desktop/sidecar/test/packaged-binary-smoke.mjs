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

async function main() {
  const dataDir = mkdtempSync(path.join(tmpdir(), "passa-a-regua-packaged-smoke-"));
  const child = spawn(exePath, [], {
    env: { ...process.env, PASSA_A_REGUA_PORT: String(PORT), PASSA_A_REGUA_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[sidecar stdout] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[sidecar stderr] ${d}`));

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

    console.log("[packaged-binary-smoke] junção de mesas: rejeição de sobreposição + desfazer (PRD 2.6)...");
    const tableA = await postJson("/tables", { identifier: "Mesa 10" });
    assert.equal(tableA.status, 201);
    const tableB = await postJson("/tables", { identifier: "Mesa 11" });
    assert.equal(tableB.status, 201);
    const tableC = await postJson("/tables", { identifier: "Mesa 12" });
    assert.equal(tableC.status, 201);

    const group = await postJson("/table-groups", { tableIds: [tableA.data.id, tableB.data.id] });
    assert.equal(group.status, 201, `esperado 201, veio ${group.status}: ${JSON.stringify(group.data)}`);

    const overlapping = await postJson("/table-groups", { tableIds: [tableB.data.id, tableC.data.id] });
    assert.equal(overlapping.status, 400, `esperado 400, veio ${overlapping.status}: ${JSON.stringify(overlapping.data)}`);
    assert.match(overlapping.data.error, /Mesa 10/, "mensagem de erro deveria citar a identificação da mesa do grupo existente");
    assert.match(overlapping.data.error, /Mesa 11/, "mensagem de erro deveria citar a identificação da mesa do grupo existente");

    const dissolve = await delJson(`/table-groups/${group.data.id}`);
    assert.equal(dissolve.status, 204, `esperado 204, veio ${dissolve.status}: ${JSON.stringify(dissolve.data)}`);

    const dissolveAgain = await delJson(`/table-groups/${group.data.id}`);
    assert.equal(dissolveAgain.status, 404, `esperado 404, veio ${dissolveAgain.status}: ${JSON.stringify(dissolveAgain.data)}`);

    const stateAfterDissolve = await getJson("/state");
    assert.equal(
      stateAfterDissolve.tableGroups.some((g) => g.id === group.data.id),
      false,
      "grupo desfeito não deveria mais aparecer em tableGroups"
    );

    console.log("[packaged-binary-smoke] TUDO OK — node:sqlite e a lógica de negócio completa funcionam no binário empacotado.");
  } finally {
    // No Windows real (achado no CI do M12), `child.kill()` não espera o SO
    // liberar o handle do arquivo do SQLite antes de retornar — apagar o
    // dataDir logo em seguida dá EPERM. Espera o processo terminar de
    // verdade antes de limpar; e a limpeza em si é best-effort (não deve
    // mascarar como falha um smoke test cujo teste de negócio já passou).
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", resolve);
      child.kill();
      setTimeout(resolve, 3000);
    });
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
