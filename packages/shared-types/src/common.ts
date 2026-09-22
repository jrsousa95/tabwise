import { z } from "zod";

/** ARCH §2, decisão 2 (personas/permissões) — PRD Épico 1. */
export const OperatorRoleSchema = z.enum(["owner", "cashier", "waiter"]);
export type OperatorRole = z.infer<typeof OperatorRoleSchema>;

/** PRD 1.1 — PIN numérico de 4 a 6 dígitos, único por estabelecimento (checado na escrita, não no schema). */
export const PinSchema = z.string().regex(/^\d{4,6}$/, "PIN deve ter de 4 a 6 dígitos numéricos");

/** PRD 5.3. Pix adicionado 2026-09-22 — mesmo tratamento de "card" (sem troco, valor exato). */
export const PaymentMethodSchema = z.enum(["cash", "card", "pix"]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/** PRD 1.3 — lista pré-definida + "other" com texto livre no `note`. */
export const CancelReasonSchema = z.enum(["entry_error", "customer_changed_mind", "item_unavailable", "other"]);
export type CancelReason = z.infer<typeof CancelReasonSchema>;

export const AggregateTypeSchema = z.enum(["operator", "order", "table_group", "category", "product", "table", "establishment"]);
export type AggregateType = z.infer<typeof AggregateTypeSchema>;

/**
 * PRD 5.1 — só existe um estabelecimento por terminal neste MVP (o
 * cadastro multi-estabelecimento de verdade é do backend/M9); o agregado
 * "establishment" é um singleton, sempre com este id fixo.
 */
export const ESTABLISHMENT_ID = "establishment";

/**
 * Campos comuns a todo evento (ARCH §3.1). `createdAt` é wall-clock só para
 * exibição — nunca usado pra ordenação/conflito, isso é o papel do `hlc`.
 */
export const baseEventSchema = z.object({
  id: z.string().min(1),
  hlc: z.string().min(1),
  operatorId: z.string().min(1),
  terminalId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
