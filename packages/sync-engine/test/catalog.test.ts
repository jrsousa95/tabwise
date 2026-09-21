import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@passa-a-regua/shared-types";
import { serialize, tick, ZERO } from "../src/hlc.js";
import { project, sortEvents } from "../src/reconciliation.js";

let counter = 0;
function newHlc(wall: number) {
  return serialize(tick(ZERO, wall + counter++));
}

describe("projeção — catálogo (categorias e produtos, PRD Épico 3/M4)", () => {
  it("category_registered materializa em `categories`", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "category",
      aggregateId: "cat-1",
      type: "category_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { name: "Bebidas" },
    };
    const state = project(sortEvents([event]));
    expect(state.categories).toEqual([{ id: "cat-1", name: "Bebidas" }]);
  });

  it("product_registered materializa em `products`", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "product",
      aggregateId: "p-1",
      type: "product_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { name: "Cerveja", priceCents: 1200, categoryId: "cat-1", active: true },
    };
    const state = project(sortEvents([event]));
    expect(state.products).toEqual([{ id: "p-1", name: "Cerveja", priceCents: 1200, categoryId: "cat-1", active: true }]);
  });

  it("product_status_changed atualiza `active` sem mexer no resto do produto (PRD 3.2)", () => {
    const registered: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "product",
      aggregateId: "p-1",
      type: "product_registered",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { name: "Cerveja", priceCents: 1200, categoryId: "cat-1", active: true },
    };
    const deactivated: DomainEvent = {
      id: "ev-2",
      hlc: newHlc(1000),
      aggregateType: "product",
      aggregateId: "p-1",
      type: "product_status_changed",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { active: false },
    };

    const state = project(sortEvents([registered, deactivated]));
    expect(state.products).toEqual([{ id: "p-1", name: "Cerveja", priceCents: 1200, categoryId: "cat-1", active: false }]);
  });

  it("product_status_changed pra um produto inexistente não quebra a projeção (evento fora de ordem/corrompido)", () => {
    const event: DomainEvent = {
      id: "ev-1",
      hlc: newHlc(1000),
      aggregateType: "product",
      aggregateId: "produto-que-nao-existe",
      type: "product_status_changed",
      terminalId: "T1",
      operatorId: "op-1",
      createdAt: 1000,
      payload: { active: false },
    };
    expect(() => project(sortEvents([event]))).not.toThrow();
    expect(project(sortEvents([event])).products).toEqual([]);
  });
});
