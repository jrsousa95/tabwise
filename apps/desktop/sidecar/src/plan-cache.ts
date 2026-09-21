import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PlanLimits {
  readonly maxConcurrentOrders: number;
  readonly maxTerminals: number;
}

/**
 * M10 (ARCH §6, PRD 8.2/2.7) — mesmos defaults do plano free em
 * `apps/backend/src/schema.sql`. Usado até o primeiro sync com a nuvem
 * acontecer (NFR1 — precisa funcionar 100% offline mesmo antes de
 * qualquer sync), e também como fallback se o cache no disco estiver
 * ausente/corrompido.
 */
export const DEFAULT_PLAN: PlanLimits = { maxConcurrentOrders: 10, maxTerminals: 1 };

/** ARCH §6 — cópia local do plano, atualizada a cada sync com a nuvem; enforcement acontece sempre sobre este cache, nunca chamando a nuvem em tempo real. */
export function loadPlanCache(dataDir: string): PlanLimits {
  const filePath = planCacheFilePath(dataDir);
  if (!existsSync(filePath)) return DEFAULT_PLAN;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof parsed?.maxConcurrentOrders === "number" && typeof parsed?.maxTerminals === "number") {
      return { maxConcurrentOrders: parsed.maxConcurrentOrders, maxTerminals: parsed.maxTerminals };
    }
    return DEFAULT_PLAN;
  } catch {
    return DEFAULT_PLAN;
  }
}

export function savePlanCache(dataDir: string, plan: PlanLimits): void {
  writeFileSync(planCacheFilePath(dataDir), JSON.stringify(plan), "utf8");
}

function planCacheFilePath(dataDir: string): string {
  return path.join(dataDir, "plan-cache.json");
}
