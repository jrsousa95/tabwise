---
title: 'Registrar sangria (Epic 1 / Story 1.2)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2632345598dda8eccf78c4d5200485c4b7d658ae'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Caixa/dono não tem como registrar uma retirada de dinheiro da gaveta durante o turno (segurança, troco excedente) sem que isso pareça uma diferença inexplicada no fechamento (história 1.4, ainda não implementada).

**Approach:** Novo evento `cash_withdrawal_recorded` (mesmo `aggregate_type: "cash_session"` já existente, `aggregateId` = sessão canônica aberta), populando o campo `withdrawals` de `CashSessionState` (já definido na Story 1.1, sempre vazio até agora). Rota não recebe id de sessão no path — só existe uma sessão canônica aberta por vez, o backend resolve sozinho.

## Boundaries & Constraints

**Always:**
- `cash_withdrawal_recorded` usa o MESMO `aggregate_type: "cash_session"` (não ganha tipo próprio — mesmo padrão de `item_added` usando `aggregateType: "order"`).
- `aggregateId` do evento = id da sessão canônica aberta no momento do registro (backend resolve via `isCashSessionOpen`/estado atual — cliente nunca informa um id de sessão).
- Só pode registrar sangria com uma sessão de caixa aberta (canônica) — sem sessão aberta, bloqueado ANTES de gravar evento.
- Valor em centavos, inteiro, > 0 (NFR7). Motivo é texto livre, obrigatório (não vazio após `trim()`).
- Acesso: caixa e dono; `waiter` bloqueado — mesma checagem inline por exclusão já usada na abertura de sessão (`cash-sessions.ts`).
- **Reatribuição histórica (mesmo princípio de `resolveCanonical` já usado pra `item_added` em `orders.ts`/`reconciliation.ts`):** um evento de sangria sincronizado depois, que referencia uma sessão que era canônica no momento do registro mas PERDEU um conflito de abertura concorrente (§4.2/§4.4) depois, precisa ser reatribuído à sessão canônica de verdade na projeção — nunca fica "perdido" na sessão perdedora. Implementar via um `resolveCanonicalCashSession(sessionId)` novo em `reconciliation.ts`, espelhando `resolveCanonical(orderId)` (segue `mergedInto` com detecção de ciclo).
- Funciona 100% offline (evento gravado local, sincroniza depois).

**Never:**
- Não implementar suprimento (1.3) ou fechamento com conferência (1.4) nesta story.
- Não pedir id de sessão no corpo da requisição nem no path da rota — o backend sempre resolve a sessão canônica sozinho (só existe uma).
- Não criar `requireOwnerOrCashier` em `context.ts` — mesma checagem inline já usada.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registro normal | Sessão aberta; `amountCents: 2000, reason: "reforço de troco pro cofre"` | `cash_withdrawal_recorded` gravado (aggregateId = sessão canônica); aparece em `cashSessions[].withdrawals` | N/A |
| Sem sessão aberta | Nenhuma sessão canônica aberta | Bloqueado antes de gravar evento | 400 "nenhuma sessão de caixa aberta" |
| Valor inválido | `amountCents` ausente, ≤ 0 ou não-inteiro | Rejeitado na validação | 400 "valor da sangria inválido" |
| Motivo vazio | `reason` ausente ou só espaços | Rejeitado na validação | 400 "motivo da sangria é obrigatório" |
| Papel waiter | Operador logado é garçom | Acesso negado | 403 "garçom não pode registrar sangria" |
| Reatribuição histórica | Sangria registrada contra sessão X; depois do sync, X perde conflito de abertura pra sessão Y (menor HLC) | Projeção reatribui a sangria pra `withdrawals` da sessão Y (canônica), não de X | N/A — resolvido na projeção, sem erro |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/events.ts` -- novo `CashWithdrawalRecordedSchema` (`aggregateType: "cash_session"`, payload `{amountCents: z.number().int().positive(), reason: z.string().trim().min(1)}`); adicionar à união `DomainEventSchema`
- `packages/shared-types/test/events.test.ts` -- fixture + teste de validação (valor inválido, motivo vazio) pro tipo novo (24→25 tipos)
- `packages/sync-engine/src/reconciliation.ts` -- novo `resolveCanonicalCashSession(sessionId): MutableCashSession` espelhando `resolveCanonical(orderId)` (linha ~244: segue `mergedInto`, detecta ciclo, lança erro se referência desconhecida); novo `case "cash_withdrawal_recorded"` que resolve a canônica e dá `push` num novo `CashMovementRecord` em `.withdrawals`
- `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- ESTENDER (não criar arquivo novo) com um teste cobrindo a linha "Reatribuição histórica" da matriz: sangria registrada contra a sessão que depois perde o conflito, verificar que aparece em `withdrawals` da canônica
- `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- ESTENDER (mesmo arquivo, mesmo `handleCashSessionRoutes`) com `POST /cash-sessions/withdrawals` (sem id no path — resolve a sessão canônica via `state.cashSessions.find(s => s.mergedInto === undefined && s.status === "open")`, mesmo filtro de `isCashSessionOpen`): `requireSession` + bloqueio inline de `waiter` (403 "garçom não pode registrar sangria") → resolve sessão aberta (400 "nenhuma sessão de caixa aberta" se não achar) → valida `amountCents`/`reason` (400) → grava evento com `aggregateId` = id da sessão resolvida
- `apps/desktop/src/lib/cash-sessions.ts` -- nova função `recordWithdrawal(amountCents, reason)` (mesmo padrão de `openCashSession`, reaproveitando o `postJson` já existente no arquivo)
- `apps/desktop/src/routes/cash-register.tsx` -- `CashSessionSection`: quando `openSession` existe, adicionar um segundo formulário inline (valor + motivo) pra sangria, abaixo da linha "Sessão aberta desde..."; listar as sangrias já registradas nesta sessão (`openSession.withdrawals`) como uma lista simples
- `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- ESTENDER o CENÁRIO 4 (sessão de caixa) já existente com as asserções novas desta story (registro normal, bloqueio sem sessão, bloqueio de garçom) — não criar cenário novo, é o mesmo fluxo de sessão de caixa

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/events.ts` -- criar `CashWithdrawalRecordedSchema` + adicionar à união -- schema do evento novo
- [x] `packages/shared-types/test/events.test.ts` -- fixture + validação (valor/motivo inválidos) -- cobertura de schema
- [x] `packages/sync-engine/src/reconciliation.ts` -- `resolveCanonicalCashSession`, `case "cash_withdrawal_recorded"` -- projeção + reatribuição histórica
- [x] `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- teste de reatribuição histórica de sangria -- regressão do mecanismo
- [x] `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- `POST /cash-sessions/withdrawals` -- endpoint novo
- [x] `apps/desktop/src/lib/cash-sessions.ts` -- `recordWithdrawal` -- cliente API
- [x] `apps/desktop/src/routes/cash-register.tsx` -- formulário + lista de sangrias em `CashSessionSection` -- interface do usuário
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender CENÁRIO 4 com sangria (normal, sem sessão, garçom bloqueado) -- cobertura de rota HTTP real (lição da story 1.1: matriz I/O precisa de teste no nível de rota, não só de projeção)

**Acceptance Criteria:**
- Given uma sessão de caixa aberta, when o operador (caixa/dono) informa valor e motivo válidos e confirma, then `cash_withdrawal_recorded` é gravado com `aggregateId` da sessão canônica e aparece em `withdrawals`
- Given nenhuma sessão aberta, when o operador tenta registrar sangria, then bloqueado com mensagem clara, sem gravar evento
- Given valor zero/negativo/não-inteiro ou motivo vazio, when o operador tenta confirmar, then a validação impede o envio
- Given o operador logado é `waiter`, when tenta registrar sangria, then acesso negado
- Given uma sangria registrada contra uma sessão que depois perde um conflito de abertura concorrente, when a projeção é recalculada após o sync, then a sangria aparece em `withdrawals` da sessão canônica, não da perdedora

### Review Findings

`bmad-build` step 4 (3 camadas: `blind-hunter`, `edge-case-hunter`, `verification-gap`). Cada achado verificado contra o código real antes do veredito.

- [x] `[Review][Patch]` `apps/desktop/src/lib/cash-sessions.ts`: JSDoc de `CashSessionState` ainda diz que `withdrawals` "chegam vazios/ausentes nesta story (sangria... 1.2...)" — desatualizado. Corrigido. *blind-hunter*.
- [x] `[Review][Patch]` `POST /cash-sessions/withdrawals` checava "sem sessão aberta" antes de ler o corpo da requisição, deixando o corpo não-drenado no retorno antecipado. Corrigido — corpo lido e validado primeiro, mesma ordem de `POST /cash-sessions` (1.1). [apps/desktop/sidecar/src/routes/cash-sessions.ts] *blind-hunter*.
- [x] `[Review][Patch]` `handleSubmit` (formulário de sangria) não chamava `onRecorded()`/`refresh()` quando o servidor rejeita. Corrigido — mesmo fix já aplicado ao `handleOpen` na Story 1.1. [apps/desktop/src/routes/cash-register.tsx] *edge-case-hunter*.
- [x] `[Review][Patch]` `concurrency-scenario.mjs`: asserção sem guarda `canonical &&`. Corrigido. [apps/desktop/sidecar/test/concurrency-scenario.mjs] *edge-case-hunter*.
- [x] `[Review][Defer]` `catch` amplo em `cash-sessions.ts` rotula qualquer erro (inclusive falha de `insertEvent`) como JSON inválido — mesmo padrão já adiado na revisão da Story 1.1 (duplicado aqui na rota nova, mesma causa raiz). *blind-hunter + edge-case-hunter*.
- [x] `[Review][Defer]` Sem checagem de sanidade do valor da sangria contra o que realmente está na gaveta (fundo + vendas em dinheiro − sangrias + suprimentos) — real, mas calcular isso corretamente exige o mecanismo de valor esperado que só a história 1.4 constrói; implementar aqui seria antecipar escopo de outra story. *blind-hunter*.

**Rejeitados:**
- `reason` sem tamanho máximo — **[false]** mesmo padrão já usado em `ItemCanceledSchema.note` (texto livre sem limite), não é lacuna introduzida por esta story.
- Mensagens de validação duplicadas entre rota e frontend (`cash-register.tsx`/`cash-sessions.ts`) — **[false]** mesmo padrão já presente desde a Story 1.1 sem nenhum resultado incorreto demonstrado hoje; risco de manutenção, não defeito.
- `WithdrawalForm` sem `key` ligada a `openSession.id` — **[false]** o componente não guarda estado ligado à sessão que renderizaria informação errada numa troca (a lista de sangrias vem sempre de props, sempre correta); no máximo um rascunho de texto sobrevive, que não é dado incorreto.
- Falta teste de cadeia multi-hop / detecção de ciclo / id desconhecido em `resolveCanonicalCashSession` — **[false]** essas trilhas são inalcançáveis no sistema atual: só existe UM slot canônico por vez e toda sessão perdedora aponta direto pra ele (nunca pra outra perdedora) — mesmo raciocínio que já torna essas trilhas de `resolveCanonical` (orders) não testadas.
- `amountCents` sem `.max()` / risco de `MAX_SAFE_INTEGER` — **[false]** mesmo já verificado na Story 1.1: consistente com 100% dos campos monetários do schema, não é lacuna desta story.

## Implementation Notes

- Todos os arquivos do Code Map foram tocados exatamente como descrito; nenhum desvio de escopo. `cash_withdrawal_recorded` usa `aggregateType: "cash_session"` (sub-evento, sem tipo próprio no enum `AggregateTypeSchema`, que já tinha `"cash_session"` desde a Story 1.1).
- `resolveCanonicalCashSession(sessionId)` em `reconciliation.ts` espelha `resolveCanonical(orderId)` linha por linha (segue `mergedInto`, detecta ciclo, lança erro se referência desconhecida) — permanece função local dentro de `project()`, não exportada, mesmo padrão de `resolveCanonical`.
- `POST /cash-sessions/withdrawals` segue a ordem exata pedida no Code Map: `requireSession` -> bloqueio inline de `waiter` (403 "garçom não pode registrar sangria") -> resolve a sessão canônica aberta via o mesmo filtro de `isCashSessionOpen` (400 "nenhuma sessão de caixa aberta" se não achar) -> valida `amountCents` (400 "valor da sangria inválido") -> valida `reason` após `trim()` (400 "motivo da sangria é obrigatório") -> grava o evento com `aggregateId` = id da sessão resolvida. Nenhum helper novo em `context.ts`.
- UI: `WithdrawalForm` (novo componente em `cash-register.tsx`) aparece abaixo da linha "Sessão aberta desde..." dentro de `CashSessionSection`, reaproveitando `.inline-form`/`.table-map-section`/`.catalog-list` já catalogados (nenhum componente/estilo novo). Lista as sangrias já registradas (`openSession.withdrawals`), mais recente primeiro.
- **Achado durante a verificação (risco relevante para o próximo dev):** o build local tinha `packages/shared-types/dist` e `packages/sync-engine/dist` desatualizados em relação ao `src` (dist anterior à Story 1.2, de antes desta sessão de trabalho) — o sidecar importa esses pacotes pelo `dist` compilado, não pelo `src`. Isso fez a primeira rodada do `concurrency-scenario.mjs` falhar silenciosamente: a rota aceitava a sangria (201) mas a projeção não tinha o `case "cash_withdrawal_recorded"` novo, então `withdrawals` ficava vazio no `/state`. Corrigido rodando `npm run build -w packages/shared-types` e `npm run build -w packages/sync-engine` antes de `npm run build -w apps/desktop`. Isso não é specífico desta story — é um risco de processo (dist desatualizado mascarando regressão) que vale documentar: sempre rebuildar os pacotes de dependência antes de rodar o smoke test do sidecar, não só o bundle dele.

## Spec Change Log

## Review Triage Log

## Design Notes

`resolveCanonicalCashSession` existe pelo mesmo motivo que `resolveCanonical` (orders) existe: um evento (`cash_withdrawal_recorded`) pode ter sido gravado, num terminal offline, contra uma sessão que ERA a canônica local naquele momento, mas que depois de sincronizar com outro terminal perde o conflito de abertura concorrente (§4.2/§4.4). Sem essa reatribuição, a sangria "some" da sessão que realmente importa pro cálculo do valor esperado (história 1.4). A rota HTTP em si nunca precisa disso pro caminho normal (sempre resolve a sessão canônica atual antes de gravar) — é só a projeção replay de um log já mesclado que precisa desse cuidado, exatamente como já acontece hoje pra `item_added` numa order perdedora.

## Verification

**Commands:**
- `npm test -w packages/shared-types` -- PASSOU (11 testes, incluindo fixture + validação de `cash_withdrawal_recorded`)
- `npm test -w packages/sync-engine` -- PASSOU (12 arquivos, 62 testes, incluindo o teste novo de reatribuição histórica em `arch-4.4-cash-session-conflict.test.ts`)
- `npx tsc --noEmit -p packages/shared-types`, `-p packages/sync-engine`, `-p apps/desktop/sidecar`, `-p apps/desktop` -- PASSOU nos 4 workspaces (depois de rebuildar `dist` de `shared-types`/`sync-engine` — ver Implementation Notes)
- `npm run build -w apps/desktop` -- PASSOU (build de produção do frontend + typecheck/bundle/SEA do sidecar, tudo limpo)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- PASSOU, CENÁRIO 4 estendido cobrindo TODAS as 6 linhas da matriz I/O no nível de rota HTTP real: bloqueio de garçom (403), bloqueio sem sessão aberta (400), valor inválido (400), motivo vazio (400), registro normal (201, propagado e visível em `withdrawals` nos dois terminais A/B). "TODOS OS CENÁRIOS PASSARAM."

**Auditoria da matriz I/O (orquestrador, pós-implementação):** o subagent de implementação justificou não ter teste de rota HTTP pra "valor inválido"/"motivo vazio" citando a Story 1.1 como precedente ("não exigiu teste HTTP dedicado pra essas duas linhas") — **essa alegação é falsa**: a 1.1 testa "valor de abertura inválido" no nível de rota em `concurrency-scenario.mjs` (`invalidAmount`, linha ~232 do arquivo). Corrigido adicionando as 2 asserções que faltavam (`invalidWithdrawalAmount`, `emptyReason`) no mesmo CENÁRIO 4, antes do registro normal de sangria. Rebuild completo (`shared-types`/`sync-engine`/sidecar bundle) + `concurrency-scenario.mjs` re-executado — passou.

**Manual checks:** nenhum restante — as 6 linhas da matriz I/O têm cobertura automatizada que rodou e passou: as 5 primeiras no nível de rota HTTP real (`concurrency-scenario.mjs`), reatribuição histórica no nível de projeção (`arch-4.4-cash-session-conflict.test.ts`). Valor/motivo inválidos também têm cobertura redundante no nível de schema (`events.test.ts`).
