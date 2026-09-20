import { compareSerialized } from "./hlc";
import type { Evento } from "./events";

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

export interface ItemState {
  readonly id: string;
  readonly nome: string;
  readonly quantidade: number;
  readonly cancelado: boolean;
  readonly motivoCancelamento?: string;
}

export interface ComandaState {
  readonly id: string;
  readonly mesaId: string;
  /** Setado quando esta comanda perdeu o conflito do ARCH §4.2 e foi mesclada na canônica. */
  readonly mescladaEm?: string;
  readonly itens: readonly ItemState[];
}

export interface AvisoDeMerge {
  readonly comandaPerdedora: string;
  readonly comandaCanonica: string;
  readonly mesaId: string;
}

export interface EstadoProjetado {
  readonly comandas: readonly ComandaState[];
  /** Base pro indicador não bloqueante que a UI deve mostrar (ARCH §4.2). */
  readonly avisosDeMerge: readonly AvisoDeMerge[];
}

interface ComandaMut {
  id: string;
  mesaId: string;
  mescladaEm?: string;
  itens: Map<string, ItemState>;
}

/**
 * Aplica um log de eventos (deve já estar ordenado por HLC — use
 * `sortEventos`/`merge`) e produz o estado materializado, incluindo a
 * regra de conflito do ARCH §4.2: duas `comanda_aberta` pra mesma mesa ->
 * a de menor HLC é a canônica, a outra é mesclada automaticamente e seus
 * itens são reatribuídos à canônica.
 */
export function projetar(eventosOrdenados: readonly Evento[]): EstadoProjetado {
  const comandas = new Map<string, ComandaMut>();
  const mesaParaComandaCanonica = new Map<string, string>();
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
    if (evento.tipo === "comanda_aberta") {
      const { mesaId } = evento.payload;
      comandas.set(evento.aggregateId, { id: evento.aggregateId, mesaId, itens: new Map() });

      const canonicaExistente = mesaParaComandaCanonica.get(mesaId);
      if (canonicaExistente === undefined) {
        mesaParaComandaCanonica.set(mesaId, evento.aggregateId);
      } else {
        // Conflito ARCH §4.2. A canônica já processada tem HLC menor —
        // garantido pela ordenação global do log antes de projetar.
        const perdedora = comandas.get(evento.aggregateId);
        if (!perdedora) throw new Error("Comanda recém-criada não encontrada — bug no projetor.");
        perdedora.mescladaEm = canonicaExistente;
        avisosDeMerge.push({ comandaPerdedora: evento.aggregateId, comandaCanonica: canonicaExistente, mesaId });
      }
      continue;
    }

    const canonica = resolverCanonica(evento.aggregateId);
    if (evento.tipo === "item_adicionado") {
      canonica.itens.set(evento.payload.itemId, {
        id: evento.payload.itemId,
        nome: evento.payload.nome,
        quantidade: evento.payload.quantidade,
        cancelado: false,
      });
    } else {
      const existente = canonica.itens.get(evento.payload.itemId);
      if (existente) {
        canonica.itens.set(evento.payload.itemId, {
          ...existente,
          cancelado: true,
          motivoCancelamento: evento.payload.motivo,
        });
      }
    }
  }

  return {
    comandas: [...comandas.values()]
      .map((c) => ({
        id: c.id,
        mesaId: c.mesaId,
        mescladaEm: c.mescladaEm,
        itens: [...c.itens.values()].sort((a, b) => compararTexto(a.id, b.id)),
      }))
      .sort((a, b) => compararTexto(a.id, b.id)),
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
