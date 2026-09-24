# Reality-check review — architecture.md §3.4/3.5/4.4, §5 (9.8/9.9), §11

Reviewer lens: "committed decisions verified against web / existing code / starter defaults, not asserted from training data." Scope: new Épico 9 sections only.

## Scope note (check 4)
No external libraries, frameworks, or version numbers are named anywhere in §3.4, §3.5, §4.4, the new §5 paragraph, or §11. The only technology references in the whole document are in §2/§3.3/§9 (Tauri sidecar, `bonjour-service`/`multicast-dns`, `@clockwork/hlc`), all pre-existing and out of scope for this pass. So this review lens comes back clean by scope — there is nothing web-verifiable to check in the new material; every claim in it is a claim about the *existing local codebase*, which is checkable directly and was checked below.

## Checks performed

### 1. §3.4 event/aggregate conventions vs. real code — HOLDS
Checked `packages/shared-types/src/events.ts` and `packages/shared-types/src/common.ts`:
- `aggregate_type` per real entity, `aggregate_id` generated at creation and reused by lifecycle events: confirmed by `order_opened`→`item_added`/`item_canceled` (all `aggregateType: "order"`, same `aggregateId`) and `category_registered`→`category_renamed` (both `aggregateType: "category"`, same id). §3.4's proposed `cash_session_opened`→`cash_session_closed`/`cash_withdrawal_recorded`/`cash_deposit_recorded` (all `aggregateType: "cash_session"`, session id reused) follows this exactly.
- "Sangria/suprimento não ganham aggregate_type próprio — mesmo padrão de item_added (que usa aggregateType: "order", não um "item" inexistente)": confirmed, `ItemAddedSchema.aggregateType` is literally `"order"` (events.ts:265), there is no `"item"` aggregate type anywhere. Accurate analogy.
- Minor gap (not a misdescription, just unstated): `AggregateTypeSchema` in `common.ts:18` is a closed zod enum (`operator | order | table_group | category | product | table | establishment`) that does not yet include `cash_session`. §3.4 correctly flags `cash_session` as "(novo)" but doesn't explicitly note this enum needs extending. Not a factual error, just an implementation detail left implicit — worth a one-line callout if this doc is meant to fully brief the dev, but not a defect.
- `CashSessionState`/`CashMovementRecord` shape (Map-based, `readonly` fields, mirrors `OrderState`/`ClosingState` shape in `reconciliation.ts`) matches the existing materialized-state pattern (`orders: Map<string, MutableOrder>` → exposed as arrays; `ClosingState` as an optional nested object) closely. No contradiction found.

### 2. §3.4 claim "ClosingState lacks operatorId, but order_closed already carries operatorId on the base event" — HOLDS
- `packages/sync-engine/src/reconciliation.ts:53-60`: `ClosingState` has exactly `subtotalCents, serviceFeePercent, serviceFeeCents, totalCents, closedAt` — no `operatorId`. Confirmed absent.
- `packages/shared-types/src/common.ts:31-37`: `baseEventSchema` has `operatorId: z.string().min(1)` as a required field on every event, including `order_closed` (which extends `baseEventSchema`, `events.ts:335-347`).
- "desde sempre" claim verified via `git log --follow -- packages/shared-types/src/common.ts`: `operatorId` was present on `baseEventSchema` as far back as the M3 commit (`e736749`, "autenticação e operadores"), well before `order_closed`/M7 (`2c7fbb1`) existed. So `operatorId` predates the event that's said to already carry it. Claim holds.

### 3. §3.5 claim "computeCashRegisterSummary has exactly two current call sites (sidecar M8, backend M11)" — HOLDS
Grep across the repo for `computeCashRegisterSummary` call sites (excluding its own definition and tests):
- `apps/desktop/sidecar/src/routes/state.ts:24`
- `apps/backend/src/index.ts:242`
No other production call sites. (A third reference exists only in `packages/sync-engine/test/reporting.test.ts`, which is a test, not a caller in the sense architecture.md means.) The M8/M11 attribution matches the extraction history documented in `reporting.ts`'s own docstring ("Extraído do sidecar (M8) pro sync-engine no M11 pra ser reaproveitado tal e qual pelo endpoint de relatório do backend").

### 5. Other claims spot-checked
- §4.2 mechanics restated in §4.4 ("evento com menor HLC é a canônica, mesmo automático, sem bloqueio"): confirmed against `reconciliation.ts:273-297` (`tableToCanonicalOrder` — first `order_opened` processed in HLC order wins, later one gets `mergedInto` set). Accurate.
- §4.4 "mesmo padrão já usado por maxConcurrentOrders" (local-to-terminal enforcement without cross-terminal coordination): confirmed `maxConcurrentOrders()` is read from a local plan cache and enforced in `apps/desktop/sidecar/src/routes/orders.ts:25-26`, i.e. purely local per-terminal check, no cross-terminal coordination — same shape of claim (local invariant, no distributed conflict resolution needed). The analogy is a little loose (plan-limit enforcement vs. "only one open session" isn't literally the same invariant), but not factually wrong.
- New §5 paragraph: `GET /reports/cash-register` exists and does what's described — confirmed at `apps/backend/src/index.ts:237-242`, with the comment there explicitly saying the endpoint exists without any remote screen consuming it yet, matching "sem UI associada até agora."
- 9.9 "exportação CSV é geração client-side a partir do CashRegisterSummary já retornado por §3.5" — `CashRegisterSummary` interface exists as described in `reporting.ts:12-20`; this is a forward-looking design choice, not a claim about current code, and is consistent with the existing return shape.

## Verdict
Clean. No misdescriptions or unverified/outdated technical claims found in §3.4, §3.5, §4.4, the new §5 paragraph, or §11. All checkable factual claims about the existing codebase (event schema conventions, `ClosingState`/`operatorId`, `computeCashRegisterSummary` call sites, the `/reports/cash-register` endpoint, §4.2 mechanics) match the real code. No external library/version claims are made in this material, so the "web-verify versions" lens is out of scope by construction rather than skipped. Only a very minor, non-blocking observation: §3.4 doesn't explicitly flag that `AggregateTypeSchema` (a closed zod enum in `common.ts`) will need `cash_session` added to it.
