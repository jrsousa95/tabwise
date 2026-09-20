/**
 * Simulador determinístico usado pelos testes de propriedade: transforma
 * uma lista abstrata de "ações" (geradas pelo fast-check) numa lista
 * concreta de eventos com HLCs causalmente corretos, usando o próprio
 * hlc.ts (dogfooding) — inclusive gerando o cenário de conflito do
 * ARCH §4.2 sempre que duas ações "abrir" caem na mesma mesa.
 */
import fc from "fast-check";
import { ZERO, receive, serialize, tick, type HLC } from "../src/hlc";
import type { DomainEvent } from "../src/events";

export const TERMINALS = ["T1", "T2", "T3"] as const;
export const TABLES = ["table-1", "table-2"] as const;

interface OpenAction {
  readonly type: "open";
  readonly terminal: (typeof TERMINALS)[number];
  readonly tableId: (typeof TABLES)[number];
  readonly orderId: string;
}

interface ItemAction {
  readonly type: "item_added" | "item_canceled";
  readonly terminal: (typeof TERMINALS)[number];
  readonly orderId: string;
  readonly itemId: string;
}

type Action = OpenAction | ItemAction;

/**
 * Gera um cenário plausível: todas as aberturas de order "acontecem"
 * primeiro (cada terminal decidindo por conta própria, sem ver o que os
 * outros fizeram — exatamente a premissa do ARCH §4.2), seguidas por
 * ações de item em ordem arbitrária.
 */
export function scenarioArbitrary(): fc.Arbitrary<Action[]> {
  const openSpecArb = fc.record({
    terminal: fc.constantFrom(...TERMINALS),
    tableId: fc.constantFrom(...TABLES),
  });

  return fc.array(openSpecArb, { minLength: 1, maxLength: 6 }).chain((openSpecs) => {
    const itemSpecArb = fc.record({
      terminal: fc.constantFrom(...TERMINALS),
      orderIndex: fc.nat({ max: openSpecs.length - 1 }),
      itemId: fc.stringMatching(/^[a-z]{4,8}$/),
      cancel: fc.boolean(),
    });

    return fc.array(itemSpecArb, { minLength: 0, maxLength: 20 }).map((itemSpecs): Action[] => {
      const openActions: Action[] = openSpecs.map((s, i) => ({
        type: "open",
        terminal: s.terminal,
        tableId: s.tableId,
        orderId: `order-${i}`,
      }));
      const itemActions: Action[] = itemSpecs.map((s) => ({
        type: s.cancel ? "item_canceled" : "item_added",
        terminal: s.terminal,
        orderId: `order-${s.orderIndex}`,
        itemId: s.itemId,
      }));
      return [...openActions, ...itemActions];
    });
  });
}

/**
 * Interpreta a lista de ações "na ordem em que aconteceram de verdade",
 * atribuindo HLCs reais por terminal via tick()/receive(). Uma ação de
 * item que referencia uma order aberta por OUTRO terminal simula ter
 * sincronizado o suficiente pra saber que ela existe (receive), então o
 * HLC do item sempre fica causalmente depois do HLC de abertura.
 */
export function interpret(actions: readonly Action[]): DomainEvent[] {
  const clocks = new Map<string, HLC>();
  const openingHlc = new Map<string, HLC>();
  const events: DomainEvent[] = [];
  let counter = 0;

  const clockFor = (terminal: string): HLC => clocks.get(terminal) ?? ZERO;

  for (const action of actions) {
    const wall = 1_700_000_000_000 + counter;

    if (action.type === "open") {
      const newClock = tick(clockFor(action.terminal), wall);
      clocks.set(action.terminal, newClock);
      openingHlc.set(action.orderId, newClock);
      events.push({
        id: `ev-${counter++}`,
        hlc: serialize(newClock),
        aggregateType: "order",
        aggregateId: action.orderId,
        type: "order_opened",
        terminalId: action.terminal,
        operatorId: "op-1",
        payload: { tableId: action.tableId },
      });
      continue;
    }

    const originClock = openingHlc.get(action.orderId);
    if (!originClock) continue; // ação gerada referenciando uma order que não existe nesta amostra

    const syncedClock = receive(clockFor(action.terminal), originClock, wall);
    const newClock = tick(syncedClock, wall);
    clocks.set(action.terminal, newClock);

    if (action.type === "item_added") {
      events.push({
        id: `ev-${counter++}`,
        hlc: serialize(newClock),
        aggregateType: "order",
        aggregateId: action.orderId,
        type: "item_added",
        terminalId: action.terminal,
        operatorId: "op-1",
        payload: { itemId: action.itemId, name: `Item ${action.itemId}`, quantity: 1 },
      });
    } else {
      events.push({
        id: `ev-${counter++}`,
        hlc: serialize(newClock),
        aggregateType: "order",
        aggregateId: action.orderId,
        type: "item_canceled",
        terminalId: action.terminal,
        operatorId: "op-1",
        payload: { itemId: action.itemId, reason: "other" },
      });
    }
  }

  return events;
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

export function deterministicShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = prng(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

/** Divide o log em duas partições arbitrárias (simula dois terminais com visões parciais). */
export function deterministicPartition<T>(items: readonly T[], seed: number): [T[], T[]] {
  const rand = prng(seed);
  const a: T[] = [];
  const b: T[] = [];
  for (const item of items) (rand() < 0.5 ? a : b).push(item);
  return [a, b];
}
