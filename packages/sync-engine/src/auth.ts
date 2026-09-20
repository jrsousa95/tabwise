import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

/**
 * PIN hashing via `node:crypto` scrypt (built into Node, sem dependência
 * nativa compilada por plataforma) em vez de bcrypt/argon2 — mesma decisão
 * de fundo do `node:sqlite` em `db.ts`: manter a história do Spike 1 (SEA
 * standalone) sem reintroduzir binários específicos de plataforma.
 */
const KEY_LENGTH = 64;
const PREFIX = "scrypt";

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(pin, salt, KEY_LENGTH)) as Buffer;
  return `${PREFIX}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expectedKey = Buffer.from(parts[2]!, "hex");
  const derivedKey = (await scryptAsync(pin, salt, expectedKey.length)) as Buffer;
  return derivedKey.length === expectedKey.length && timingSafeEqual(derivedKey, expectedKey);
}
