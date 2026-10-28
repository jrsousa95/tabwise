import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema, CancelReasonSchema } from "@tabwise/shared-types";
import { insertEvent } from "@tabwise/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/** Épicos 2 (comandas), 4 (lançamento de pedidos) e 5 (fechamento) do PRD. */
export async function handleOrderRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/orders") {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const source = body?.source;
      if (source !== "table" && source !== "standalone") {
        sendJson(res, 400, { error: "source precisa ser 'table' ou 'standalone'" });
        return true;
      }

      const state = ctx.currentState();
      const openOrders = state.orders.filter((o) => o.mergedInto === undefined && o.status === "open");
      const orderLimit = ctx.maxConcurrentOrders();
      // PRD 2.7/8.2 — limite real do plano (cache local, ver `maxConcurrentOrders`).
      if (openOrders.length >= orderLimit) {
        sendJson(res, 409, { error: `limite de ${orderLimit} comandas simultâneas atingido — faça upgrade de plano pra aumentar` });
        return true;
      }

      let payload: { source: "table"; tableId: string } | { source: "standalone"; number: number };
      if (source === "table") {
        const tableId = typeof body?.tableId === "string" ? body.tableId : "";
        if (!state.tables.some((t) => t.id === tableId)) {
          sendJson(res, 400, { error: "mesa não encontrada" });
          return true;
        }
        // PRD 2.2 — invariante local "1 comanda aberta por mesa" (conflito
        // entre terminais offline continua resolvido pelo ARCH §4.2 na
        // hora de mesclar — isso aqui só evita o caso óbvio no mesmo terminal).
        if (!ctx.isTableFree(state, tableId)) {
          sendJson(res, 409, { error: "mesa já tem uma comanda aberta" });
          return true;
        }
        payload = { source: "table", tableId };
      } else {
        // PRD 2.3 — número sequencial visível, nunca reaproveitado.
        const usedNumbers = state.orders
          .filter((o) => o.origin.source === "standalone")
          .map((o) => (o.origin as { number: number }).number);
        const number = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : 1;
        payload = { source: "standalone", number };
      }

      const orderId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "order_opened",
        aggregateType: "order",
        aggregateId: orderId,
        payload,
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: orderId, ...payload });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const orderTransferMatch = url.pathname.match(/^\/orders\/([^/]+)\/transfer$/);
  if (req.method === "POST" && orderTransferMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;

      const orderId = orderTransferMatch[1]!;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não pode ser transferida" });
        return true;
      }
      if (!order.currentTableId) {
        sendJson(res, 409, { error: "comanda avulsa não tem mesa pra transferir" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const destinationTableId = typeof body?.destinationTableId === "string" ? body.destinationTableId : "";
      if (!state.tables.some((t) => t.id === destinationTableId)) {
        sendJson(res, 400, { error: "mesa de destino não encontrada" });
        return true;
      }
      if (destinationTableId === order.currentTableId) {
        sendJson(res, 400, { error: "mesa de destino é a mesma mesa atual" });
        return true;
      }
      // PRD 2.5 — mesa de destino precisa estar livre (senão é caso de
      // junção, história 2.6 — não de transferência).
      if (!ctx.isTableFree(state, destinationTableId)) {
        sendJson(res, 409, { error: "mesa de destino já tem uma comanda aberta" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "order_transferred",
        aggregateType: "order",
        aggregateId: orderId,
        payload: { originTableId: order.currentTableId, destinationTableId },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { id: orderId, originTableId: order.currentTableId, destinationTableId });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const orderItemsMatch = url.pathname.match(/^\/orders\/([^/]+)\/items$/);
  if (req.method === "POST" && orderItemsMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;

      const orderId = orderItemsMatch[1]!;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita novos itens" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const productId = typeof body?.productId === "string" ? body.productId : "";
      const quantity = body?.quantity;
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : undefined;
      if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
        sendJson(res, 400, { error: "quantidade precisa ser um número inteiro positivo" });
        return true;
      }
      // PRD 3.2 — produto inativo não aparece na busca do garçom; reforçado
      // aqui pra não depender só do filtro client-side do ProductSearch.
      const product = state.products.find((p) => p.id === productId && p.active);
      if (!product) {
        sendJson(res, 400, { error: "produto não encontrado ou inativo" });
        return true;
      }

      const itemId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "item_added",
        aggregateType: "order",
        aggregateId: orderId,
        // PRD 4.1 — denormalizado de propósito (ver comentário em
        // shared-types/src/events.ts): preço de venda não muda
        // retroativamente se o produto for editado depois.
        payload: { itemId, name: product.name, unitPriceCents: product.priceCents, quantity, note },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { itemId, name: product.name, unitPriceCents: product.priceCents, quantity, note });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const itemCancelMatch = url.pathname.match(/^\/orders\/([^/]+)\/items\/([^/]+)\/cancel$/);
  if (req.method === "POST" && itemCancelMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;
      // PRD §2 — garçom lança item, mas só caixa/dono cancela.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode cancelar item" });
        return true;
      }

      const [, orderId, itemId] = itemCancelMatch;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita cancelamento de item" });
        return true;
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) {
        sendJson(res, 404, { error: "item não encontrado" });
        return true;
      }
      if (item.canceled) {
        sendJson(res, 409, { error: "item já está cancelado" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const reasonResult = CancelReasonSchema.safeParse(body?.reason);
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : undefined;
      if (!reasonResult.success) {
        sendJson(res, 400, { error: "motivo de cancelamento inválido" });
        return true;
      }
      // PRD 1.3 — motivo "outro" exige texto livre.
      if (reasonResult.data === "other" && !note) {
        sendJson(res, 400, { error: "motivo 'outro' exige uma observação" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "item_canceled",
        aggregateType: "order",
        aggregateId: orderId!,
        payload: { itemId: itemId!, reason: reasonResult.data, note },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { itemId, reason: reasonResult.data, note });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  // Achado em uso real, 2026-09-22: única forma de corrigir a observação de
  // um item era cancelar e relançar — sem restrição de papel, mesmo padrão
  // de POST /orders/:id/items (quem lança também pode corrigir a própria
  // observação; cancelar/fechar é que exige caixa/dono).
  const itemNoteMatch = url.pathname.match(/^\/orders\/([^/]+)\/items\/([^/]+)\/note$/);
  if (req.method === "POST" && itemNoteMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;

      const [, orderId, itemId] = itemNoteMatch;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita edição de item" });
        return true;
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) {
        sendJson(res, 404, { error: "item não encontrado" });
        return true;
      }
      if (item.canceled) {
        sendJson(res, 409, { error: "item cancelado não aceita edição" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : undefined;

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "item_note_updated",
        aggregateType: "order",
        aggregateId: orderId!,
        payload: { itemId: itemId!, note },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { itemId, note });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  // Achado em uso real, 2026-09-22: o "+" de adição rápida do product-search
  // criava um item_added novo a cada clique — várias linhas duplicadas do
  // mesmo produto em vez de somar na mesma linha. deltaQuantity (nunca um
  // total absoluto) por segurança de merge offline-first — ver comentário em
  // shared-types/src/events.ts.
  const itemIncrementMatch = url.pathname.match(/^\/orders\/([^/]+)\/items\/([^/]+)\/increment$/);
  if (req.method === "POST" && itemIncrementMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;

      const [, orderId, itemId] = itemIncrementMatch;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda fechada não aceita edição de item" });
        return true;
      }
      const item = order.items.find((i) => i.id === itemId);
      if (!item) {
        sendJson(res, 404, { error: "item não encontrado" });
        return true;
      }
      if (item.canceled) {
        sendJson(res, 409, { error: "item cancelado não aceita edição" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const deltaQuantity = typeof body?.deltaQuantity === "number" ? body.deltaQuantity : 1;
      if (!Number.isInteger(deltaQuantity) || deltaQuantity <= 0) {
        sendJson(res, 400, { error: "deltaQuantity precisa ser um número inteiro positivo" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "item_quantity_incremented",
        aggregateType: "order",
        aggregateId: orderId!,
        payload: { itemId: itemId!, deltaQuantity },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { itemId, deltaQuantity });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const orderCloseMatch = url.pathname.match(/^\/orders\/([^/]+)\/close$/);
  if (req.method === "POST" && orderCloseMatch) {
    try {
      const acting = ctx.requireSession(res);
      if (!acting) return true;
      // PRD §2 — fechamento é ação de caixa/dono, garçom não fecha comanda.
      if (acting.role === "waiter") {
        sendJson(res, 403, { error: "garçom não pode fechar comanda" });
        return true;
      }

      const orderId = orderCloseMatch[1]!;
      const state = ctx.currentState();
      const order = state.orders.find((o) => o.id === orderId);
      if (!order || order.mergedInto !== undefined) {
        sendJson(res, 404, { error: "comanda não encontrada" });
        return true;
      }
      if (order.status !== "open") {
        sendJson(res, 409, { error: "comanda já está fechada" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const serviceFeePercent = body?.serviceFeePercent;
      if (typeof serviceFeePercent !== "number" || serviceFeePercent < 0) {
        sendJson(res, 400, { error: "taxa de serviço inválida" });
        return true;
      }
      const splitsInput = Array.isArray(body?.splits) ? body.splits : [];

      const subtotalCents = ctx.computeSubtotalCents(order);
      const serviceFeeCents = Math.round((subtotalCents * serviceFeePercent) / 100);
      const totalCents = subtotalCents + serviceFeeCents;

      const splitsResult = ctx.parseSplits(splitsInput, totalCents);
      if (!splitsResult.ok) {
        sendJson(res, 400, { error: splitsResult.error });
        return true;
      }

      const closedEvent = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "order_closed",
        aggregateType: "order",
        aggregateId: orderId,
        payload: { subtotalCents, serviceFeePercent, serviceFeeCents, totalCents },
      });
      insertEvent(ctx.db, closedEvent);

      for (const payment of splitsResult.payments) {
        const paymentEvent = DomainEventSchema.parse({
          id: randomUUID(),
          hlc: nextHlc(),
          operatorId: acting.id,
          terminalId: ctx.terminalId,
          createdAt: Date.now(),
          type: "payment_recorded",
          aggregateType: "order",
          aggregateId: orderId,
          payload: payment,
        });
        insertEvent(ctx.db, paymentEvent);
      }

      sendJson(res, 200, { id: orderId, subtotalCents, serviceFeePercent, serviceFeeCents, totalCents, payments: splitsResult.payments });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  // ARCH §4.2 (achado em uso real, 2026-09-23) — marca que o dono já revisou
  // um conflito de mesa (duas order_opened pra mesma mesa, mescladas
  // automaticamente). Não desfaz o merge, só registra o reconhecimento —
  // mesmo espírito append-only do resto do log. `orderId` aqui é sempre a
  // `losingOrder` de um `MergeWarning` (a comanda mesclada), nunca a canônica.
  const resolveConflictMatch = url.pathname.match(/^\/orders\/([^/]+)\/resolve-conflict$/);
  if (req.method === "POST" && resolveConflictMatch) {
    const acting = ctx.requireOwner(res);
    if (!acting) return true;

    const orderId = resolveConflictMatch[1]!;
    const conflict = ctx.currentState().mergeWarnings.find((w) => w.losingOrder === orderId);
    if (!conflict) {
      sendJson(res, 404, { error: "conflito não encontrado pra essa comanda" });
      return true;
    }
    if (conflict.resolvedAt !== undefined) {
      sendJson(res, 409, { error: "conflito já foi marcado como resolvido" });
      return true;
    }

    const event = DomainEventSchema.parse({
      id: randomUUID(),
      hlc: nextHlc(),
      operatorId: acting.id,
      terminalId: ctx.terminalId,
      createdAt: Date.now(),
      type: "table_conflict_resolved",
      aggregateType: "order",
      aggregateId: orderId,
      payload: {},
    });
    insertEvent(ctx.db, event);
    sendJson(res, 200, { id: orderId, resolvedAt: event.createdAt });
    return true;
  }

  return false;
}
