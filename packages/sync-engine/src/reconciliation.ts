import type { DomainEvent, PaymentMethod, CancelReason, OrderOrigin, OperatorRole } from "@passa-a-regua/shared-types";
import { compareSerialized } from "./hlc.js";

/** Ordem total determinística: por HLC e, em empate, por id do evento. */
export function sortEvents(events: readonly DomainEvent[]): DomainEvent[] {
  return [...events].sort((a, b) => compareSerialized(a.hlc, b.hlc) || compareText(a.id, b.id));
}

/**
 * Mescla dois logs de eventos: dedupe por `id` (reaplicar o mesmo evento é
 * seguro — ARCH §4.3) e reordena por HLC. Por construção:
 *   - merge(A, A) tem o mesmo conteúdo que sortEvents(A) (idempotência).
 *   - merge(A, B) === merge(B, A) (comutatividade na entrada).
 */
export function merge(a: readonly DomainEvent[], b: readonly DomainEvent[]): DomainEvent[] {
  const byId = new Map<string, DomainEvent>();
  for (const event of a) byId.set(event.id, event);
  for (const event of b) byId.set(event.id, event);
  return sortEvents([...byId.values()]);
}

export interface OperatorState {
  readonly id: string;
  readonly name: string;
  readonly role: OperatorRole;
  readonly pinHash: string;
}

export interface ItemState {
  readonly id: string;
  readonly name: string;
  readonly unitPriceCents: number;
  readonly quantity: number;
  readonly note?: string;
  readonly canceled: boolean;
  readonly cancelReason?: CancelReason;
}

export interface TransferState {
  readonly originTableId: string;
  readonly destinationTableId: string;
  readonly hlc: string;
}

export interface PaymentState {
  readonly amountCents: number;
  readonly paymentMethod: PaymentMethod;
  readonly changeCents: number;
}

export interface ClosingState {
  readonly subtotalCents: number;
  readonly serviceFeePercent: number;
  readonly serviceFeeCents: number;
  readonly totalCents: number;
}

export interface OrderState {
  readonly id: string;
  readonly origin: OrderOrigin;
  /** Mesa atual (considerando transferências); undefined para order avulsa. */
  readonly currentTableId?: string;
  readonly status: "open" | "closed";
  /** Setado quando esta order perdeu o conflito do ARCH §4.2 e foi mesclada na canônica. */
  readonly mergedInto?: string;
  readonly items: readonly ItemState[];
  readonly transfers: readonly TransferState[];
  readonly payments: readonly PaymentState[];
  readonly closing?: ClosingState;
}

export interface TableGroupState {
  readonly id: string;
  readonly tableIds: readonly string[];
}

export interface CategoryState {
  readonly id: string;
  readonly name: string;
}

export interface ProductState {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly categoryId: string;
  readonly active: boolean;
}

export interface TableState {
  readonly id: string;
  readonly identifier: string;
  readonly capacity?: number;
}

export interface MergeWarning {
  readonly losingOrder: string;
  readonly canonicalOrder: string;
  readonly tableId: string;
}

export interface ProjectedState {
  readonly operators: readonly OperatorState[];
  readonly orders: readonly OrderState[];
  readonly tableGroups: readonly TableGroupState[];
  readonly categories: readonly CategoryState[];
  readonly products: readonly ProductState[];
  readonly tables: readonly TableState[];
  /** Base pro indicador não bloqueante que a UI deve mostrar (ARCH §4.2). */
  readonly mergeWarnings: readonly MergeWarning[];
}

interface MutableOrder {
  id: string;
  origin: OrderOrigin;
  currentTableId?: string;
  status: "open" | "closed";
  mergedInto?: string;
  items: Map<string, ItemState>;
  transfers: TransferState[];
  payments: PaymentState[];
  closing?: ClosingState;
}

/**
 * Aplica um log de eventos (deve já estar ordenado por HLC — use
 * `sortEvents`/`merge`) e produz o estado materializado de todos os
 * agregados do ARCH §3.1/§3.2, incluindo a regra de conflito do ARCH §4.2:
 * duas `order_opened` pra mesma mesa -> a de menor HLC é a canônica, a
 * outra é mesclada automaticamente e seus itens são reatribuídos.
 *
 * Conflito só é resolvido pra orders de mesa (não avulsas) — é o único
 * cenário documentado no ARCH; colisão de número avulso entre terminais
 * offline não tem regra definida e fica fora de escopo aqui.
 */
export function project(sortedEvents: readonly DomainEvent[]): ProjectedState {
  const operators = new Map<string, OperatorState>();
  const orders = new Map<string, MutableOrder>();
  const tableToCanonicalOrder = new Map<string, string>();
  const tableGroups = new Map<string, TableGroupState>();
  const categories = new Map<string, CategoryState>();
  const products = new Map<string, ProductState>();
  const tables = new Map<string, TableState>();
  const mergeWarnings: MergeWarning[] = [];

  function resolveCanonical(orderId: string): MutableOrder {
    let current = orders.get(orderId);
    if (!current) throw new Error(`Evento referencia order desconhecida: ${orderId}`);
    const visited = new Set<string>();
    while (current.mergedInto) {
      if (visited.has(current.id)) throw new Error("Ciclo de merge detectado.");
      visited.add(current.id);
      const next = orders.get(current.mergedInto);
      if (!next) throw new Error(`mergedInto aponta pra order desconhecida: ${current.mergedInto}`);
      current = next;
    }
    return current;
  }

  for (const event of sortedEvents) {
    switch (event.type) {
      case "operator_registered": {
        operators.set(event.aggregateId, {
          id: event.aggregateId,
          name: event.payload.name,
          role: event.payload.role,
          pinHash: event.payload.pinHash,
        });
        break;
      }

      case "category_registered": {
        categories.set(event.aggregateId, { id: event.aggregateId, name: event.payload.name });
        break;
      }

      case "product_registered": {
        products.set(event.aggregateId, {
          id: event.aggregateId,
          name: event.payload.name,
          priceCents: event.payload.priceCents,
          categoryId: event.payload.categoryId,
          active: event.payload.active,
        });
        break;
      }

      case "product_status_changed": {
        const existing = products.get(event.aggregateId);
        if (existing) products.set(event.aggregateId, { ...existing, active: event.payload.active });
        break;
      }

      case "table_registered": {
        tables.set(event.aggregateId, {
          id: event.aggregateId,
          identifier: event.payload.identifier,
          capacity: event.payload.capacity,
        });
        break;
      }

      case "order_opened": {
        const newOrder: MutableOrder = {
          id: event.aggregateId,
          origin: event.payload,
          currentTableId: event.payload.source === "table" ? event.payload.tableId : undefined,
          status: "open",
          items: new Map(),
          transfers: [],
          payments: [],
        };
        orders.set(event.aggregateId, newOrder);

        if (event.payload.source === "table") {
          const tableId = event.payload.tableId;
          const existingCanonical = tableToCanonicalOrder.get(tableId);
          if (existingCanonical === undefined) {
            tableToCanonicalOrder.set(tableId, event.aggregateId);
          } else {
            // Conflito ARCH §4.2. A canônica já processada tem HLC menor —
            // garantido pela ordenação global do log antes de projetar.
            newOrder.mergedInto = existingCanonical;
            mergeWarnings.push({ losingOrder: event.aggregateId, canonicalOrder: existingCanonical, tableId });
          }
        }
        break;
      }

      case "order_transferred": {
        const canonical = resolveCanonical(event.aggregateId);
        canonical.transfers.push({
          originTableId: event.payload.originTableId,
          destinationTableId: event.payload.destinationTableId,
          hlc: event.hlc,
        });
        if (tableToCanonicalOrder.get(event.payload.originTableId) === canonical.id) {
          tableToCanonicalOrder.delete(event.payload.originTableId);
        }
        tableToCanonicalOrder.set(event.payload.destinationTableId, canonical.id);
        canonical.currentTableId = event.payload.destinationTableId;
        break;
      }

      case "tables_grouped": {
        tableGroups.set(event.aggregateId, { id: event.aggregateId, tableIds: [...event.payload.tableIds] });
        break;
      }

      case "item_added": {
        const canonical = resolveCanonical(event.aggregateId);
        canonical.items.set(event.payload.itemId, {
          id: event.payload.itemId,
          name: event.payload.name,
          unitPriceCents: event.payload.unitPriceCents,
          quantity: event.payload.quantity,
          note: event.payload.note,
          canceled: false,
        });
        break;
      }

      case "item_canceled": {
        const canonical = resolveCanonical(event.aggregateId);
        const existing = canonical.items.get(event.payload.itemId);
        if (existing) {
          canonical.items.set(event.payload.itemId, {
            ...existing,
            canceled: true,
            cancelReason: event.payload.reason,
          });
        }
        break;
      }

      case "order_closed": {
        const canonical = resolveCanonical(event.aggregateId);
        canonical.status = "closed";
        canonical.closing = { ...event.payload };
        break;
      }

      case "payment_recorded": {
        const canonical = resolveCanonical(event.aggregateId);
        canonical.payments.push({
          amountCents: event.payload.amountCents,
          paymentMethod: event.payload.paymentMethod,
          changeCents: event.payload.changeCents,
        });
        break;
      }
    }
  }

  return {
    operators: [...operators.values()].sort((a, b) => compareText(a.id, b.id)),
    orders: [...orders.values()]
      .map((o) => ({
        id: o.id,
        origin: o.origin,
        currentTableId: o.currentTableId,
        status: o.status,
        mergedInto: o.mergedInto,
        items: [...o.items.values()].sort((a, b) => compareText(a.id, b.id)),
        transfers: o.transfers,
        payments: o.payments,
        closing: o.closing,
      }))
      .sort((a, b) => compareText(a.id, b.id)),
    tableGroups: [...tableGroups.values()].sort((a, b) => compareText(a.id, b.id)),
    categories: [...categories.values()].sort((a, b) => compareText(a.id, b.id)),
    products: [...products.values()].sort((a, b) => compareText(a.id, b.id)),
    tables: [...tables.values()].sort((a, b) => compareText(a.id, b.id)),
    mergeWarnings: [...mergeWarnings].sort((a, b) => compareText(a.losingOrder, b.losingOrder)),
  };
}

/** Conveniência: mescla dois logs e já devolve o estado projetado. */
export function reconcile(a: readonly DomainEvent[], b: readonly DomainEvent[]): ProjectedState {
  return project(merge(a, b));
}

function compareText(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
