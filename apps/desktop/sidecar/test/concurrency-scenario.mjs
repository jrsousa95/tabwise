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

/** Espelha `postJson` acima, mas pra GET — precisa do status pra validar bloqueio de papel/invariante (Story 1.4). */
async function getJsonStatus(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
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

    // === Cenário 4 (Épico 1 / Stories 1.1-1.4): sessão de caixa —
    // validações num terminal só (papel, valor inválido) + conflito de
    // abertura concorrente entre A e B (mesma regra do §4.2, mas pro slot
    // global do estabelecimento, não por mesa) + sangria/suprimento +
    // fechamento com conferência (preview, diferença não bloqueia,
    // reabertura pós-fechamento sem conflito falso). Precisa rodar ANTES do
    // Cenário 3 (que derruba o terminal A). ===
    log("CENÁRIO 4: sessão de caixa — validações, conflito de abertura e fechamento com conferência...");

    log("cadastrando um garçom em A (pra testar o bloqueio de papel)...");
    await postJson(PORT_A, "/operators", { name: "Wagner", role: "waiter", pin: "9999" });
    await postJson(PORT_A, "/session/login", { pin: "9999" });
    const waiterBlocked = await postJson(PORT_A, "/cash-sessions", { openingAmountCents: 5000 });
    assert.equal(waiterBlocked.status, 403, "garçom não pode abrir sessão de caixa");
    assert.equal(
      (await getJson(PORT_A, "/state")).cashSessions.length,
      0,
      "bloqueio de garçom não pode gravar nenhum cash_session_opened"
    );

    // Épico 1, Story 1.2 — garçom também não pode registrar sangria.
    log("garçom também não pode registrar sangria...");
    const waiterWithdrawalBlocked = await postJson(PORT_A, "/cash-sessions/withdrawals", { amountCents: 1000, reason: "teste" });
    assert.equal(waiterWithdrawalBlocked.status, 403, "garçom não pode registrar sangria");

    // Épico 1, Story 1.3 — garçom também não pode registrar suprimento.
    log("garçom também não pode registrar suprimento...");
    const waiterDepositBlocked = await postJson(PORT_A, "/cash-sessions/deposits", { amountCents: 1000, reason: "teste" });
    assert.equal(waiterDepositBlocked.status, 403, "garçom não pode registrar suprimento");

    await postJson(PORT_A, "/session/login", { pin: "1234" }); // volta a sessão de A pra Ana (dono)

    log("valor de abertura inválido é rejeitado...");
    const invalidAmount = await postJson(PORT_A, "/cash-sessions", { openingAmountCents: 0 });
    assert.equal(invalidAmount.status, 400, "valor de abertura zero/negativo precisa ser rejeitado");

    // Épico 1, Story 1.2 — sangria bloqueada sem nenhuma sessão de caixa aberta ainda.
    log("sangria sem sessão de caixa aberta é bloqueada...");
    const withdrawalNoSession = await postJson(PORT_A, "/cash-sessions/withdrawals", { amountCents: 1000, reason: "teste sem sessão" });
    assert.equal(withdrawalNoSession.status, 400, "sangria sem sessão de caixa aberta precisa ser bloqueada");

    // Épico 1, Story 1.3 — suprimento bloqueado sem nenhuma sessão de caixa aberta ainda.
    log("suprimento sem sessão de caixa aberta é bloqueado...");
    const depositNoSession = await postJson(PORT_A, "/cash-sessions/deposits", { amountCents: 1000, reason: "teste sem sessão" });
    assert.equal(depositNoSession.status, 400, "suprimento sem sessão de caixa aberta precisa ser bloqueado");

    log("A e B abrem sessão de caixa simultaneamente, sem se enxergar ainda...");
    const [sessionFromA, sessionFromB] = await Promise.all([
      postJson(PORT_A, "/cash-sessions", { openingAmountCents: 5000 }),
      postJson(PORT_B, "/cash-sessions", { openingAmountCents: 8000 }),
    ]);
    assert.equal(sessionFromA.status, 201, "A deveria conseguir abrir sua sessão (não viu a de B ainda)");
    assert.equal(sessionFromB.status, 201, "B deveria conseguir abrir sua sessão (não viu a de A ainda)");
    const sessionIdA = sessionFromA.data.id;
    const sessionIdB = sessionFromB.data.id;
    assert.notEqual(sessionIdA, sessionIdB, "as duas sessões precisam ter ids diferentes");

    log("esperando o sync LAN convergir e mesclar automaticamente...");
    await waitUntil(
      async () => {
        const state = await getJson(PORT_A, "/state");
        const a = state.cashSessions.find((s) => s.id === sessionIdA);
        const b = state.cashSessions.find((s) => s.id === sessionIdB);
        return a && b && (a.mergedInto !== undefined || b.mergedInto !== undefined);
      },
      { description: "merge automático de sessão de caixa acontecer em A", timeoutMs: 20000 }
    );

    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const a = state.cashSessions.find((s) => s.id === sessionIdA);
      const b = state.cashSessions.find((s) => s.id === sessionIdB);
      assert.ok(a && b, `terminal na porta ${port} precisa conhecer as duas sessões depois do sync`);
      const canonical = a.mergedInto === undefined ? a : b;
      const losing = a.mergedInto === undefined ? b : a;
      assert.equal(losing.mergedInto, canonical.id, `terminal ${port}: a sessão perdedora precisa apontar pra canônica`);
      assert.equal(canonical.status, "open", `terminal ${port}: a canônica precisa continuar aberta`);
      assert.ok(
        state.cashSessionMergeWarnings.some((w) => w.losingSession === losing.id && w.canonicalSession === canonical.id),
        `terminal ${port}: precisa ter o aviso de conflito de sessão de caixa`
      );
    }

    log("depois do conflito resolvido, tentar abrir MAIS uma sessão é bloqueado (já existe uma canônica aberta)...");
    const alreadyOpen = await postJson(PORT_A, "/cash-sessions", { openingAmountCents: 1000 });
    assert.equal(alreadyOpen.status, 400, "não pode abrir uma segunda sessão com uma já aberta (canônica)");

    // Épico 1, Story 1.2 — valor inválido e motivo vazio são rejeitados no nível de rota
    // (mesmo padrão já usado pra abertura de sessão — achado na auditoria da matriz I/O:
    // a Story 1.1 testou "valor inválido" no nível de rota, esta story precisa do mesmo).
    log("sangria com valor inválido é rejeitada...");
    const invalidWithdrawalAmount = await postJson(PORT_A, "/cash-sessions/withdrawals", { amountCents: 0, reason: "motivo válido" });
    assert.equal(invalidWithdrawalAmount.status, 400, "valor de sangria zero/negativo precisa ser rejeitado");

    log("sangria com motivo vazio é rejeitada...");
    const emptyReason = await postJson(PORT_A, "/cash-sessions/withdrawals", { amountCents: 1000, reason: "   " });
    assert.equal(emptyReason.status, 400, "motivo vazio (só espaços) precisa ser rejeitado");

    // Épico 1, Story 1.3 — mesmas validações de valor/motivo, agora pra suprimento.
    log("suprimento com valor inválido é rejeitado...");
    const invalidDepositAmount = await postJson(PORT_A, "/cash-sessions/deposits", { amountCents: 0, reason: "motivo válido" });
    assert.equal(invalidDepositAmount.status, 400, "valor de suprimento zero/negativo precisa ser rejeitado");

    log("suprimento com motivo vazio é rejeitado...");
    const emptyDepositReason = await postJson(PORT_A, "/cash-sessions/deposits", { amountCents: 1000, reason: "   " });
    assert.equal(emptyDepositReason.status, 400, "motivo vazio (só espaços) precisa ser rejeitado no suprimento");

    // Épico 1, Story 1.2 — registro normal de sangria contra a sessão canônica já resolvida.
    log("registrando uma sangria normal contra a sessão canônica...");
    const canonicalCashSession = (await getJson(PORT_A, "/state")).cashSessions.find((s) => s.mergedInto === undefined && s.status === "open");
    assert.ok(canonicalCashSession, "precisa existir uma sessão de caixa canônica aberta neste ponto do cenário");
    const canonicalSessionId = canonicalCashSession.id;
    const withdrawal = await postJson(PORT_A, "/cash-sessions/withdrawals", { amountCents: 2000, reason: "reforço de troco pro cofre" });
    assert.equal(withdrawal.status, 201, "sangria válida contra sessão aberta precisa ser aceita");

    await waitUntil(
      async () => {
        const state = await getJson(PORT_B, "/state");
        const canonical = state.cashSessions.find((s) => s.id === canonicalSessionId);
        return canonical && canonical.withdrawals.some((w) => w.amountCents === 2000 && w.reason === "reforço de troco pro cofre");
      },
      { description: "sangria propagar de A pra B" }
    );

    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const canonical = state.cashSessions.find((s) => s.id === canonicalSessionId);
      assert.ok(
        canonical && canonical.withdrawals.some((w) => w.amountCents === 2000 && w.reason === "reforço de troco pro cofre"),
        `terminal ${port}: a sangria precisa aparecer em withdrawals da sessão canônica`
      );
    }

    // Épico 1, Story 1.3 — registro normal de suprimento contra a mesma sessão canônica.
    log("registrando um suprimento normal contra a sessão canônica...");
    const deposit = await postJson(PORT_A, "/cash-sessions/deposits", { amountCents: 5000, reason: "reposição de troco" });
    assert.equal(deposit.status, 201, "suprimento válido contra sessão aberta precisa ser aceito");

    await waitUntil(
      async () => {
        const state = await getJson(PORT_B, "/state");
        const canonical = state.cashSessions.find((s) => s.id === canonicalSessionId);
        return canonical && canonical.deposits.some((d) => d.amountCents === 5000 && d.reason === "reposição de troco");
      },
      { description: "suprimento propagar de A pra B" }
    );

    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const canonical = state.cashSessions.find((s) => s.id === canonicalSessionId);
      assert.ok(
        canonical && canonical.deposits.some((d) => d.amountCents === 5000 && d.reason === "reposição de troco"),
        `terminal ${port}: o suprimento precisa aparecer em deposits da sessão canônica`
      );
    }

    // Épico 1, Story 1.4 — fechamento com conferência. Continua no MESMO
    // terminal A, contra a mesma sessão canônica já usada acima pra
    // sangria/suprimento (ainda precisa rodar ANTES do Cenário 3, que
    // derruba A).
    log("garçom não pode ver o preview do valor esperado nem fechar a sessão...");
    await postJson(PORT_A, "/session/login", { pin: "9999" }); // Wagner, garçom
    const waiterPreviewBlocked = await getJsonStatus(PORT_A, "/cash-sessions/expected");
    assert.equal(waiterPreviewBlocked.status, 403, "garçom não pode ver o preview do valor esperado");
    const waiterCloseBlocked = await postJson(PORT_A, "/cash-sessions/close", { countedAmountCents: 1000 });
    assert.equal(waiterCloseBlocked.status, 403, "garçom não pode fechar sessão de caixa");
    await postJson(PORT_A, "/session/login", { pin: "1234" }); // volta a sessão de A pra Ana (dono)

    log("preview do valor esperado antes de pedir o valor contado...");
    const preview = await getJsonStatus(PORT_A, "/cash-sessions/expected");
    assert.equal(preview.status, 200, "preview do valor esperado precisa funcionar com sessão aberta");
    const expectedAmountCents = preview.data.expectedAmountCents;
    assert.equal(typeof expectedAmountCents, "number", "preview precisa devolver expectedAmountCents numérico");

    log("valor contado inválido (negativo) é rejeitado no fechamento...");
    const invalidCountedAmount = await postJson(PORT_A, "/cash-sessions/close", { countedAmountCents: -100 });
    assert.equal(invalidCountedAmount.status, 400, "valor contado negativo precisa ser rejeitado");

    log("fechando a sessão com um valor contado diferente do esperado (sobra não bloqueia o fechamento)...");
    const countedAmountCents = expectedAmountCents + 700;
    const closeResult = await postJson(PORT_A, "/cash-sessions/close", { countedAmountCents });
    assert.equal(closeResult.status, 201, "fechamento com diferença ≠ 0 precisa ser aceito normalmente");
    assert.equal(closeResult.data.countedAmountCents, countedAmountCents, "countedAmountCents devolvido precisa bater com o enviado");
    assert.equal(closeResult.data.expectedAmountCents, expectedAmountCents, "expectedAmountCents devolvido no fechamento precisa bater com o preview");
    assert.equal(closeResult.data.differenceCents, 700, "diferença precisa ser (contado - esperado)");

    log("depois de fechada, a sessão vira 'closed' nos dois terminais...");
    await waitUntil(
      async () => {
        const state = await getJson(PORT_B, "/state");
        const closed = state.cashSessions.find((s) => s.id === canonicalSessionId);
        return closed && closed.status === "closed";
      },
      { description: "fechamento propagar de A pra B" }
    );
    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const closed = state.cashSessions.find((s) => s.id === canonicalSessionId);
      assert.ok(closed, `terminal ${port}: sessão fechada precisa continuar conhecida`);
      assert.equal(closed.status, "closed", `terminal ${port}: sessão precisa estar 'closed'`);
      assert.equal(closed.closing.countedAmountCents, countedAmountCents, `terminal ${port}: countedAmountCents gravado precisa bater`);
    }

    log("preview de uma sessão já fechada via ?sessionId= (histórico de 'Sessões encerradas')...");
    const closedSessionPreview = await getJsonStatus(PORT_A, `/cash-sessions/expected?sessionId=${canonicalSessionId}`);
    assert.equal(closedSessionPreview.status, 200, "preview por sessionId de sessão já fechada precisa funcionar");
    assert.equal(
      closedSessionPreview.data.expectedAmountCents,
      expectedAmountCents,
      "preview recalculado da sessão fechada precisa bater com o valor esperado no momento do fechamento (sem venda tardia)"
    );
    const bogusSessionPreview = await getJsonStatus(PORT_A, "/cash-sessions/expected?sessionId=id-inexistente");
    assert.equal(bogusSessionPreview.status, 400, "preview por sessionId desconhecido precisa ser rejeitado");

    log("sem nenhuma sessão aberta, preview e fechamento são bloqueados...");
    const previewNoSession = await getJsonStatus(PORT_A, "/cash-sessions/expected");
    assert.equal(previewNoSession.status, 400, "preview sem sessão de caixa aberta precisa ser bloqueado");
    const closeNoSession = await postJson(PORT_A, "/cash-sessions/close", { countedAmountCents: 1000 });
    assert.equal(closeNoSession.status, 400, "fechamento sem sessão de caixa aberta precisa ser bloqueado");

    log("reabrir uma sessão nova depois de fechar a anterior NÃO gera conflito falso (slot canônico liberado)...");
    const reopened = await postJson(PORT_A, "/cash-sessions", { openingAmountCents: 4000 });
    assert.equal(reopened.status, 201, "reabrir depois de fechar a sessão anterior precisa funcionar normalmente");
    await waitUntil(
      async () => {
        const state = await getJson(PORT_B, "/state");
        return state.cashSessions.some((s) => s.id === reopened.data.id);
      },
      { description: "sessão reaberta propagar de A pra B" }
    );
    for (const port of [PORT_A, PORT_B]) {
      const state = await getJson(port, "/state");
      const newSession = state.cashSessions.find((s) => s.id === reopened.data.id);
      assert.ok(newSession, `terminal ${port}: sessão reaberta precisa ser conhecida`);
      assert.equal(newSession.status, "open", `terminal ${port}: sessão reaberta precisa estar aberta`);
      assert.equal(newSession.mergedInto, undefined, `terminal ${port}: reabertura NÃO pode ser tratada como conflito contra a sessão já fechada`);
      assert.ok(
        !state.cashSessionMergeWarnings.some((w) => w.losingSession === reopened.data.id),
        `terminal ${port}: reabertura pós-fechamento não pode gerar aviso de conflito`
      );
    }

    log("CENÁRIO 4 OK — validações de sessão de caixa e conflito de abertura resolvidos corretamente.");

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
