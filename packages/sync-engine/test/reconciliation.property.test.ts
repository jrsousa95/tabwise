import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { merge, project, sortEvents } from "../src/reconciliation.js";
import { scenarioArbitrary, deterministicShuffle, interpret, deterministicPartition } from "./sim.js";

/**
 * Objetivo do M1 (implementation-plan.md): "gerar sequências aleatórias de
 * eventos em ordens diferentes e validar que o estado final é sempre o
 * mesmo (comutatividade do merge)". Portado de
 * `spikes/spike-3-reconciliation/` sobre o modelo de evento completo.
 */

function normalize(state: ReturnType<typeof project>): string {
  return JSON.stringify(state);
}

describe("reconciliação — propriedades (fast-check)", () => {
  it("é comutativa: qualquer ordem de chegada produz o mesmo estado final projetado", () => {
    fc.assert(
      fc.property(scenarioArbitrary(), fc.integer(), (actions, shuffleSeed) => {
        const log = interpret(actions);
        fc.pre(log.length > 0);

        const expected = normalize(project(sortEvents(log)));
        const shuffled = deterministicShuffle(log, shuffleSeed);
        const actual = normalize(project(sortEvents(shuffled)));

        expect(actual).toEqual(expected);
      }),
      { numRuns: 500 }
    );
  });

  it("é idempotente: mesclar um log com ele mesmo não muda o estado final", () => {
    fc.assert(
      fc.property(scenarioArbitrary(), (actions) => {
        const log = interpret(actions);
        fc.pre(log.length > 0);

        const expected = normalize(project(sortEvents(log)));
        const remerged = normalize(project(merge(log, log)));

        expect(remerged).toEqual(expected);
      }),
      { numRuns: 300 }
    );
  });

  it("particionar o log em dois (dois terminais com visões parciais) e mesclar reproduz o estado original", () => {
    fc.assert(
      fc.property(scenarioArbitrary(), fc.integer(), (actions, partitionSeed) => {
        const log = interpret(actions);
        fc.pre(log.length > 0);

        const expected = normalize(project(sortEvents(log)));
        const [logA, logB] = deterministicPartition(log, partitionSeed);
        const reconciled = normalize(project(merge(logA, logB)));

        expect(reconciled).toEqual(expected);
      }),
      { numRuns: 500 }
    );
  });
});
