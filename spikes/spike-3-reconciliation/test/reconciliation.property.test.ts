import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { merge, projetar, sortEventos } from "../src/reconciliation";
import { arbitrarioDeCenario, embaralharDeterministico, interpretar, particionarDeterministico } from "./sim";

/**
 * Objetivo do M0 (implementation-plan.md): "gerar sequências aleatórias de
 * eventos em ordens diferentes e validar que o estado final é sempre o
 * mesmo (comutatividade do merge)". Os três testes abaixo cobrem isso de
 * formas complementares: embaralhar a chegada, mesclar um log com ele
 * mesmo, e particionar em dois logs parciais (o caso real de dois
 * terminais sincronizando entre si).
 */

function normalizar(estado: ReturnType<typeof projetar>): string {
  return JSON.stringify(estado);
}

describe("reconciliação — propriedades (fast-check)", () => {
  it("é comutativa: qualquer ordem de chegada produz o mesmo estado final projetado", () => {
    fc.assert(
      fc.property(arbitrarioDeCenario(), fc.integer(), (acoes, seedEmbaralho) => {
        const log = interpretar(acoes);
        fc.pre(log.length > 0);

        const esperado = normalizar(projetar(sortEventos(log)));
        const embaralhado = embaralharDeterministico(log, seedEmbaralho);
        const obtido = normalizar(projetar(sortEventos(embaralhado)));

        expect(obtido).toEqual(esperado);
      }),
      { numRuns: 500 }
    );
  });

  it("é idempotente: mesclar um log com ele mesmo não muda o estado final", () => {
    fc.assert(
      fc.property(arbitrarioDeCenario(), (acoes) => {
        const log = interpretar(acoes);
        fc.pre(log.length > 0);

        const esperado = normalizar(projetar(sortEventos(log)));
        const remesclado = normalizar(projetar(merge(log, log)));

        expect(remesclado).toEqual(esperado);
      }),
      { numRuns: 300 }
    );
  });

  it("particionar o log em dois (dois terminais com visões parciais) e mesclar reproduz o estado original", () => {
    fc.assert(
      fc.property(arbitrarioDeCenario(), fc.integer(), (acoes, seedParticao) => {
        const log = interpretar(acoes);
        fc.pre(log.length > 0);

        const esperado = normalizar(projetar(sortEventos(log)));
        const [logA, logB] = particionarDeterministico(log, seedParticao);
        const reconciliado = normalizar(projetar(merge(logA, logB)));

        expect(reconciliado).toEqual(esperado);
      }),
      { numRuns: 500 }
    );
  });
});
