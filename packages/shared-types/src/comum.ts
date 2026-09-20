import { z } from "zod";

/** ARCH §2, decisão 2 (personas/permissões) — PRD Épico 1. */
export const PapelOperadorSchema = z.enum(["dono", "caixa", "garcom"]);
export type PapelOperador = z.infer<typeof PapelOperadorSchema>;

/** PRD 5.3. */
export const FormaPagamentoSchema = z.enum(["dinheiro", "cartao"]);
export type FormaPagamento = z.infer<typeof FormaPagamentoSchema>;

/** PRD 1.3 — lista pré-definida + "outro" com texto livre no `observacao`. */
export const MotivoCancelamentoSchema = z.enum([
  "erro_de_lancamento",
  "cliente_desistiu",
  "item_indisponivel",
  "outro",
]);
export type MotivoCancelamento = z.infer<typeof MotivoCancelamentoSchema>;

export const AggregateTypeSchema = z.enum(["operador", "comanda", "grupo_mesas"]);
export type AggregateType = z.infer<typeof AggregateTypeSchema>;

/**
 * Campos comuns a todo evento (ARCH §3.1). `criadoEm` é wall-clock só para
 * exibição — nunca usado pra ordenação/conflito, isso é o papel do `hlc`.
 */
export const eventoBaseSchema = z.object({
  id: z.string().min(1),
  hlc: z.string().min(1),
  operadorId: z.string().min(1),
  terminalId: z.string().min(1),
  criadoEm: z.number().int().nonnegative(),
});
