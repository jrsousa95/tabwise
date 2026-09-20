import type {
  Evento,
  FormaPagamento,
  MotivoCancelamento,
  OrigemComanda,
  PapelOperador,
} from "@passa-a-regua/shared-types";
import { compareSerialized } from "./hlc.js";

/** Ordem total determinística: por HLC e, em empate, por id do evento. */
export function sortEventos(eventos: readonly Evento[]): Evento[] {
  return [...eventos].sort((a, b) => compareSerialized(a.hlc, b.hlc) || compararTexto(a.id, b.id));
}

/**
 * Mescla dois logs de eventos: dedupe por `id` (reaplicar o mesmo evento é
 * seguro — ARCH §4.3) e reordena por HLC. Por construção:
 *   - merge(A, A) tem o mesmo conteúdo que sortEventos(A) (idempotência).
 *   - merge(A, B) === merge(B, A) (comutatividade na entrada).
 */
export function merge(a: readonly Evento[], b: readonly Evento[]): Evento[] {
  const porId = new Map<string, Evento>();
  for (const evento of a) porId.set(evento.id, evento);
  for (const evento of b) porId.set(evento.id, evento);
  return sortEventos([...porId.values()]);
}

export interface OperadorState {
  readonly id: string;
  readonly nome: string;
  readonly papel: PapelOperador;
  readonly pinHash: string;
}

export interface ItemState {
  readonly id: string;
  readonly nome: string;
  readonly precoUnitarioCentavos: number;
  readonly quantidade: number;
  readonly observacao?: string;
  readonly cancelado: boolean;
  readonly motivoCancelamento?: MotivoCancelamento;
}

export interface TransferenciaState {
  readonly mesaOrigemId: string;
  readonly mesaDestinoId: string;
  readonly hlc: string;
}

export interface PagamentoState {
  readonly valorCentavos: number;
  readonly formaPagamento: FormaPagamento;
  readonly trocoCentavos: number;
}

export interface FechamentoState {
  readonly subtotalCentavos: number;
  readonly taxaServicoPercentual: number;
  readonly taxaServicoCentavos: number;
  readonly totalCentavos: number;
}

export interface ComandaState {
  readonly id: string;
  readonly origem: OrigemComanda;
  /** Mesa atual (considerando transferências); undefined para comanda avulsa. */
  readonly mesaAtualId?: string;
  readonly status: "aberta" | "fechada";
  /** Setado quando esta comanda perdeu o conflito do ARCH §4.2 e foi mesclada na canônica. */
  readonly mescladaEm?: string;
  readonly itens: readonly ItemState[];
  readonly transferencias: readonly TransferenciaState[];
  readonly pagamentos: readonly PagamentoState[];
  readonly fechamento?: FechamentoState;
}

export interface GrupoDeMesasState {
  readonly id: string;
  readonly mesaIds: readonly string[];
}

export interface AvisoDeMerge {
  readonly comandaPerdedora: string;
  readonly comandaCanonica: string;
  readonly mesaId: string;
}

export interface EstadoProjetado {
  readonly operadores: readonly OperadorState[];
  readonly comandas: readonly ComandaState[];
  readonly gruposDeMesas: readonly GrupoDeMesasState[];
  /** Base pro indicador não bloqueante que a UI deve mostrar (ARCH §4.2). */
  readonly avisosDeMerge: readonly AvisoDeMerge[];
}

interface ComandaMut {
  id: string;
  origem: OrigemComanda;
  mesaAtualId?: string;
  status: "aberta" | "fechada";
  mescladaEm?: string;
  itens: Map<string, ItemState>;
  transferencias: TransferenciaState[];
  pagamentos: PagamentoState[];
  fechamento?: FechamentoState;
}

/**
 * Aplica um log de eventos (deve já estar ordenado por HLC — use
 * `sortEventos`/`merge`) e produz o estado materializado de todos os
 * agregados do ARCH §3.1/§3.2, incluindo a regra de conflito do ARCH §4.2:
 * duas `comanda_aberta` pra mesma mesa -> a de menor HLC é a canônica, a
 * outra é mesclada automaticamente e seus itens são reatribuídos.
 *
 * Conflito só é resolvido pra comandas de mesa (não avulsas) — é o único
 * cenário documentado no ARCH; colisão de número avulso entre terminais
 * offline não tem regra definida e fica fora de escopo aqui.
 */
export function projetar(eventosOrdenados: readonly Evento[]): EstadoProjetado {
  const operadores = new Map<string, OperadorState>();
  const comandas = new Map<string, ComandaMut>();
  const mesaParaComandaCanonica = new Map<string, string>();
  const grupos = new Map<string, GrupoDeMesasState>();
  const avisosDeMerge: AvisoDeMerge[] = [];

  function resolverCanonica(comandaId: string): ComandaMut {
    let atual = comandas.get(comandaId);
    if (!atual) throw new Error(`Evento referencia comanda desconhecida: ${comandaId}`);
    const visitados = new Set<string>();
    while (atual.mescladaEm) {
      if (visitados.has(atual.id)) throw new Error("Ciclo de merge detectado.");
      visitados.add(atual.id);
      const proxima = comandas.get(atual.mescladaEm);
      if (!proxima) throw new Error(`mescladaEm aponta pra comanda desconhecida: ${atual.mescladaEm}`);
      atual = proxima;
    }
    return atual;
  }

  for (const evento of eventosOrdenados) {
    switch (evento.tipo) {
      case "operador_cadastrado": {
        operadores.set(evento.aggregateId, {
          id: evento.aggregateId,
          nome: evento.payload.nome,
          papel: evento.payload.papel,
          pinHash: evento.payload.pinHash,
        });
        break;
      }

      case "comanda_aberta": {
        const nova: ComandaMut = {
          id: evento.aggregateId,
          origem: evento.payload,
          mesaAtualId: evento.payload.origem === "mesa" ? evento.payload.mesaId : undefined,
          status: "aberta",
          itens: new Map(),
          transferencias: [],
          pagamentos: [],
        };
        comandas.set(evento.aggregateId, nova);

        if (evento.payload.origem === "mesa") {
          const mesaId = evento.payload.mesaId;
          const canonicaExistente = mesaParaComandaCanonica.get(mesaId);
          if (canonicaExistente === undefined) {
            mesaParaComandaCanonica.set(mesaId, evento.aggregateId);
          } else {
            // Conflito ARCH §4.2. A canônica já processada tem HLC menor —
            // garantido pela ordenação global do log antes de projetar.
            nova.mescladaEm = canonicaExistente;
            avisosDeMerge.push({ comandaPerdedora: evento.aggregateId, comandaCanonica: canonicaExistente, mesaId });
          }
        }
        break;
      }

      case "comanda_transferida": {
        const canonica = resolverCanonica(evento.aggregateId);
        canonica.transferencias.push({
          mesaOrigemId: evento.payload.mesaOrigemId,
          mesaDestinoId: evento.payload.mesaDestinoId,
          hlc: evento.hlc,
        });
        if (mesaParaComandaCanonica.get(evento.payload.mesaOrigemId) === canonica.id) {
          mesaParaComandaCanonica.delete(evento.payload.mesaOrigemId);
        }
        mesaParaComandaCanonica.set(evento.payload.mesaDestinoId, canonica.id);
        canonica.mesaAtualId = evento.payload.mesaDestinoId;
        break;
      }

      case "mesas_agrupadas": {
        grupos.set(evento.aggregateId, { id: evento.aggregateId, mesaIds: [...evento.payload.mesaIds] });
        break;
      }

      case "item_adicionado": {
        const canonica = resolverCanonica(evento.aggregateId);
        canonica.itens.set(evento.payload.itemId, {
          id: evento.payload.itemId,
          nome: evento.payload.nome,
          precoUnitarioCentavos: evento.payload.precoUnitarioCentavos,
          quantidade: evento.payload.quantidade,
          observacao: evento.payload.observacao,
          cancelado: false,
        });
        break;
      }

      case "item_cancelado": {
        const canonica = resolverCanonica(evento.aggregateId);
        const existente = canonica.itens.get(evento.payload.itemId);
        if (existente) {
          canonica.itens.set(evento.payload.itemId, {
            ...existente,
            cancelado: true,
            motivoCancelamento: evento.payload.motivo,
          });
        }
        break;
      }

      case "comanda_fechada": {
        const canonica = resolverCanonica(evento.aggregateId);
        canonica.status = "fechada";
        canonica.fechamento = { ...evento.payload };
        break;
      }

      case "pagamento_registrado": {
        const canonica = resolverCanonica(evento.aggregateId);
        canonica.pagamentos.push({
          valorCentavos: evento.payload.valorCentavos,
          formaPagamento: evento.payload.formaPagamento,
          trocoCentavos: evento.payload.trocoCentavos,
        });
        break;
      }
    }
  }

  return {
    operadores: [...operadores.values()].sort((a, b) => compararTexto(a.id, b.id)),
    comandas: [...comandas.values()]
      .map((c) => ({
        id: c.id,
        origem: c.origem,
        mesaAtualId: c.mesaAtualId,
        status: c.status,
        mescladaEm: c.mescladaEm,
        itens: [...c.itens.values()].sort((a, b) => compararTexto(a.id, b.id)),
        transferencias: c.transferencias,
        pagamentos: c.pagamentos,
        fechamento: c.fechamento,
      }))
      .sort((a, b) => compararTexto(a.id, b.id)),
    gruposDeMesas: [...grupos.values()].sort((a, b) => compararTexto(a.id, b.id)),
    avisosDeMerge: [...avisosDeMerge].sort((a, b) => compararTexto(a.comandaPerdedora, b.comandaPerdedora)),
  };
}

/** Conveniência: mescla dois logs e já devolve o estado projetado. */
export function reconciliar(a: readonly Evento[], b: readonly Evento[]): EstadoProjetado {
  return projetar(merge(a, b));
}

function compararTexto(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
