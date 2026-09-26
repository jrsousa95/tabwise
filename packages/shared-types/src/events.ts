import { z } from "zod";
import { baseEventSchema, PaymentMethodSchema, CancelReasonSchema, OperatorRoleSchema, ESTABLISHMENT_ID } from "./common.js";

/**
 * PRD 5.1 — percentual padrão de taxa de serviço do estabelecimento
 * (default 10%, ajustável/isentável por comanda individual no fechamento —
 * ver `OrderClosedSchema`). `aggregateId` é sempre `ESTABLISHMENT_ID`
 * (singleton neste MVP local-first).
 */
export const EstablishmentSettingsUpdatedSchema = baseEventSchema.extend({
  type: z.literal("establishment_settings_updated"),
  aggregateType: z.literal("establishment"),
  aggregateId: z.literal(ESTABLISHMENT_ID),
  payload: z.object({
    defaultServiceFeePercent: z.number().nonnegative(),
  }),
});
export type EstablishmentSettingsUpdated = z.infer<typeof EstablishmentSettingsUpdatedSchema>;

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

/**
 * PRD 3.4 (achado em uso real, 2026-09-22) — renomeia uma categoria já
 * cadastrada sem reescrever o `category_registered` original (mesmo padrão
 * append-only de `ProductStatusChangedSchema`). `aggregateId` é a categoria renomeada.
 */
export const CategoryRenamedSchema = baseEventSchema.extend({
  type: z.literal("category_renamed"),
  aggregateType: z.literal("category"),
  aggregateId: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
  }),
});
export type CategoryRenamed = z.infer<typeof CategoryRenamedSchema>;

/**
 * PRD 3.4 — remoção lógica de categoria (some das listas ativas, nunca
 * apaga histórico). Trava de "categoria em uso" é responsabilidade da rota
 * (`apps/desktop/sidecar/src/index.ts`), não do schema. `aggregateId` é a
 * categoria removida.
 */
export const CategoryRemovedSchema = baseEventSchema.extend({
  type: z.literal("category_removed"),
  aggregateType: z.literal("category"),
  aggregateId: z.string().min(1),
  payload: z.object({}),
});
export type CategoryRemoved = z.infer<typeof CategoryRemovedSchema>;

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
 * PRD 3.5 (achado em uso real, 2026-09-22) — renomeia um produto já
 * cadastrado; não muda retroativamente o nome já gravado em `item_added`
 * (mesmo princípio do preço imutável, ver comentário de `ItemAddedSchema`).
 * `aggregateId` é o produto renomeado.
 */
export const ProductRenamedSchema = baseEventSchema.extend({
  type: z.literal("product_renamed"),
  aggregateType: z.literal("product"),
  aggregateId: z.string().min(1),
  payload: z.object({
    name: z.string().min(1),
  }),
});
export type ProductRenamed = z.infer<typeof ProductRenamedSchema>;

/**
 * PRD 3.5 — remoção lógica de produto: some do cadastro, mas comandas
 * históricas que já o venderam continuam intactas (`item_added` já carrega
 * sua própria cópia de nome/preço). Camada além de `product_status_changed`
 * (desativar), não uma substituição. Sem trava de remoção — itens de
 * comanda não dependem do produto continuar existindo. `aggregateId` é o
 * produto removido.
 */
export const ProductRemovedSchema = baseEventSchema.extend({
  type: z.literal("product_removed"),
  aggregateType: z.literal("product"),
  aggregateId: z.string().min(1),
  payload: z.object({}),
});
export type ProductRemoved = z.infer<typeof ProductRemovedSchema>;

/** PRD 2.1 — cadastro de mesa (dono). `aggregateId` é o id da mesa criada. */
export const TableRegisteredSchema = baseEventSchema.extend({
  type: z.literal("table_registered"),
  aggregateType: z.literal("table"),
  aggregateId: z.string().min(1),
  payload: z.object({
    identifier: z.string().min(1),
    capacity: z.number().int().positive().optional(),
  }),
});
export type TableRegistered = z.infer<typeof TableRegisteredSchema>;

/**
 * PRD 2.8 (achado em uso real, 2026-09-22) — renomeia (identificador e/ou
 * capacidade) uma mesa já cadastrada sem reescrever o `table_registered`
 * original. Mesmo formato de payload de `TableRegisteredSchema`: só o(s)
 * campo(s) presente(s) é(são) aplicado(s) na projeção. `aggregateId` é a
 * mesa renomeada.
 */
export const TableRenamedSchema = baseEventSchema.extend({
  type: z.literal("table_renamed"),
  aggregateType: z.literal("table"),
  aggregateId: z.string().min(1),
  payload: z.object({
    identifier: z.string().min(1),
    capacity: z.number().int().positive().optional(),
  }),
});
export type TableRenamed = z.infer<typeof TableRenamedSchema>;

/**
 * PRD 2.8 — remoção lógica de mesa (some do mapa de mesas e de novas
 * seleções, nunca exclusão física — comandas antigas dessa mesa continuam
 * intactas). Trava de "mesa com comanda aberta" é responsabilidade da rota,
 * não do schema. `aggregateId` é a mesa removida.
 */
export const TableRemovedSchema = baseEventSchema.extend({
  type: z.literal("table_removed"),
  aggregateType: z.literal("table"),
  aggregateId: z.string().min(1),
  payload: z.object({}),
});
export type TableRemoved = z.infer<typeof TableRemovedSchema>;

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
 * ARCH §4.2 — marca que o dono/caixa já revisou e resolveu um conflito de
 * mesa (duas `order_opened` pra mesma mesa, mescladas automaticamente pelo
 * menor HLC). Não desfaz nem apaga o merge em si (a comanda perdedora
 * continua mesclada na canônica, seus itens continuam lá) — é só um
 * reconhecimento explícito, no mesmo espírito append-only do resto do log
 * (mesmo padrão de `product_status_changed`: nunca reescreve o evento
 * original, só adiciona um fato novo por cima). `aggregateId` é a
 * `losingOrder` do `MergeWarning` (a comanda que "perdeu" o conflito) —
 * nunca a canônica, que nunca teve problema nenhum.
 */
export const TableConflictResolvedSchema = baseEventSchema.extend({
  type: z.literal("table_conflict_resolved"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({}),
});
export type TableConflictResolved = z.infer<typeof TableConflictResolvedSchema>;

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
 * PRD 2.6 (emenda 2026-09-21) — desfaz um agrupamento de mesas feito por
 * engano, sem apagar/reescrever o evento `tables_grouped` original (mesmo
 * padrão append-only). `aggregateId` é o id do GRUPO dissolvido (não de uma
 * mesa específica) — mesma convenção de `TablesGroupedSchema`.
 */
export const TableGroupDissolvedSchema = baseEventSchema.extend({
  type: z.literal("table_group_dissolved"),
  aggregateType: z.literal("table_group"),
  aggregateId: z.string().min(1),
  payload: z.object({}),
});
export type TableGroupDissolved = z.infer<typeof TableGroupDissolvedSchema>;

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
 * Edição de observação após o lançamento (achado em uso real, 2026-09-22:
 * a única forma de corrigir/adicionar uma observação era cancelar o item e
 * relançar). Não altera `itemId`/`name`/`unitPriceCents`/`quantity` do
 * `item_added` original (append-only, mesmo princípio de `ItemCanceledSchema`)
 * — só a observação mais recente vale, projetada por ordem de HLC na
 * reconciliação. Só se aplica a item ainda não cancelado (validado na API).
 */
export const ItemNoteUpdatedSchema = baseEventSchema.extend({
  type: z.literal("item_note_updated"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    note: z.string().optional(),
  }),
});
export type ItemNoteUpdated = z.infer<typeof ItemNoteUpdatedSchema>;

/**
 * Achado em uso real, 2026-09-22: o "+" de adição rápida (product-search.tsx)
 * criava um `item_added` novo a cada clique — várias linhas duplicadas do
 * mesmo produto em vez de uma linha só com a quantidade somada. `deltaQuantity`
 * (não um novo total absoluto) é proposital: sob merge offline-first, dois
 * terminais incrementando o mesmo item concorrentemente somam os deltas
 * corretamente em qualquer ordem de HLC — um "novo total" perderia os
 * cliques do terminal que "perdeu" o last-write-wins. Só se aplica a item
 * ainda não cancelado (validado na API), mesmo princípio de `ItemNoteUpdatedSchema`.
 */
export const ItemQuantityIncrementedSchema = baseEventSchema.extend({
  type: z.literal("item_quantity_incremented"),
  aggregateType: z.literal("order"),
  aggregateId: z.string().min(1),
  payload: z.object({
    itemId: z.string().min(1),
    deltaQuantity: z.number().int().positive(),
  }),
});
export type ItemQuantityIncremented = z.infer<typeof ItemQuantityIncrementedSchema>;

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

/**
 * Épico 1 (Sessão de Caixa), Story 1.1 — primeiro evento do agregado novo
 * `cash_session`. `aggregateId` é gerado na abertura (`randomUUID()`, padrão
 * do projeto) e reaproveitado pelos demais eventos do ciclo de vida da
 * mesma sessão (sangria/suprimento/fechamento, stories 1.2-1.4), mesmo
 * princípio de `order_opened` -> `item_added`. O invariante "uma sessão
 * aberta por vez" é do ESTABELECIMENTO inteiro (nunca filtrado por
 * `terminalId`) — resolvido na projeção (`packages/sync-engine/src/
 * reconciliation.ts`), não aqui no schema.
 */
export const CashSessionOpenedSchema = baseEventSchema.extend({
  type: z.literal("cash_session_opened"),
  aggregateType: z.literal("cash_session"),
  aggregateId: z.string().min(1),
  payload: z.object({
    /** NFR7 — fundo de troco inicial, inteiro em centavos, sempre > 0. */
    openingAmountCents: z.number().int().positive(),
  }),
});
export type CashSessionOpened = z.infer<typeof CashSessionOpenedSchema>;

/**
 * Épico 1 (Sessão de Caixa), Story 1.2 — sangria (retirada de dinheiro da
 * gaveta durante o turno). Sub-evento do ciclo de vida de `cash_session`
 * (mesmo `aggregateType: "cash_session"`, NÃO ganha tipo próprio — mesmo
 * princípio de `item_added` usando `aggregateType: "order"`). `aggregateId`
 * é a sessão canônica aberta no momento do registro (a rota resolve
 * sozinha via `isCashSessionOpen`; cliente nunca informa um id de sessão).
 * Reatribuição histórica quando essa sessão perde um conflito de abertura
 * concorrente depois é responsabilidade da projeção
 * (`resolveCanonicalCashSession` em `reconciliation.ts`), não deste schema.
 */
export const CashWithdrawalRecordedSchema = baseEventSchema.extend({
  type: z.literal("cash_withdrawal_recorded"),
  aggregateType: z.literal("cash_session"),
  aggregateId: z.string().min(1),
  payload: z.object({
    /** NFR7 — inteiro em centavos, sempre > 0. */
    amountCents: z.number().int().positive(),
    /** Texto livre, obrigatório — validado como não-vazio após `trim()`. */
    reason: z.string().trim().min(1),
  }),
});
export type CashWithdrawalRecorded = z.infer<typeof CashWithdrawalRecordedSchema>;

export const DomainEventSchema = z.discriminatedUnion("type", [
  EstablishmentSettingsUpdatedSchema,
  OperatorRegisteredSchema,
  CategoryRegisteredSchema,
  CategoryRenamedSchema,
  CategoryRemovedSchema,
  ProductRegisteredSchema,
  ProductStatusChangedSchema,
  ProductRenamedSchema,
  ProductRemovedSchema,
  TableRegisteredSchema,
  TableRenamedSchema,
  TableRemovedSchema,
  OrderOpenedSchema,
  OrderTransferredSchema,
  TableConflictResolvedSchema,
  TablesGroupedSchema,
  TableGroupDissolvedSchema,
  ItemAddedSchema,
  ItemCanceledSchema,
  ItemNoteUpdatedSchema,
  ItemQuantityIncrementedSchema,
  OrderClosedSchema,
  PaymentRecordedSchema,
  CashSessionOpenedSchema,
  CashWithdrawalRecordedSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type DomainEventType = DomainEvent["type"];
