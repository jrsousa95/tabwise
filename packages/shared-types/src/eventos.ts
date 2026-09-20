import { z } from "zod";
import {
  eventoBaseSchema,
  FormaPagamentoSchema,
  MotivoCancelamentoSchema,
  PapelOperadorSchema,
} from "./comum.js";

/** PRD 1.1 — cadastro de operador (nome, papel, PIN). `aggregateId` é o próprio id do operador criado. */
export const OperadorCadastradoSchema = eventoBaseSchema.extend({
  tipo: z.literal("operador_cadastrado"),
  aggregateType: z.literal("operador"),
  aggregateId: z.string().min(1),
  payload: z.object({
    nome: z.string().min(1),
    papel: PapelOperadorSchema,
    /** Nunca o PIN em texto plano (ARCH §7) — hash bcrypt/argon2. */
    pinHash: z.string().min(1),
  }),
});
export type OperadorCadastrado = z.infer<typeof OperadorCadastradoSchema>;

/**
 * PRD 2.2/2.3 — comanda vinculada a uma mesa OU avulsa (nunca as duas).
 * `aggregateId` é o id da comanda sendo aberta.
 */
export const origemComandaSchema = z.discriminatedUnion("origem", [
  z.object({ origem: z.literal("mesa"), mesaId: z.string().min(1) }),
  z.object({ origem: z.literal("avulsa"), numero: z.number().int().positive() }),
]);
export type OrigemComanda = z.infer<typeof origemComandaSchema>;

export const ComandaAbertaSchema = eventoBaseSchema.extend({
  tipo: z.literal("comanda_aberta"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: origemComandaSchema,
});
export type ComandaAberta = z.infer<typeof ComandaAbertaSchema>;

/** PRD 2.5 — `aggregateId` é a comanda transferida; mantém histórico (nunca reescreve). */
export const ComandaTransferidaSchema = eventoBaseSchema.extend({
  tipo: z.literal("comanda_transferida"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: z.object({
    mesaOrigemId: z.string().min(1),
    mesaDestinoId: z.string().min(1),
  }),
});
export type ComandaTransferida = z.infer<typeof ComandaTransferidaSchema>;

/**
 * PRD 2.6 — vínculo visual de mesas "juntas", sem mesclar dados de comanda.
 * `aggregateId` identifica o grupo (não uma mesa específica).
 */
export const MesasAgrupadasSchema = eventoBaseSchema.extend({
  tipo: z.literal("mesas_agrupadas"),
  aggregateType: z.literal("grupo_mesas"),
  aggregateId: z.string().min(1),
  payload: z.object({
    mesaIds: z.array(z.string().min(1)).min(2),
  }),
});
export type MesasAgrupadas = z.infer<typeof MesasAgrupadasSchema>;

/**
 * PRD 4.1/4.2 — dados do item denormalizados no próprio evento (cadastro de
 * produto é do Épico 3/M4, que ainda não existe nesta fase do roadmap).
 * `aggregateId` é a comanda onde o item entra.
 */
export const ItemAdicionadoSchema = eventoBaseSchema.extend({
  tipo: z.literal("item_adicionado"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    nome: z.string().min(1),
    precoUnitarioCentavos: z.number().int().nonnegative(),
    quantidade: z.number().int().positive(),
    observacao: z.string().optional(),
  }),
});
export type ItemAdicionado = z.infer<typeof ItemAdicionadoSchema>;

/** PRD 4.3/1.3 — nunca apaga o evento original; `aggregateId` é a comanda dona do item. */
export const ItemCanceladoSchema = eventoBaseSchema.extend({
  tipo: z.literal("item_cancelado"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    motivo: MotivoCancelamentoSchema,
    /** Texto livre — obrigatório na prática quando `motivo === "outro"` (validado na UI/API, não aqui). */
    observacao: z.string().optional(),
  }),
});
export type ItemCancelado = z.infer<typeof ItemCanceladoSchema>;

/**
 * PRD 5.1/5.5 — fecha a comanda (imutável após isso). Os pagamentos em si
 * são eventos `pagamento_registrado` separados (um por parte do split).
 */
export const ComandaFechadaSchema = eventoBaseSchema.extend({
  tipo: z.literal("comanda_fechada"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: z.object({
    subtotalCentavos: z.number().int().nonnegative(),
    /** 0 quando a taxa foi isentada nesta comanda (PRD 5.1). */
    taxaServicoPercentual: z.number().nonnegative(),
    taxaServicoCentavos: z.number().int().nonnegative(),
    totalCentavos: z.number().int().nonnegative(),
  }),
});
export type ComandaFechada = z.infer<typeof ComandaFechadaSchema>;

/** PRD 5.2/5.3/5.4 — um evento por parte do split (cada uma pode ter forma de pagamento diferente). */
export const PagamentoRegistradoSchema = eventoBaseSchema.extend({
  tipo: z.literal("pagamento_registrado"),
  aggregateType: z.literal("comanda"),
  aggregateId: z.string().min(1),
  payload: z.object({
    valorCentavos: z.number().int().positive(),
    formaPagamento: FormaPagamentoSchema,
    /** Só se aplica a `formaPagamento === "dinheiro"` (PRD 5.4); 0 caso contrário. */
    trocoCentavos: z.number().int().nonnegative(),
  }),
});
export type PagamentoRegistrado = z.infer<typeof PagamentoRegistradoSchema>;

export const EventoSchema = z.discriminatedUnion("tipo", [
  OperadorCadastradoSchema,
  ComandaAbertaSchema,
  ComandaTransferidaSchema,
  MesasAgrupadasSchema,
  ItemAdicionadoSchema,
  ItemCanceladoSchema,
  ComandaFechadaSchema,
  PagamentoRegistradoSchema,
]);
export type Evento = z.infer<typeof EventoSchema>;
export type TipoEvento = Evento["tipo"];
