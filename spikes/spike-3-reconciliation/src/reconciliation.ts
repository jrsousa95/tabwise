import { compareSerialized } from "./hlc";
import type { DomainEvent } from "./events";

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

export interface ItemState {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  readonly canceled: boolean;
  readonly cancelReason?: string;
}

export interface OrderState {
  readonly id: string;
  readonly tableId: string;
  /** Setado quando esta order perdeu o conflito do ARCH §4.2 e foi mesclada na canônica. */
  readonly mergedInto?: string;
  readonly items: readonly ItemState[];
}

export interface MergeWarning {
  readonly losingOrder: string;
  readonly canonicalOrder: string;
  readonly tableId: string;
}

export interface ProjectedState {
  readonly orders: readonly OrderState[];
  /** Base pro indicador não bloqueante que a UI deve mostrar (ARCH §4.2). */
  readonly mergeWarnings: readonly MergeWarning[];
}

interface MutableOrder {
  id: string;
  tableId: string;
  mergedInto?: string;
  items: Map<string, ItemState>;
}

/**
 * Aplica um log de eventos (deve já estar ordenado por HLC — use
 * `sortEvents`/`merge`) e produz o estado materializado, incluindo a
 * regra de conflito do ARCH §4.2: duas `order_opened` pra mesma mesa ->
 * a de menor HLC é a canônica, a outra é mesclada automaticamente e seus
 * itens são reatribuídos à canônica.
 */
export function project(sortedEvents: readonly DomainEvent[]): ProjectedState {
  const orders = new Map<string, MutableOrder>();
  const tableToCanonicalOrder = new Map<string, string>();
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
    if (event.type === "order_opened") {
      const { tableId } = event.payload;
      orders.set(event.aggregateId, { id: event.aggregateId, tableId, items: new Map() });

      const existingCanonical = tableToCanonicalOrder.get(tableId);
      if (existingCanonical === undefined) {
        tableToCanonicalOrder.set(tableId, event.aggregateId);
      } else {
        // Conflito ARCH §4.2. A canônica já processada tem HLC menor —
        // garantido pela ordenação global do log antes de projetar.
        const losing = orders.get(event.aggregateId);
        if (!losing) throw new Error("Order recém-criada não encontrada — bug no projetor.");
        losing.mergedInto = existingCanonical;
        mergeWarnings.push({ losingOrder: event.aggregateId, canonicalOrder: existingCanonical, tableId });
      }
      continue;
    }

    const canonical = resolveCanonical(event.aggregateId);
    if (event.type === "item_added") {
      canonical.items.set(event.payload.itemId, {
        id: event.payload.itemId,
        name: event.payload.name,
        quantity: event.payload.quantity,
        canceled: false,
      });
    } else {
      const existing = canonical.items.get(event.payload.itemId);
      if (existing) {
        canonical.items.set(event.payload.itemId, {
          ...existing,
          canceled: true,
          cancelReason: event.payload.reason,
        });
      }
    }
  }

  return {
    orders: [...orders.values()]
      .map((o) => ({
        id: o.id,
        tableId: o.tableId,
        mergedInto: o.mergedInto,
        items: [...o.items.values()].sort((a, b) => compareText(a.id, b.id)),
      }))
      .sort((a, b) => compareText(a.id, b.id)),
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
