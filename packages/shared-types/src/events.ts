import { z } from "zod";
import { baseEventSchema, PaymentMethodSchema, CancelReasonSchema, OperatorRoleSchema } from "./common.js";

/** PRD 1.1 — cadastro de operador (nome, papel, PIN). `aggregateId` é o próprio id do operador criado. */
export const OperatorRegisteredSchema = baseEventSchema.extend({
  type: z.literal("operator_registered"),
  aggregateType: z.literal("operator"),
  aggregateId: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
    role: OperatorRoleSchema,
    /** Nunca o PIN em texto plano (ARCH §7) — hash bcrypt/argon2. */
    pinHash: z.string().min(1),
  }),
});
export type OperatorRegistered = z.infer<typeof OperatorRegisteredSchema>;

/** PRD 3.1 — categoria de produto (ex: Bebidas, Petiscos). `aggregateId` é o id da categoria criada. */
export const CategoryRegisteredSchema = baseEventSchema.extend({
  type: z.literal("category_registered"),
  aggregateType: z.literal("category"),
  aggregateId: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
  }),
});
export type CategoryRegistered = z.infer<typeof CategoryRegisteredSchema>;

/** PRD 3.2 — cadastro de produto. `aggregateId` é o id do produto criado. */
export const ProductRegisteredSchema = baseEventSchema.extend({
  type: z.literal("product_registered"),
  aggregateType: z.literal("product"),
  aggregateId: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
    priceCents: z.number().int().nonnegative(),
    categoryId: z.string().min(1),
    active: z.boolean(),
  }),
});
export type ProductRegistered = z.infer<typeof ProductRegisteredSchema>;

/**
 * PRD 3.2 — ativar/desativar produto depois de cadastrado (produto inativo
 * some da busca do garçom, mas permanece em comandas históricas já
 * fechadas — não apaga nem edita o evento de cadastro original).
 */
export const ProductStatusChangedSchema = baseEventSchema.extend({
  type: z.literal("product_status_changed"),
  aggregateType: z.literal("product"),
  aggregateId: z.string().min(1),
  payload: z.object({
    active: z.boolean(),
  }),
});
export type ProductStatusChanged = z.infer<typeof ProductStatusChangedSchema>;

/**
 * PRD 2.2/2.3 — order vinculada a uma mesa OU avulsa (nunca as duas).
 * `aggregateId` é o id da order sendo aberta.
 */
export const orderOriginSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("table"), tableId: z.string().min(1) }),
  z.object({ source: z.literal("standalone"), number: z.number().int().positive() }),
]);
export type OrderOrigin = z.infer<typeof orderOriginSchema>;

export const OrderOpenedSchema = baseEventSchema.extend({
  type: z.literal("order_opened"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: orderOriginSchema,
});
export type OrderOpened = z.infer<typeof OrderOpenedSchema>;

/** PRD 2.5 — `aggregateId` é a order transferida; mantém histórico (nunca reescreve). */
export const OrderTransferredSchema = baseEventSchema.extend({
  type: z.literal("order_transferred"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    originTableId: z.string().min(1),
    destinationTableId: z.string().min(1),
  }),
});
export type OrderTransferred = z.infer<typeof OrderTransferredSchema>;

/**
 * PRD 2.6 — vínculo visual de mesas "juntas", sem mesclar dados de order.
 * `aggregateId` identifica o grupo (não uma mesa específica).
 */
export const TablesGroupedSchema = baseEventSchema.extend({
  type: z.literal("tables_grouped"),
  aggregateType: z.literal("table_group"),
  aggregateId: z.string().min(1),
  payload: z.object({
    tableIds: z.array(z.string().min(1)).min(2),
  }),
});
export type TablesGrouped = z.infer<typeof TablesGroupedSchema>;

/**
 * PRD 4.1/4.2 — dados do item denormalizados no próprio evento (mesmo já
 * existindo `product_registered` desde o M4): o preço no momento da venda
 * não pode mudar retroativamente se o produto for editado depois, então o
 * evento carrega uma cópia própria, não uma referência a `productId`.
 * `aggregateId` é a order onde o item entra.
 */
export const ItemAddedSchema = baseEventSchema.extend({
  type: z.literal("item_added"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    name: z.string().min(1),
    unitPriceCents: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
    note: z.string().optional(),
  }),
});
export type ItemAdded = z.infer<typeof ItemAddedSchema>;

/** PRD 4.3/1.3 — nunca apaga o evento original; `aggregateId` é a order dona do item. */
export const ItemCanceledSchema = baseEventSchema.extend({
  type: z.literal("item_canceled"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    reason: CancelReasonSchema,
    /** Texto livre — obrigatório na prática quando `reason === "other"` (validado na UI/API, não aqui). */
    note: z.string().optional(),
  }),
});
export type ItemCanceled = z.infer<typeof ItemCanceledSchema>;

/**
 * PRD 5.1/5.5 — fecha a order (imutável após isso). Os pagamentos em si
 * são eventos `payment_recorded` separados (um por parte do split).
 */
export const OrderClosedSchema = baseEventSchema.extend({
  type: z.literal("order_closed"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    subtotalCents: z.number().int().nonnegative(),
    /** 0 quando a taxa foi isentada nesta order (PRD 5.1). */
    serviceFeePercent: z.number().nonnegative(),
    serviceFeeCents: z.number().int().nonnegative(),
    totalCents: z.number().int().nonnegative(),
  }),
});
export type OrderClosed = z.infer<typeof OrderClosedSchema>;

/** PRD 5.2/5.3/5.4 — um evento por parte do split (cada uma pode ter forma de pagamento diferente). */
export const PaymentRecordedSchema = baseEventSchema.extend({
  type: z.literal("payment_recorded"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    amountCents: z.number().int().positive(),
    paymentMethod: PaymentMethodSchema,
    /** Só se aplica a `paymentMethod === "cash"` (PRD 5.4); 0 caso contrário. */
    changeCents: z.number().int().nonnegative(),
  }),
});
export type PaymentRecorded = z.infer<typeof PaymentRecordedSchema>;

export const DomainEventSchema = z.discriminatedUnion("type", [
  OperatorRegisteredSchema,
  CategoryRegisteredSchema,
  ProductRegisteredSchema,
  ProductStatusChangedSchema,
  OrderOpenedSchema,
  OrderTransferredSchema,
  TablesGroupedSchema,
  ItemAddedSchema,
  ItemCanceledSchema,
  OrderClosedSchema,
  PaymentRecordedSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent["type"];
