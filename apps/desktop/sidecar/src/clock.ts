import { parse, receive, serialize, tick, ZERO, type HLC } from "@tabwise/sync-engine";

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

/**
 * M9 (ARCH §3.3) — toda vez que este terminal recebe um evento de fora
 * (sync LAN ou nuvem), precisa "ver" o HLC daquele evento pra garantir que
 * seus PRÓPRIOS eventos futuros continuam causalmente depois — sem isso, um
 * terminal que ficou muito tempo offline poderia criar eventos com HLC
 * menor que eventos que já chegaram de outro terminal, quebrando a garantia
 * central do design (ARCH §3.3: "se A causou B, hlc(A) < hlc(B)").
 */
export function receiveHlc(remoteHlc: string): void {
  clock = receive(clock, parse(remoteHlc));
}
