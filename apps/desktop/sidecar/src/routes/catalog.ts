import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent } from "@passa-a-regua/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/** Épico 3 (PRD) — categorias e produtos do cardápio (cadastrar, renomear, remover/ativar-desativar). */
export async function handleCatalogRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/categories") {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length === 0) {
        sendJson(res, 400, { error: "nome da categoria é obrigatório" });
        return true;
      }

      const categoryId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "category_registered",
        aggregateType: "category",
        aggregateId: categoryId,
        payload: { name },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: categoryId, name });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const categoryRenameMatch = url.pathname.match(/^\/categories\/([^/]+)\/rename$/);
  if (req.method === "POST" && categoryRenameMatch) {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const categoryId = categoryRenameMatch[1]!;
      if (!ctx.currentState().categories.some((c) => c.id === categoryId)) {
        sendJson(res, 404, { error: "categoria não encontrada" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length === 0) {
        sendJson(res, 400, { error: "nome da categoria é obrigatório" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "category_renamed",
        aggregateType: "category",
        aggregateId: categoryId,
        payload: { name },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { id: categoryId, name });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const categoryDeleteMatch = url.pathname.match(/^\/categories\/([^/]+)$/);
  if (req.method === "DELETE" && categoryDeleteMatch) {
    const acting = ctx.requireOwner(res);
    if (!acting) return true;

    const categoryId = categoryDeleteMatch[1]!;
    const state = ctx.currentState();
    if (!state.categories.some((c) => c.id === categoryId)) {
      sendJson(res, 404, { error: "categoria não encontrada" });
      return true;
    }
    // PRD 3.4 — categoria com algum produto vinculado (ativo ou inativo) não
    // pode ser removida, pra evitar produto órfão sem categoria.
    if (state.products.some((p) => p.categoryId === categoryId)) {
      sendJson(res, 409, { error: "categoria tem produtos vinculados — remova os produtos primeiro" });
      return true;
    }

    const event = DomainEventSchema.parse({
      id: randomUUID(),
      hlc: nextHlc(),
      operatorId: acting.id,
      terminalId: ctx.terminalId,
      createdAt: Date.now(),
      type: "category_removed",
      aggregateType: "category",
      aggregateId: categoryId,
      payload: {},
    });
    insertEvent(ctx.db, event);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/products") {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const priceCents = body?.priceCents;
      const categoryId = typeof body?.categoryId === "string" ? body.categoryId : "";
      const active = typeof body?.active === "boolean" ? body.active : true;

      if (name.length === 0 || typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) {
        sendJson(res, 400, { error: "dados de produto inválidos" });
        return true;
      }
      if (!ctx.currentState().categories.some((c) => c.id === categoryId)) {
        sendJson(res, 400, { error: "categoria não encontrada" });
        return true;
      }

      const productId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "product_registered",
        aggregateType: "product",
        aggregateId: productId,
        payload: { name, priceCents, categoryId, active },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: productId, name, priceCents, categoryId, active });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const productStatusMatch = url.pathname.match(/^\/products\/([^/]+)\/status$/);
  if (req.method === "POST" && productStatusMatch) {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const productId = productStatusMatch[1]!;
      const product = ctx.currentState().products.find((p) => p.id === productId);
      if (!product) {
        sendJson(res, 404, { error: "produto não encontrado" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      if (typeof body?.active !== "boolean") {
        sendJson(res, 400, { error: "campo 'active' (boolean) é obrigatório" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "product_status_changed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { active: body.active },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { id: productId, active: body.active });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const productRenameMatch = url.pathname.match(/^\/products\/([^/]+)\/rename$/);
  if (req.method === "POST" && productRenameMatch) {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const productId = productRenameMatch[1]!;
      if (!ctx.currentState().products.some((p) => p.id === productId)) {
        sendJson(res, 404, { error: "produto não encontrado" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length === 0) {
        sendJson(res, 400, { error: "nome do produto é obrigatório" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "product_renamed",
        aggregateType: "product",
        aggregateId: productId,
        payload: { name },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { id: productId, name });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const productDeleteMatch = url.pathname.match(/^\/products\/([^/]+)$/);
  if (req.method === "DELETE" && productDeleteMatch) {
    const acting = ctx.requireOwner(res);
    if (!acting) return true;

    const productId = productDeleteMatch[1]!;
    if (!ctx.currentState().products.some((p) => p.id === productId)) {
      sendJson(res, 404, { error: "produto não encontrado" });
      return true;
    }

    // PRD 3.5 — remover produto não tem trava: itens de comanda já guardam
    // sua própria cópia de nome/preço no `item_added`, o produto pode sumir
    // do cadastro sem quebrar histórico.
    const event = DomainEventSchema.parse({
      id: randomUUID(),
      hlc: nextHlc(),
      operatorId: acting.id,
      terminalId: ctx.terminalId,
      createdAt: Date.now(),
      type: "product_removed",
      aggregateType: "product",
      aggregateId: productId,
      payload: {},
    });
    insertEvent(ctx.db, event);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
