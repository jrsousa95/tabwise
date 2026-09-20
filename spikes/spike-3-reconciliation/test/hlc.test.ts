import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { compare, compareSerialized, parse, receive, serialize, tick, ZERO } from "../src/hlc";
import type { HLC } from "../src/hlc";

describe("HLC — unitários (ARCH §3.3)", () => {
  it("tick() incrementa o contador quando o relógio de parede não avança", () => {
    const a = tick(ZERO, 1000);
    const b = tick(a, 1000);
    expect(b).toEqual({ l: 1000, c: 1 });
  });

  it("tick() zera o contador quando o relógio de parede avança", () => {
    const a = tick(ZERO, 1000);
    const b = tick(a, 2000);
    expect(b).toEqual({ l: 2000, c: 0 });
  });

  it("tick() nunca anda pra trás mesmo se o relógio de parede atrasar", () => {
    const a = tick(ZERO, 5000);
    const b = tick(a, 1000);
    expect(b).toEqual({ l: 5000, c: 1 });
  });

  it("receive() adota o l mais alto entre local/remoto/parede e soma 1 ao contador certo", () => {
    expect(receive({ l: 100, c: 2 }, { l: 100, c: 5 }, 50)).toEqual({ l: 100, c: 6 }); // empate no l -> max(c)+1
    expect(receive({ l: 100, c: 2 }, { l: 200, c: 0 }, 50)).toEqual({ l: 200, c: 1 }); // remoto na frente
    expect(receive({ l: 300, c: 2 }, { l: 200, c: 9 }, 50)).toEqual({ l: 300, c: 3 }); // local na frente
    expect(receive({ l: 100, c: 2 }, { l: 100, c: 5 }, 999)).toEqual({ l: 999, c: 0 }); // parede na frente de ambos
  });

  it("serialize()/parse() fazem roundtrip pra qualquer HLC", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (l, c) => {
        const clock: HLC = { l, c };
        expect(parse(serialize(clock))).toEqual(clock);
      })
    );
  });

  it("compareSerialized() (ordenação de string) concorda com compare() (ordenação estrutural)", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), fc.nat(), (l1, c1, l2, c2) => {
        const a: HLC = { l: l1, c: c1 };
        const b: HLC = { l: l2, c: c2 };
        expect(compareSerialized(serialize(a), serialize(b))).toEqual(compare(a, b));
      })
    );
  });

  it("tick(receive(a, b)) é sempre causalmente depois de a e de b", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), (l1, c1, l2, c2, wall) => {
        const a: HLC = { l: l1, c: c1 };
        const b: HLC = { l: l2, c: c2 };
        const proximo = tick(receive(a, b, wall), wall);
        expect(compare(proximo, a)).toBeGreaterThan(0);
        expect(compare(proximo, b)).toBeGreaterThan(0);
      })
    );
  });
});
