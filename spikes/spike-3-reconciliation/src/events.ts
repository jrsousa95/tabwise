/**
 * Subconjunto mínimo do modelo de eventos do ARCH §3.1, só o necessário
 * pra este spike: abrir comanda + adicionar/cancelar item — o bastante
 * pra exercitar o caso feliz (§4.1) e o caso de conflito (§4.2).
 */

export type AggregateType = "comanda" | "mesa";

interface EventoBase {
  readonly id: string;
  /** HLC serializado (ver hlc.ts:serialize) — nunca o wall-clock. */
  readonly hlc: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly terminalId: string;
  readonly operadorId: string;
}

export interface ComandaAberta extends EventoBase {
  readonly tipo: "comanda_aberta";
  readonly aggregateType: "comanda";
  readonly payload: { readonly mesaId: string };
}

export interface ItemAdicionado extends EventoBase {
  readonly tipo: "item_adicionado";
  readonly aggregateType: "comanda";
  readonly payload: { readonly itemId: string; readonly nome: string; readonly quantidade: number };
}

export interface ItemCancelado extends EventoBase {
  readonly tipo: "item_cancelado";
  readonly aggregateType: "comanda";
  readonly payload: { readonly itemId: string; readonly motivo: string };
}

export type Evento = ComandaAberta | ItemAdicionado | ItemCancelado;
