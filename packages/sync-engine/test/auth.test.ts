import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "../src/auth.js";

describe("auth — hashing de PIN (node:crypto scrypt, ARCH §7)", () => {
  it("verifyPin aceita o PIN correto contra o hash gerado por hashPin", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("1234", hash)).toBe(true);
  });

  it("verifyPin rejeita um PIN incorreto", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("9999", hash)).toBe(false);
  });

  it("nunca guarda o PIN em texto plano — o hash não contém o PIN como substring", async () => {
    const hash = await hashPin("1234");
    expect(hash).not.toContain("1234");
  });

  it("duas chamadas de hashPin para o mesmo PIN produzem hashes diferentes (salt aleatório)", async () => {
    const [a, b] = await Promise.all([hashPin("1234"), hashPin("1234")]);
    expect(a).not.toBe(b);
    expect(await verifyPin("1234", a)).toBe(true);
    expect(await verifyPin("1234", b)).toBe(true);
  });

  it("verifyPin rejeita um hash malformado sem lançar exceção", async () => {
    expect(await verifyPin("1234", "hash-invalido")).toBe(false);
  });
});
