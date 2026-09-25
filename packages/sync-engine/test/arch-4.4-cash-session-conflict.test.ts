import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { merge, project } from "../src/reconciliation.js";

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
});
