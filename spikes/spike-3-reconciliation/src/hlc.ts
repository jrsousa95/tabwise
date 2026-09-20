/**
 * Hybrid Logical Clock (Kulkarni et al.) — timestamp lógico usado para
 * ordenar eventos causalmente entre terminais, mesmo com relógios de
 * parede dessincronizados. ARCH §3.3.
 *
 * `l` é o componente físico: o maior wall-clock (ms) já observado local ou
 * remotamente. `c` é um contador lógico que desempata eventos que caem no
 * mesmo `l` — é o que garante que, se A causou B, hlc(A) < hlc(B), mesmo
 * que os relógios de parede das duas máquinas estejam iguais ou invertidos.
 */

export interface HLC {
  readonly l: number;
  readonly c: number;
}

export const ZERO: HLC = { l: 0, c: 0 };

/** Novo evento local: avança o clock a partir do relógio de parede atual. */
export function tick(clock: HLC, wallTimeMs: number = Date.now()): HLC {
  const l = Math.max(clock.l, wallTimeMs);
  const c = l === clock.l ? clock.c + 1 : 0;
  return { l, c };
}

/** Evento remoto recebido: mescla o clock local com o do remetente. */
export function receive(local: HLC, remote: HLC, wallTimeMs: number = Date.now()): HLC {
  const l = Math.max(local.l, remote.l, wallTimeMs);
  let c: number;
  if (l === local.l && l === remote.l) {
    c = Math.max(local.c, remote.c) + 1;
  } else if (l === local.l) {
    c = local.c + 1;
  } else if (l === remote.l) {
    c = remote.c + 1;
  } else {
    c = 0;
  }
  return { l, c };
}

export function compare(a: HLC, b: HLC): -1 | 0 | 1 {
  if (a.l !== b.l) return a.l < b.l ? -1 : 1;
  if (a.c !== b.c) return a.c < b.c ? -1 : 1;
  return 0;
}

// Largura fixa em hex para que a string sirva de chave de ordenação direta
// (o campo `hlc` do ARCH §3.1 é TEXT e precisa ser ordenável sem parsear).
const L_WIDTH = 16;
const C_WIDTH = 8;

export function serialize(clock: HLC): string {
  return `${clock.l.toString(16).padStart(L_WIDTH, "0")}-${clock.c.toString(16).padStart(C_WIDTH, "0")}`;
}

export function parse(text: string): HLC {
  const partes = text.split("-");
  if (partes.length !== 2) throw new Error(`HLC serializado inválido: ${text}`);
  return { l: parseInt(partes[0]!, 16), c: parseInt(partes[1]!, 16) };
}

export function compareSerialized(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
