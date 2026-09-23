import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema } from "@passa-a-regua/shared-types";
import { insertEvent } from "@passa-a-regua/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/** Épico 2 (PRD) — cadastro de mesas (cadastrar, renomear, remover). */
export async function handleTableRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/tables") {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
      const capacity = body?.capacity;
      if (identifier.length === 0) {
        sendJson(res, 400, { error: "identificador da mesa é obrigatório" });
        return true;
      }
      if (capacity !== undefined && (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0)) {
        sendJson(res, 400, { error: "capacidade precisa ser um número inteiro positivo" });
        return true;
      }

      const tableId = randomUUID();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "table_registered",
        aggregateType: "table",
        aggregateId: tableId,
        payload: capacity === undefined ? { identifier } : { identifier, capacity },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: tableId, identifier, capacity });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const tableRenameMatch = url.pathname.match(/^\/tables\/([^/]+)\/rename$/);
  if (req.method === "POST" && tableRenameMatch) {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const tableId = tableRenameMatch[1]!;
      if (!ctx.currentState().tables.some((t) => t.id === tableId)) {
        sendJson(res, 404, { error: "mesa não encontrada" });
        return true;
      }

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
      const capacity = body?.capacity;
      if (identifier.length === 0) {
        sendJson(res, 400, { error: "identificador da mesa é obrigatório" });
        return true;
      }
      if (capacity !== undefined && (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity <= 0)) {
        sendJson(res, 400, { error: "capacidade precisa ser um número inteiro positivo" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "table_renamed",
        aggregateType: "table",
        aggregateId: tableId,
        payload: capacity === undefined ? { identifier } : { identifier, capacity },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { id: tableId, identifier, capacity });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  const tableDeleteMatch = url.pathname.match(/^\/tables\/([^/]+)$/);
  if (req.method === "DELETE" && tableDeleteMatch) {
    const acting = ctx.requireOwner(res);
    if (!acting) return true;

    const tableId = tableDeleteMatch[1]!;
    const state = ctx.currentState();
    if (!state.tables.some((t) => t.id === tableId)) {
      sendJson(res, 404, { error: "mesa não encontrada" });
      return true;
    }
    // PRD 2.8 — mesa com comanda aberta agora não pode ser removida.
    if (!ctx.isTableFree(state, tableId)) {
      sendJson(res, 409, { error: "mesa tem uma comanda aberta — feche a comanda antes de remover a mesa" });
      return true;
    }

    const event = DomainEventSchema.parse({
      id: randomUUID(),
      hlc: nextHlc(),
      operatorId: acting.id,
      terminalId: ctx.terminalId,
      createdAt: Date.now(),
      type: "table_removed",
      aggregateType: "table",
      aggregateId: tableId,
      payload: {},
    });
    insertEvent(ctx.db, event);
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}
