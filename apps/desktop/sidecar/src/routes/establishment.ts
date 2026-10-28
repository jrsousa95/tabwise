import type http from "node:http";
import { randomUUID } from "node:crypto";
import { DomainEventSchema } from "@tabwise/shared-types";
import { insertEvent } from "@tabwise/sync-engine";
import { sendJson, readJsonBody } from "../http-helpers.js";
import { nextHlc } from "../clock.js";
import type { RequestContext } from "../context.js";

/** PRD 5.1 — taxa de serviço padrão configurável do estabelecimento (singleton, `aggregateId` fixo). */
export async function handleEstablishmentRoutes(req: http.IncomingMessage, res: http.ServerResponse, url: URL, ctx: RequestContext): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/establishment/settings") {
    try {
      const acting = ctx.requireOwner(res);
      if (!acting) return true;

      const body = (await readJsonBody(req)) as Record<string, unknown> | undefined;
      const defaultServiceFeePercent = body?.defaultServiceFeePercent;
      if (typeof defaultServiceFeePercent !== "number" || defaultServiceFeePercent < 0) {
        sendJson(res, 400, { error: "taxa de serviço padrão precisa ser um número >= 0" });
        return true;
      }

      const event = DomainEventSchema.parse({
        id: randomUUID(),
        hlc: nextHlc(),
        operatorId: acting.id,
        terminalId: ctx.terminalId,
        createdAt: Date.now(),
        type: "establishment_settings_updated",
        aggregateType: "establishment",
        aggregateId: "establishment",
        payload: { defaultServiceFeePercent },
      });
      insertEvent(ctx.db, event);
      sendJson(res, 200, { defaultServiceFeePercent });
    } catch {
      sendJson(res, 400, { error: "corpo da requisição não é um JSON válido" });
    }
    return true;
  }

  return false;
}
