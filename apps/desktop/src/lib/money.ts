/** PRD 5.2/NFR7 — valores monetários sempre em centavos (inteiro) na stack; só a UI trabalha em reais. */
export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Converte texto de input (ex: "12,50" ou "12.50") pra centavos; `null` se não for um valor válido. */
export function parseReaisToCents(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 100);
}
