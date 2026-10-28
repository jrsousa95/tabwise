import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@tabwise/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents, DEFAULT_SERVICE_FEE_PERCENT } from "../src/reconciliation.js";

describe("projeção — configurações do estabelecimento (PRD 5.1)", () => {
  it("sem nenhum evento, o default é 10% (DEFAULT_SERVICE_FEE_PERCENT)", () => {
    const state = project([]);
    expect(state.establishment.defaultServiceFeePercent).toBe(DEFAULT_SERVICE_FEE_PERCENT);
    expect(DEFAULT_SERVICE_FEE_PERCENT).toBe(10);
  });

  it("establishment_settings_updated muda o default", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: serialize(tick(ZERO, 1000)),
      aggregateType: "establishment",
      aggregateId: "establishment",
      type: "establishment_settings_updated",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { defaultServiceFeePercent: 12.5 },
    };
    const state = project(sortEvents([event]));
    expect(state.establishment.defaultServiceFeePercent).toBe(12.5);
  });

  it("o evento mais recente vence (última configuração aplicada)", () => {
    const first: DomainEvent = {
      id: "ev-1",
      hlc: serialize(tick(ZERO, 1000)),
      aggregateType: "establishment",
      aggregateId: "establishment",
      type: "establishment_settings_updated",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { defaultServiceFeePercent: 5 },
    };
    const second: DomainEvent = {
      id: "ev-2",
      hlc: serialize(tick(ZERO, 2000)),
      aggregateType: "establishment",
      aggregateId: "establishment",
      type: "establishment_settings_updated",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 2000,
      payload: { defaultServiceFeePercent: 0 },
    };
    const state = project(sortEvents([first, second]));
    expect(state.establishment.defaultServiceFeePercent).toBe(0);
  });
});
