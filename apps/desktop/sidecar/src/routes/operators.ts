import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema, OperatorRoleSchema, PinSchema } from "@tabwise/shared-types";
import { insertEvent, hashPin, verifyPin } from "@tabwise/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import { loadSession, saveSession, clearSession } from "../session.js";
import type { RequestContext } from "../context.js";

/** Épico 1 (PRD) — cadastro de operador e sessão de terminal por PIN. */
export async function handleOperatorRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/operators") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const nameResult = typeof body?.name === "string" && body.name.trim().length > 0;
      const roleResult = OperatorRoleSchema.safeParse(body?.role);
      const pinResult = PinSchema.safeParse(body?.pin);
      if (!nameResult || !roleResult.success || !pinResult.success) {
        sendJson(res, 400, { error: "dados de operador inválidos" });
        return true;
      }

      const operators = ctx.currentOperators();
      const session = loadSession(ctx.dataDir);

      // PRD 1.1 — só o dono cadastra operadores; exceto no bootstrap (nenhum
      // operador ainda existe), onde não há ninguém logado pra checar.
      if (operators.length > 0) {
        const actingOperator = operators.find((o) => o.id === session?.operatorId);
        if (!actingOperator || actingOperator.role !== "owner") {
          sendJson(res, 403, { error: "só o dono pode cadastrar operadores" });
          return true;
        }
      }

      // PRD 1.1 — PIN único por estabelecimento.
      for (const existing of operators) {
        if (await verifyPin(pinResult.data, existing.pinHash)) {
          sendJson(res, 409, { error: "PIN já em uso por outro operador" });
          return true;
        }
      }

      const operatorId = randomUUID();
      const pinHash = await hashPin(pinResult.data);
      const name = (body!.name as string).trim();
      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: session?.operatorId ?? operatorId, // bootstrap: o primeiro operador se autocadastra
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "operator_registered",
        aggregateType: "operator",
        aggregateId: operatorId,
        payload: { name, role: roleResult.data, pinHash },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 201, { id: operatorId, name, role: roleResult.data });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/session/login") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const pinResult = PinSchema.safeParse(body?.pin);
      if (!pinResult.success) {
        sendJson(res, 400, { error: "PIN inválido" });
        return true;
      }

      for (const operator of ctx.currentOperators()) {
        if (await verifyPin(pinResult.data, operator.pinHash)) {
          saveSession(ctx.dataDir, operator.id);
          sendJson(res, 200, { id: operator.id, name: operator.name, role: operator.role });
          return true;
        }
      }
      sendJson(res, 401, { error: "PIN incorreto" });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/session/logout") {
    clearSession(ctx.dataDir);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/session") {
    const session = loadSession(ctx.dataDir);
    const operator = session ? ctx.currentOperators().find((o) => o.id === session.operatorId) : undefined;
    if (!operator) {
      sendJson(res, 200, { operator: null });
      return true;
    }
    sendJson(res, 200, { operator: { id: operator.id, name: operator.name, role: operator.role } });
    return true;
  }

  return false;
}
