/** PRD 1.3/4.3 — lista pré-definida de motivos de cancelamento + "outro" com texto livre. */
export type CancelReason = "entry_error" | "customer_changed_mind" | "item_unavailable" | "other";

export const cancelReasonLabel: Record<CancelReason, string> = {
  entry_error: "Erro de lançamento",
  customer_changed_mind: "Cliente desistiu",
  item_unavailable: "Item indisponível",
  other: "Outro",
};

export const cancelReasons: CancelReason[] = ["entry_error", "customer_changed_mind", "item_unavailable", "other"];
