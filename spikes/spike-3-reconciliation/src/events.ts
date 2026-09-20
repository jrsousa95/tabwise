/**
 * Subconjunto mínimo do modelo de eventos do ARCH §3.1, só o necessário
 * pra este spike: abrir order + adicionar/cancelar item — o bastante
 * pra exercitar o caso feliz (§4.1) e o caso de conflito (§4.2).
 */

export type AggregateType = "order" | "table";

interface BaseEvent {
  readonly id: string;
  /** HLC serializado (ver hlc.ts:serialize) — nunca o wall-clock. */
  readonly hlc: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly terminalId: string;
  readonly operatorId: string;
}

export interface OrderOpened extends BaseEvent {
  readonly type: "order_opened";
  readonly aggregateType: "order";
  readonly payload: { readonly tableId: string };
}

export interface ItemAdded extends BaseEvent {
  readonly type: "item_added";
  readonly aggregateType: "order";
  readonly payload: { readonly itemId: string; readonly name: string; readonly quantity: number };
}

export interface ItemCanceled extends BaseEvent {
  readonly type: "item_canceled";
  readonly aggregateType: "order";
  readonly payload: { readonly itemId: string; readonly reason: string };
}

export type DomainEvent = OrderOpened | ItemAdded | ItemCanceled;
