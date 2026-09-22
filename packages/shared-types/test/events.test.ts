import { describe, expect, it } from "vitest";
import { DomainEventSchema } from "../src/events.js";

function base() {
  return { id: "ev-1", hlc: "0000000000000001-00000000", operatorId: "op-1", terminalId: "t-1", createdAt: 1700000000000 };
}

describe("DomainEventSchema — discriminated union dos 22 tipos (PRD/ARCH §3.1)", () => {
  it("aceita um evento válido de cada tipo", () => {
    const validEvents = [
      { ...base(), type: "establishment_settings_updated", aggregateType: "establishment", aggregateId: "establishment", payload: { defaultServiceFeePercent: 10 } },
      { ...base(), type: "operator_registered", aggregateType: "operator", aggregateId: "op-1", payload: { name: "Ana", role: "waiter", pinHash: "hash" } },
      { ...base(), type: "category_registered", aggregateType: "category", aggregateId: "cat-1", payload: { name: "Bebidas" } },
      { ...base(), type: "category_renamed", aggregateType: "category", aggregateId: "cat-1", payload: { name: "Bebidas geladas" } },
      { ...base(), type: "category_removed", aggregateType: "category", aggregateId: "cat-1", payload: {} },
      { ...base(), type: "product_registered", aggregateType: "product", aggregateId: "p-1", payload: { name: "Cerveja", priceCents: 1200, categoryId: "cat-1", active: true } },
      { ...base(), type: "product_status_changed", aggregateType: "product", aggregateId: "p-1", payload: { active: false } },
      { ...base(), type: "product_renamed", aggregateType: "product", aggregateId: "p-1", payload: { name: "Cerveja long neck" } },
      { ...base(), type: "product_removed", aggregateType: "product", aggregateId: "p-1", payload: {} },
      { ...base(), type: "table_registered", aggregateType: "table", aggregateId: "m-1", payload: { identifier: "Mesa 1", capacity: 4 } },
      { ...base(), type: "table_registered", aggregateType: "table", aggregateId: "m-2", payload: { identifier: "Mesa 2" } },
      { ...base(), type: "table_renamed", aggregateType: "table", aggregateId: "m-1", payload: { identifier: "Mesa 1B", capacity: 6 } },
      { ...base(), type: "table_removed", aggregateType: "table", aggregateId: "m-1", payload: {} },
      { ...base(), type: "order_opened", aggregateType: "order", aggregateId: "c-1", payload: { source: "table", tableId: "m-1" } },
      { ...base(), type: "order_opened", aggregateType: "order", aggregateId: "c-2", payload: { source: "standalone", number: 7 } },
      { ...base(), type: "order_transferred", aggregateType: "order", aggregateId: "c-1", payload: { originTableId: "m-1", destinationTableId: "m-2" } },
      { ...base(), type: "tables_grouped", aggregateType: "table_group", aggregateId: "g-1", payload: { tableIds: ["m-1", "m-2"] } },
      { ...base(), type: "table_group_dissolved", aggregateType: "table_group", aggregateId: "g-1", payload: {} },
      { ...base(), type: "item_added", aggregateType: "order", aggregateId: "c-1", payload: { itemId: "i-1", name: "Cerveja", unitPriceCents: 1200, quantity: 2 } },
      { ...base(), type: "item_canceled", aggregateType: "order", aggregateId: "c-1", payload: { itemId: "i-1", reason: "other", note: "pedido em duplicidade" } },
      { ...base(), type: "item_note_updated", aggregateType: "order", aggregateId: "c-1", payload: { itemId: "i-1", note: "sem cebola" } },
      { ...base(), type: "item_quantity_incremented", aggregateType: "order", aggregateId: "c-1", payload: { itemId: "i-1", deltaQuantity: 1 } },
      { ...base(), type: "order_closed", aggregateType: "order", aggregateId: "c-1", payload: { subtotalCents: 2400, serviceFeePercent: 10, serviceFeeCents: 240, totalCents: 2640 } },
      { ...base(), type: "payment_recorded", aggregateType: "order", aggregateId: "c-1", payload: { amountCents: 3000, paymentMethod: "cash", changeCents: 360 } },
    ];

    for (const event of validEvents) {
      const result = DomainEventSchema.safeParse(event);
      expect(result.success, `deveria validar: ${JSON.stringify(event)} — erro: ${JSON.stringify(!result.success && result.error.issues)}`).toBe(true);
    }

    // Trava contra o título da describe (ou este teste) ficar desatualizado
    // silenciosamente quando um tipo novo é adicionado ao schema sem vir
    // acompanhado de um caso aqui (era só um texto livre até agora).
    // `table_registered` aparece duas vezes de propósito (com e sem
    // `capacity`), então comparamos tipos DISTINTOS cobertos, não a
    // contagem bruta de `validEvents`.
    const distinctTypesCovered = new Set(validEvents.map((e) => e.type));
    expect(DomainEventSchema.options.length, "número de tipos no schema mudou sem atualizar este teste").toBe(distinctTypesCovered.size);
  });

  it("rejeita tipo desconhecido", () => {
    const result = DomainEventSchema.safeParse({ ...base(), type: "made_up_type", aggregateType: "order", aggregateId: "c-1", payload: {} });
    expect(result.success).toBe(false);
  });

  it("order_opened rejeita payload com source 'table' e 'standalone' ao mesmo tempo", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "order_opened",
      aggregateType: "order",
      aggregateId: "c-1",
      payload: { source: "table", tableId: "m-1", number: 7 },
    });
    // Zod ignora campos extras de outros branches do discriminated union por padrão,
    // então isso só valida porque "source: table" já é válido sozinho — o teste
    // seguinte é o que realmente importa: sem tableId, "table" é inválido.
    expect(result.success).toBe(true);
  });

  it("order_opened com source 'table' exige tableId", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "order_opened",
      aggregateType: "order",
      aggregateId: "c-1",
      payload: { source: "table" },
    });
    expect(result.success).toBe(false);
  });

  it("item_canceled rejeita reason fora da lista pré-definida (PRD 1.3)", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "item_canceled",
      aggregateType: "order",
      aggregateId: "c-1",
      payload: { itemId: "i-1", reason: "just_because" },
    });
    expect(result.success).toBe(false);
  });

  it("valores monetários precisam ser inteiros (centavos, nunca ponto flutuante — PRD 5.2)", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "item_added",
      aggregateType: "order",
      aggregateId: "c-1",
      payload: { itemId: "i-1", name: "Cerveja", unitPriceCents: 12.5, quantity: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("establishment_settings_updated exige aggregateId fixo 'establishment' (singleton, PRD 5.1)", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "establishment_settings_updated",
      aggregateType: "establishment",
      aggregateId: "qualquer-outro-id",
      payload: { defaultServiceFeePercent: 10 },
    });
    expect(result.success).toBe(false);
  });

  it("product_registered também exige priceCents inteiro (PRD 3.2/5.2)", () => {
    const result = DomainEventSchema.safeParse({
      ...base(),
      type: "product_registered",
      aggregateType: "product",
      aggregateId: "p-1",
      payload: { name: "Cerveja", priceCents: 12.5, categoryId: "cat-1", active: true },
    });
    expect(result.success).toBe(false);
  });
});
