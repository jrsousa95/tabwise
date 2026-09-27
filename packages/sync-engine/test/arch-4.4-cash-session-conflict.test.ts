import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { merge, project, sortEvents } from "../src/reconciliation.js";

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — dois terminais offline, sem se
 * enxergar na LAN, abrem sessão de caixa quase ao mesmo tempo. Mesma regra
 * do ARCH §4.2 (menor HLC vence, a outra é mesclada e gera um aviso não
 * bloqueante), mas o invariante é do ESTABELECIMENTO inteiro — 1 slot
 * global, não um `Map` por chave como o conflito de mesa. Espelha
 * `arch-4.2-table-conflict.test.ts`.
 */
describe("ARCH §4.4 — duas sessões de caixa abertas concorrentemente", () => {
  it("a sessão de menor HLC é a canônica; a outra é mesclada (mergedInto) e gera aviso não bloqueante", () => {
    const clockT1Open = tick(ZERO, 1000);
    const sessionOpenedT1: DomainEvent = {
      id: "ev-1",
      hlc: serialize(clockT1Open),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 1000,
      payload: { openingAmountCents: 5000 },
    };

    const clockT2Open = tick(ZERO, 2000);
    const sessionOpenedT2: DomainEvent = {
      id: "ev-2",
      hlc: serialize(clockT2Open),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_session_opened",
      terminalId: "T2",
      operatorId: "owner-1",
      createdAt: 2000,
      payload: { openingAmountCents: 8000 },
    };

    const logT1 = [sessionOpenedT1];
    const logT2 = [sessionOpenedT2];
    const state = project(merge(logT1, logT2));

    const canonical = state.cashSessions.find((s) => s.id === "session-A");
    const losing = state.cashSessions.find((s) => s.id === "session-B");
    expect(canonical).toBeDefined();
    expect(losing).toBeDefined();

    expect(canonical!.mergedInto).toBeUndefined();
    expect(canonical!.status).toBe("open");
    expect(losing!.mergedInto).toBe("session-A");

    expect(state.cashSessionMergeWarnings).toEqual([
      { losingSession: "session-B", canonicalSession: "session-A", createdAt: 2000 },
    ]);

    // A ordem em que os dois logs chegam pra merge não pode importar
    // (comutatividade — mesmo princípio do ARCH §4.2 pra mesas).
    expect(project(merge(logT2, logT1))).toEqual(state);
  });

  it("uma única sessão aberta não gera conflito nenhum", () => {
    const opened: DomainEvent = {
      id: "ev-1",
      hlc: serialize(tick(ZERO, 1000)),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 1000,
      payload: { openingAmountCents: 5000 },
    };

    const state = project(merge([opened], []));
    expect(state.cashSessions).toEqual([
      {
        id: "session-A",
        status: "open",
        openedByTerminalId: "T1",
        openedByOperatorId: "cashier-1",
        openingAmountCents: 5000,
        openedAt: 1000,
        mergedInto: undefined,
        withdrawals: [],
        deposits: [],
        closing: undefined,
      },
    ]);
    expect(state.cashSessionMergeWarnings).toEqual([]);
  });

  it("três sessões concorrentes: só a de menor HLC é canônica, as outras duas mesclam nela", () => {
    const events: DomainEvent[] = [
      {
        id: "ev-1",
        hlc: serialize(tick(ZERO, 3000)),
        aggregateType: "cash_session",
        aggregateId: "session-late",
        type: "cash_session_opened",
        terminalId: "T3",
        operatorId: "cashier-3",
        createdAt: 3000,
        payload: { openingAmountCents: 1000 },
      },
      {
        id: "ev-2",
        hlc: serialize(tick(ZERO, 1000)),
        aggregateType: "cash_session",
        aggregateId: "session-earliest",
        type: "cash_session_opened",
        terminalId: "T1",
        operatorId: "cashier-1",
        createdAt: 1000,
        payload: { openingAmountCents: 5000 },
      },
      {
        id: "ev-3",
        hlc: serialize(tick(ZERO, 2000)),
        aggregateType: "cash_session",
        aggregateId: "session-mid",
        type: "cash_session_opened",
        terminalId: "T2",
        operatorId: "owner-1",
        createdAt: 2000,
        payload: { openingAmountCents: 8000 },
      },
    ];

    const state = project(merge(events, []));
    const canonical = state.cashSessions.find((s) => s.id === "session-earliest");
    expect(canonical!.mergedInto).toBeUndefined();
    expect(state.cashSessions.find((s) => s.id === "session-mid")!.mergedInto).toBe("session-earliest");
    expect(state.cashSessions.find((s) => s.id === "session-late")!.mergedInto).toBe("session-earliest");
    expect(state.cashSessionMergeWarnings.map((w) => w.losingSession).sort()).toEqual(["session-late", "session-mid"]);
  });

  /**
   * Épico 1 (Sessão de Caixa), Story 1.2 — Reatribuição histórica: uma
   * sangria (`cash_withdrawal_recorded`) gravada num terminal offline contra
   * a sessão que ERA a canônica local naquele momento, mas que perde o
   * conflito de abertura concorrente depois de sincronizar, precisa aparecer
   * em `withdrawals` da sessão que realmente venceu — nunca fica "perdida"
   * na perdedora. Espelha o teste equivalente de `item_added` em
   * `arch-4.2-table-conflict.test.ts`.
   */
  it("sangria registrada contra sessão que depois perde o conflito de abertura é reatribuída à canônica", () => {
    // T1 abre sessão-B (HLC maior, vai perder) e já registra uma sangria contra ela.
    const clockT1Open = tick(ZERO, 2000);
    const sessionOpenedT1: DomainEvent = {
      id: "ev-1",
      hlc: serialize(clockT1Open),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 2000,
      payload: { openingAmountCents: 5000 },
    };
    const withdrawalAgainstB: DomainEvent = {
      id: "ev-2",
      hlc: serialize(tick(clockT1Open, 2500)),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_withdrawal_recorded",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 2500,
      payload: { amountCents: 1500, reason: "reforço de troco pro cofre" },
    };

    // T2 abre sessão-A (HLC menor, vai vencer e virar a canônica).
    const clockT2Open = tick(ZERO, 1000);
    const sessionOpenedT2: DomainEvent = {
      id: "ev-3",
      hlc: serialize(clockT2Open),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_opened",
      terminalId: "T2",
      operatorId: "owner-1",
      createdAt: 1000,
      payload: { openingAmountCents: 8000 },
    };

    const logT1 = [sessionOpenedT1, withdrawalAgainstB];
    const logT2 = [sessionOpenedT2];
    const state = project(merge(logT1, logT2));

    const canonical = state.cashSessions.find((s) => s.id === "session-A");
    const losing = state.cashSessions.find((s) => s.id === "session-B");
    expect(canonical!.mergedInto).toBeUndefined();
    expect(losing!.mergedInto).toBe("session-A");

    // A sangria "some" da perdedora e aparece na canônica de verdade.
    expect(losing!.withdrawals).toEqual([]);
    expect(canonical!.withdrawals).toEqual([
      { id: "ev-2", amountCents: 1500, reason: "reforço de troco pro cofre", recordedAt: 2500, operatorId: "cashier-1" },
    ]);

    // Ordem de merge não pode importar.
    expect(project(merge(logT2, logT1))).toEqual(state);
  });

  /**
   * Épico 1 (Sessão de Caixa), Story 1.3 — Reatribuição histórica, espelho
   * exato do teste de sangria acima: um suprimento (`cash_deposit_recorded`)
   * gravado num terminal offline contra a sessão que ERA a canônica local
   * naquele momento, mas que perde o conflito de abertura concorrente depois
   * de sincronizar, precisa aparecer em `deposits` da sessão que realmente
   * venceu — nunca fica "perdido" na perdedora.
   */
  it("suprimento registrado contra sessão que depois perde o conflito de abertura é reatribuído à canônica", () => {
    // T1 abre sessão-B (HLC maior, vai perder) e já registra um suprimento contra ela.
    const clockT1Open = tick(ZERO, 2000);
    const sessionOpenedT1: DomainEvent = {
      id: "ev-1",
      hlc: serialize(clockT1Open),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 2000,
      payload: { openingAmountCents: 5000 },
    };
    const depositAgainstB: DomainEvent = {
      id: "ev-2",
      hlc: serialize(tick(clockT1Open, 2500)),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_deposit_recorded",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 2500,
      payload: { amountCents: 5000, reason: "reposição de troco" },
    };

    // T2 abre sessão-A (HLC menor, vai vencer e virar a canônica).
    const clockT2Open = tick(ZERO, 1000);
    const sessionOpenedT2: DomainEvent = {
      id: "ev-3",
      hlc: serialize(clockT2Open),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_opened",
      terminalId: "T2",
      operatorId: "owner-1",
      createdAt: 1000,
      payload: { openingAmountCents: 8000 },
    };

    const logT1 = [sessionOpenedT1, depositAgainstB];
    const logT2 = [sessionOpenedT2];
    const state = project(merge(logT1, logT2));

    const canonical = state.cashSessions.find((s) => s.id === "session-A");
    const losing = state.cashSessions.find((s) => s.id === "session-B");
    expect(canonical!.mergedInto).toBeUndefined();
    expect(losing!.mergedInto).toBe("session-A");

    // O suprimento "some" da perdedora e aparece na canônica de verdade.
    expect(losing!.deposits).toEqual([]);
    expect(canonical!.deposits).toEqual([
      { id: "ev-2", amountCents: 5000, reason: "reposição de troco", recordedAt: 2500, operatorId: "cashier-1" },
    ]);

    // Ordem de merge não pode importar.
    expect(project(merge(logT2, logT1))).toEqual(state);
  });

  /**
   * Épico 1 (Sessão de Caixa), Story 1.4 — regressão do bug real já
   * corrigido pra mesa (`order_closed` limpando `tableToCanonicalOrder`,
   * comentário em `reconciliation.ts`, achado real 2026-09-23). Fechar uma
   * sessão de caixa TEM que liberar `canonicalOpenCashSession` — sem isso, a
   * PRÓXIMA sessão aberta seria tratada como conflito falso contra esta já
   * fechada. Espelha `"reabrir a mesma mesa depois de fechar a comanda
   * anterior NÃO é conflito"` em `arch-4.2-table-conflict.test.ts`.
   */
  it("reabrir uma sessão depois de fechar a anterior NÃO gera conflito (slot canônico liberado)", () => {
    const openA: DomainEvent = {
      id: "ev-open-a",
      hlc: serialize(tick(ZERO, 1000)),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 1000,
      payload: { openingAmountCents: 5000 },
    };
    const closeA: DomainEvent = {
      id: "ev-close-a",
      hlc: serialize(tick(ZERO, 2000)),
      aggregateType: "cash_session",
      aggregateId: "session-A",
      type: "cash_session_closed",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 2000,
      payload: { countedAmountCents: 5000 },
    };
    // Bem depois, mesmo terminal — segunda sessão do dia.
    const openB: DomainEvent = {
      id: "ev-open-b",
      hlc: serialize(tick(ZERO, 3000)),
      aggregateType: "cash_session",
      aggregateId: "session-B",
      type: "cash_session_opened",
      terminalId: "T1",
      operatorId: "cashier-1",
      createdAt: 3000,
      payload: { openingAmountCents: 3000 },
    };

    const state = project(sortEvents([openA, closeA, openB]));

    const sessionA = state.cashSessions.find((s) => s.id === "session-A");
    const sessionB = state.cashSessions.find((s) => s.id === "session-B");
    expect(sessionA?.status).toBe("closed");
    expect(sessionA?.closing).toEqual({ countedAmountCents: 5000, closedAt: 2000, closedByOperatorId: "cashier-1" });
    expect(sessionB?.status).toBe("open");
    expect(sessionB?.mergedInto).toBeUndefined(); // não pode ser mesclada na sessão velha já fechada
    expect(state.cashSessionMergeWarnings).toEqual([]); // nenhum conflito de verdade aconteceu
  });
});
