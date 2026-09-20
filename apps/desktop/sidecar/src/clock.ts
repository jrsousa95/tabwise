import { serialize, tick, ZERO, type HLC } from "@passa-a-regua/sync-engine";

/**
 * Estado do HLC deste terminal para eventos criados localmente (ARCH §3.3).
 * Reinicia em ZERO a cada boot do sidecar — seguro porque `tick()` usa
 * `max(clock.l, wallTimeMs)`, então o componente físico sempre acompanha o
 * relógio de parede real, que nunca volta atrás entre boots. Não precisa
 * persistir em disco pra isso valer.
 */
let clock: HLC = ZERO;

export function nextHlc(): string {
  clock = tick(clock);
  return serialize(clock);
}
