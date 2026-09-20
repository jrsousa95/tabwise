/**
 * Simulador determinístico usado pelos testes de propriedade: transforma
 * uma lista abstrata de "ações" (geradas pelo fast-check) numa lista
 * concreta de eventos com HLCs causalmente corretos, usando o próprio
 * hlc.ts (dogfooding) — inclusive gerando o cenário de conflito do
 * ARCH §4.2 sempre que duas ações "abrir" caem na mesma mesa.
 */
import fc from "fast-check";
import { ZERO, receive, serialize, tick, type HLC } from "../src/hlc";
import type { Evento } from "../src/events";

export const TERMINAIS = ["T1", "T2", "T3"] as const;
export const MESAS = ["mesa-1", "mesa-2"] as const;

interface AcaoAbrir {
  readonly tipo: "abrir";
  readonly terminal: (typeof TERMINAIS)[number];
  readonly mesaId: (typeof MESAS)[number];
  readonly comandaId: string;
}

interface AcaoItem {
  readonly tipo: "item_adicionado" | "item_cancelado";
  readonly terminal: (typeof TERMINAIS)[number];
  readonly comandaId: string;
  readonly itemId: string;
}

type Acao = AcaoAbrir | AcaoItem;

/**
 * Gera um cenário plausível: todas as aberturas de comanda "acontecem"
 * primeiro (cada terminal decidindo por conta própria, sem ver o que os
 * outros fizeram — exatamente a premissa do ARCH §4.2), seguidas por
 * ações de item em ordem arbitrária.
 */
export function arbitrarioDeCenario(): fc.Arbitrary<Acao[]> {
  const arbAbrirSpec = fc.record({
    terminal: fc.constantFrom(...TERMINAIS),
    mesaId: fc.constantFrom(...MESAS),
  });

  return fc.array(arbAbrirSpec, { minLength: 1, maxLength: 6 }).chain((abrirSpecs) => {
    const arbItemSpec = fc.record({
      terminal: fc.constantFrom(...TERMINAIS),
      comandaIndex: fc.nat({ max: abrirSpecs.length - 1 }),
      itemId: fc.stringMatching(/^[a-z]{4,8}$/),
      cancelar: fc.boolean(),
    });

    return fc.array(arbItemSpec, { minLength: 0, maxLength: 20 }).map((itemSpecs): Acao[] => {
      const acoesAbrir: Acao[] = abrirSpecs.map((s, i) => ({
        tipo: "abrir",
        terminal: s.terminal,
        mesaId: s.mesaId,
        comandaId: `comanda-${i}`,
      }));
      const acoesItem: Acao[] = itemSpecs.map((s) => ({
        tipo: s.cancelar ? "item_cancelado" : "item_adicionado",
        terminal: s.terminal,
        comandaId: `comanda-${s.comandaIndex}`,
        itemId: s.itemId,
      }));
      return [...acoesAbrir, ...acoesItem];
    });
  });
}

/**
 * Interpreta a lista de ações "na ordem em que aconteceram de verdade",
 * atribuindo HLCs reais por terminal via tick()/receive(). Uma ação de
 * item que referencia uma comanda aberta por OUTRO terminal simula ter
 * sincronizado o suficiente pra saber que ela existe (receive), então o
 * HLC do item sempre fica causalmente depois do HLC de abertura.
 */
export function interpretar(acoes: readonly Acao[]): Evento[] {
  const clocks = new Map<string, HLC>();
  const hlcDeAbertura = new Map<string, HLC>();
  const eventos: Evento[] = [];
  let contador = 0;

  const clockDe = (terminal: string): HLC => clocks.get(terminal) ?? ZERO;

  for (const acao of acoes) {
    const wall = 1_700_000_000_000 + contador;

    if (acao.tipo === "abrir") {
      const novoClock = tick(clockDe(acao.terminal), wall);
      clocks.set(acao.terminal, novoClock);
      hlcDeAbertura.set(acao.comandaId, novoClock);
      eventos.push({
        id: `ev-${contador++}`,
        hlc: serialize(novoClock),
        aggregateType: "comanda",
        aggregateId: acao.comandaId,
        tipo: "comanda_aberta",
        terminalId: acao.terminal,
        operadorId: "op-1",
        payload: { mesaId: acao.mesaId },
      });
      continue;
    }

    const clockOrigem = hlcDeAbertura.get(acao.comandaId);
    if (!clockOrigem) continue; // ação gerada referenciando uma comanda que não existe nesta amostra

    const clockSincronizado = receive(clockDe(acao.terminal), clockOrigem, wall);
    const novoClock = tick(clockSincronizado, wall);
    clocks.set(acao.terminal, novoClock);

    if (acao.tipo === "item_adicionado") {
      eventos.push({
        id: `ev-${contador++}`,
        hlc: serialize(novoClock),
        aggregateType: "comanda",
        aggregateId: acao.comandaId,
        tipo: "item_adicionado",
        terminalId: acao.terminal,
        operadorId: "op-1",
        payload: { itemId: acao.itemId, nome: `Item ${acao.itemId}`, quantidade: 1 },
      });
    } else {
      eventos.push({
        id: `ev-${contador++}`,
        hlc: serialize(novoClock),
        aggregateType: "comanda",
        aggregateId: acao.comandaId,
        tipo: "item_cancelado",
        terminalId: acao.terminal,
        operadorId: "op-1",
        payload: { itemId: acao.itemId, motivo: "outro" },
      });
    }
  }

  return eventos;
}

/** PRNG determinístico (mulberry32) — shuffle/partição reprodutíveis a partir de uma seed do fast-check. */
function prng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function embaralharDeterministico<T>(itens: readonly T[], seed: number): T[] {
  const rand = prng(seed);
  const copia = [...itens];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copia[i]!;
    copia[i] = copia[j]!;
    copia[j] = tmp;
  }
  return copia;
}

/** Divide o log em duas partições arbitrárias (simula dois terminais com visões parciais). */
export function particionarDeterministico<T>(itens: readonly T[], seed: number): [T[], T[]] {
  const rand = prng(seed);
  const a: T[] = [];
  const b: T[] = [];
  for (const item of itens) (rand() < 0.5 ? a : b).push(item);
  return [a, b];
}
