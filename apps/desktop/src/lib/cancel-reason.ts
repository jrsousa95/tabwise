import { defineMessages } from "./i18n";

/** PRD 1.3/4.3 — lista pré-definida de motivos de cancelamento + "outro" com texto livre. */
export type CancelReason = "entry_error" | "customer_changed_mind" | "item_unavailable" | "other";

export const cancelReasonMessages = defineMessages({
  pt: {
    entry_error: "Erro de lançamento",
    customer_changed_mind: "Cliente desistiu",
    item_unavailable: "Item indisponível",
    other: "Outro",
  },
  en: {
    entry_error: "Entry error",
    customer_changed_mind: "Customer changed their mind",
    item_unavailable: "Item unavailable",
    other: "Other",
  },
});

export const cancelReasons: CancelReason[] = ["entry_error", "customer_changed_mind", "item_unavailable", "other"];
