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
  /** PRD 1.3 — texto livre do cancelamento (obrigatório na prática quando `cancelReason === "other"`). */
  readonly cancelNote?: string;
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
  /** PRD 6.1 — wall-clock do evento `order_closed`, usado só pra agrupar o resumo do dia por data (nunca pra ordenação/conflito, isso é papel do `hlc`). */
  readonly closedAt: number;
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
  /** `createdAt` do `category_registered` original — ordem de criação da lista (achado em uso real, 2026-09-22: sem isso a lista ordenava por id, que é aleatório). */
  readonly createdAt: number;
}

export interface ProductState {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly categoryId: string;
  readonly active: boolean;
  /** `createdAt` do `product_registered` original — ordem de criação da lista. */
  readonly createdAt: number;
}

export interface TableState {
  readonly id: string;
  readonly identifier: string;
  readonly capacity?: number;
  /** `createdAt` do `table_registered` original — ordem de criação da lista. */
  readonly createdAt: number;
}

/** PRD 5.1 — 10% é o default até o dono configurar algo diferente; sem evento nenhum, vale esse valor. */
export const DEFAULT_SERVICE_FEE_PERCENT = 10;

export interface EstablishmentState {
  readonly defaultServiceFeePercent: number;
}

export interface MergeWarning {
  readonly losingOrder: string;
  readonly canonicalOrder: string;
  readonly tableId: string;
  /** `createdAt` do `order_opened` perdedor — base pro filtro de "recente" na UI (achado em uso real, 2026-09-22: sem isso o aviso nunca some). */
  readonly createdAt: number;
  /** `createdAt` do `table_conflict_resolved`, se o dono/caixa já revisou este conflito (ARCH §4.2, achado em uso real 2026-09-23) — `undefined` enquanto não resolvido. */
  readonly resolvedAt?: number;
}

/** Épico 1 (Sessão de Caixa), Story 1.2/1.3/1.4 — vazio por ora, ver `CashSessionState`. */
export interface CashMovementRecord {
  readonly id: string;
  readonly amountCents: number;
  readonly reason: string;
  readonly recordedAt: number;
  readonly operatorId: string;
}

/** Story 1.4 — ver Design Notes de `spec-1-1`: `closing.countedAmountCents` é o único valor gravado; `expectedAmountCents`/`differenceCents` são sempre derivados na leitura, nunca persistidos. */
export interface CashSessionClosingState {
  readonly countedAmountCents: number;
  readonly closedAt: number;
  readonly closedByOperatorId: string;
}

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — estado materializado do agregado
 * `cash_session` (mesmo formato de `OrderState`/`TableState`). `mergedInto`
 * segue o mesmo princípio do ARCH §4.2 aplicado a `OrderState`, mas pra
 * **1 slot global do estabelecimento** (não por `tableId`) — ver
 * `canonicalOpenCashSession` em `project()`.
 */
export interface CashSessionState {
  readonly id: string;
  readonly status: "open" | "closed";
  /** Só informativo/auditoria — NUNCA usado pra decidir o invariante "uma sessão aberta por vez" (esse é do estabelecimento, não do terminal). */
  readonly openedByTerminalId: string;
  readonly openedByOperatorId: string;
  readonly openingAmountCents: number;
  readonly openedAt: number;
  /** Setado quando esta sessão perdeu o conflito de abertura concorrente e foi mesclada na canônica. */
  readonly mergedInto?: string;
  readonly withdrawals: readonly CashMovementRecord[];
  readonly deposits: readonly CashMovementRecord[];
  readonly closing?: CashSessionClosingState;
}

/** Mesmo mecanismo de `MergeWarning`, adaptado pro slot global de sessão de caixa (sem `tableId` — não existe "qual mesa", é o estabelecimento inteiro). */
export interface CashSessionMergeWarning {
  readonly losingSession: string;
  readonly canonicalSession: string;
  readonly createdAt: number;
}

export interface ProjectedState {
  readonly operators: readonly OperatorState[];
  readonly orders: readonly OrderState[];
  readonly tableGroups: readonly TableGroupState[];
  readonly categories: readonly CategoryState[];
  readonly products: readonly ProductState[];
  readonly tables: readonly TableState[];
  readonly establishment: EstablishmentState;
  readonly cashSessions: readonly CashSessionState[];
  /** Base pro indicador não bloqueante que a UI deve mostrar (ARCH §4.2). */
  readonly mergeWarnings: readonly MergeWarning[];
  /** Mesmo indicador não bloqueante, pro conflito de abertura concorrente de sessão de caixa (Épico 1, Story 1.1). */
  readonly cashSessionMergeWarnings: readonly CashSessionMergeWarning[];
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

interface MutableCashSession {
  id: string;
  status: "open" | "closed";
  openedByTerminalId: string;
  openedByOperatorId: string;
  openingAmountCents: number;
  openedAt: number;
  mergedInto?: string;
  withdrawals: CashMovementRecord[];
  deposits: CashMovementRecord[];
  closing?: CashSessionClosingState;
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
  let establishment: EstablishmentState = { defaultServiceFeePercent: DEFAULT_SERVICE_FEE_PERCENT };
  const cashSessions = new Map<string, MutableCashSession>();
  // Épico 1, Story 1.1 — invariante "uma sessão aberta por vez" é do
  // ESTABELECIMENTO inteiro, nunca do terminal: por isso é uma variável
  // única (1 slot global), não um `Map` por chave como `tableToCanonicalOrder`
  // (que tem N slots, um por `tableId`) — ver Design Notes de `spec-1-1`.
  let canonicalOpenCashSession: string | undefined;
  const cashSessionMergeWarnings: CashSessionMergeWarning[] = [];
  const mergeWarnings: MergeWarning[] = [];
  // ARCH §4.2 (achado em uso real, 2026-09-23) — losingOrder -> createdAt do
  // `table_conflict_resolved`. Mapeado à parte (não junto com `mergeWarnings`)
  // porque o evento de resolução pode chegar em qualquer posição do log
  // relativo ao `order_opened` conflitante (ordem de HLC não garante que um
  // vem antes do outro na leitura) — zipado com `mergeWarnings` só no final,
  // depois que os dois já foram varridos por inteiro.
  const resolvedConflicts = new Map<string, number>();

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

  /**
   * Épico 1 (Sessão de Caixa), Story 1.2 — espelha `resolveCanonical`
   * (orders): um `cash_withdrawal_recorded` pode ter sido gravado contra uma
   * sessão que ERA a canônica no momento do registro, mas que depois de
   * sincronizar perdeu o conflito de abertura concorrente (§4.2/§4.4) e foi
   * mesclada. Segue `mergedInto` até a sessão que não perdeu nada, com
   * detecção de ciclo.
   */
  function resolveCanonicalCashSession(sessionId: string): MutableCashSession {
    let current = cashSessions.get(sessionId);
    if (!current) throw new Error(`Evento referencia sessão de caixa desconhecida: ${sessionId}`);
    const visited = new Set<string>();
    while (current.mergedInto) {
      if (visited.has(current.id)) throw new Error("Ciclo de merge detectado.");
      visited.add(current.id);
      const next = cashSessions.get(current.mergedInto);
      if (!next) throw new Error(`mergedInto aponta pra sessão de caixa desconhecida: ${current.mergedInto}`);
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
        categories.set(event.aggregateId, { id: event.aggregateId, name: event.payload.name, createdAt: event.createdAt });
        break;
      }

      case "category_renamed": {
        const existing = categories.get(event.aggregateId);
        if (existing) categories.set(event.aggregateId, { ...existing, ...event.payload });
        break;
      }

      case "category_removed": {
        categories.delete(event.aggregateId);
        break;
      }

      case "product_registered": {
        products.set(event.aggregateId, {
          id: event.aggregateId,
          name: event.payload.name,
          priceCents: event.payload.priceCents,
          categoryId: event.payload.categoryId,
          active: event.payload.active,
          createdAt: event.createdAt,
        });
        break;
      }

      case "product_status_changed": {
        const existing = products.get(event.aggregateId);
        if (existing) products.set(event.aggregateId, { ...existing, active: event.payload.active });
        break;
      }

      case "product_renamed": {
        const existing = products.get(event.aggregateId);
        if (existing) products.set(event.aggregateId, { ...existing, ...event.payload });
        break;
      }

      case "product_removed": {
        products.delete(event.aggregateId);
        break;
      }

      case "establishment_settings_updated": {
        establishment = { defaultServiceFeePercent: event.payload.defaultServiceFeePercent };
        break;
      }

      case "table_registered": {
        tables.set(event.aggregateId, {
          id: event.aggregateId,
          identifier: event.payload.identifier,
          capacity: event.payload.capacity,
          createdAt: event.createdAt,
        });
        break;
      }

      case "table_renamed": {
        const existing = tables.get(event.aggregateId);
        if (existing) tables.set(event.aggregateId, { ...existing, ...event.payload });
        break;
      }

      case "table_removed": {
        tables.delete(event.aggregateId);
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
            mergeWarnings.push({ losingOrder: event.aggregateId, canonicalOrder: existingCanonical, tableId, createdAt: event.createdAt });
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

      case "table_conflict_resolved": {
        resolvedConflicts.set(event.aggregateId, event.createdAt);
        break;
      }

      case "tables_grouped": {
        tableGroups.set(event.aggregateId, { id: event.aggregateId, tableIds: [...event.payload.tableIds] });
        break;
      }

      case "table_group_dissolved": {
        tableGroups.delete(event.aggregateId);
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
            cancelNote: event.payload.note,
          });
        }
        break;
      }

      case "item_note_updated": {
        const canonical = resolveCanonical(event.aggregateId);
        const existing = canonical.items.get(event.payload.itemId);
        if (existing) {
          canonical.items.set(event.payload.itemId, { ...existing, note: event.payload.note });
        }
        break;
      }

      case "item_quantity_incremented": {
        const canonical = resolveCanonical(event.aggregateId);
        const existing = canonical.items.get(event.payload.itemId);
        if (existing) {
          canonical.items.set(event.payload.itemId, { ...existing, quantity: existing.quantity + event.payload.deltaQuantity });
        }
        break;
      }

      case "order_closed": {
        const canonical = resolveCanonical(event.aggregateId);
        canonical.status = "closed";
        canonical.closing = { ...event.payload, closedAt: event.createdAt };
        // Achado real em uso, 2026-09-23: `tableToCanonicalOrder` nunca era
        // limpo aqui (só em order_transferred) — a PRIMEIRA order que uma
        // mesa recebia na vida ficava "dona" da mesa pra sempre, mesmo
        // depois de fechada. Reabrir a MESMA mesa depois (uso normal, todo
        // dia: mesa fecha, cliente novo senta) achava um "conflito" com a
        // comanda antiga já fechada e mesclava a nova nela silenciosamente
        // — a comanda nova virava inutilizável (POST /orders/:id/items
        // rejeita qualquer order com mergedInto definido). Fechar libera a
        // mesa pro próximo order_opened legítimo não gerar merge falso —
        // mesmo princípio já aplicado em order_transferred acima.
        if (canonical.currentTableId && tableToCanonicalOrder.get(canonical.currentTableId) === canonical.id) {
          tableToCanonicalOrder.delete(canonical.currentTableId);
        }
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

      case "cash_session_opened": {
        const newSession: MutableCashSession = {
          id: event.aggregateId,
          status: "open",
          openedByTerminalId: event.terminalId,
          openedByOperatorId: event.operatorId,
          openingAmountCents: event.payload.openingAmountCents,
          openedAt: event.createdAt,
          withdrawals: [],
          deposits: [],
        };
        cashSessions.set(event.aggregateId, newSession);

        if (canonicalOpenCashSession === undefined) {
          canonicalOpenCashSession = event.aggregateId;
        } else {
          // Conflito de abertura concorrente (mesma regra do ARCH §4.2,
          // adaptada pro slot global): a canônica já processada tem HLC
          // menor — garantido pela ordenação do log antes de projetar.
          newSession.mergedInto = canonicalOpenCashSession;
          cashSessionMergeWarnings.push({
            losingSession: event.aggregateId,
            canonicalSession: canonicalOpenCashSession,
            createdAt: event.createdAt,
          });
        }
        break;
      }

      case "cash_withdrawal_recorded": {
        const canonical = resolveCanonicalCashSession(event.aggregateId);
        canonical.withdrawals.push({
          id: event.id,
          amountCents: event.payload.amountCents,
          reason: event.payload.reason,
          recordedAt: event.createdAt,
          operatorId: event.operatorId,
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
    // Achado em uso real, 2026-09-22: essas três listas são cadastro manual
    // do dono (mesas, categorias, produtos) — ordenar por `id` (UUID, sem
    // significado nenhum) lia como aleatório. Ordem de criação (mais antigo
    // primeiro) é o que o dono realmente espera ver.
    categories: [...categories.values()].sort(compareCreatedAt),
    products: [...products.values()].sort(compareCreatedAt),
    tables: [...tables.values()].sort(compareCreatedAt),
    establishment,
    cashSessions: [...cashSessions.values()]
      .map((s) => ({
        id: s.id,
        status: s.status,
        openedByTerminalId: s.openedByTerminalId,
        openedByOperatorId: s.openedByOperatorId,
        openingAmountCents: s.openingAmountCents,
        openedAt: s.openedAt,
        mergedInto: s.mergedInto,
        withdrawals: s.withdrawals,
        deposits: s.deposits,
        closing: s.closing,
      }))
      .sort((a, b) => compareText(a.id, b.id)),
    mergeWarnings: [...mergeWarnings]
      .map((mw) => (resolvedConflicts.has(mw.losingOrder) ? { ...mw, resolvedAt: resolvedConflicts.get(mw.losingOrder) } : mw))
      .sort((a, b) => compareText(a.losingOrder, b.losingOrder)),
    cashSessionMergeWarnings: [...cashSessionMergeWarnings].sort((a, b) => compareText(a.losingSession, b.losingSession)),
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

/** Ordem de criação (mais antigo primeiro) — `id` como desempate determinístico quando `createdAt` empata. */
function compareCreatedAt(a: { id: string; createdAt: number }, b: { id: string; createdAt: number }): -1 | 0 | 1 {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return compareText(a.id, b.id);
}
