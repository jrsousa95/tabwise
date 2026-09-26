---
title: 'Registrar suprimento (Epic 1 / Story 1.3)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3f4d6e08eb3a9b8c2f65b0ddbdb62b357a0aa935'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Caixa/dono não tem como registrar um reforço de dinheiro na gaveta durante o turno (repor troco) sem que isso pareça uma venda a mais no fechamento (história 1.4, ainda não implementada).

**Approach:** Espelho exato da Story 1.2 (sangria), evento oposto: novo `cash_deposit_recorded` (mesmo `aggregate_type: "cash_session"`, `aggregateId` = sessão canônica aberta), populando `deposits` de `CashSessionState` (já existe, sempre vazio até agora). Mesma rota-irmã sem id de sessão no path — o backend resolve sozinho.

## Boundaries & Constraints

**Always:**
- `cash_deposit_recorded` usa o MESMO `aggregate_type: "cash_session"` (sub-evento, mesmo padrão de `cash_withdrawal_recorded`).
- `aggregateId` do evento = id da sessão canônica aberta no momento do registro (backend resolve; cliente nunca informa um id de sessão).
- Só pode registrar suprimento com uma sessão de caixa aberta (canônica) — sem sessão aberta, bloqueado.
- Valor em centavos, inteiro, > 0 (NFR7). Motivo é texto livre, obrigatório (não vazio após `trim()`).
- Acesso: caixa e dono; `waiter` bloqueado — mesma checagem inline por exclusão já usada em `cash-sessions.ts`.
- **Ordem da rota (lição das Stories 1.1/1.2): ler e validar o corpo (`amountCents`/`reason`) ANTES de resolver a sessão aberta** — nunca deixar um retorno antecipado sem drenar o corpo do socket primeiro.
- **Reatribuição histórica:** reaproveitar `resolveCanonicalCashSession` já existente em `reconciliation.ts` (criado na Story 1.2) — não recriar.
- Funciona 100% offline (evento gravado local, sincroniza depois).

**Never:**
- Não implementar fechamento com conferência (1.4) nesta story.
- Não pedir id de sessão no corpo da requisição nem no path da rota.
- Não criar `requireOwnerOrCashier` em `context.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registro normal | Sessão aberta; `amountCents: 5000, reason: "reposição de troco"` | `cash_deposit_recorded` gravado (aggregateId = sessão canônica); aparece em `cashSessions[].deposits` | N/A |
| Sem sessão aberta | Nenhuma sessão canônica aberta | Bloqueado antes de gravar evento | 400 "nenhuma sessão de caixa aberta" |
| Valor inválido | `amountCents` ausente, ≤ 0 ou não-inteiro | Rejeitado na validação | 400 "valor do suprimento inválido" |
| Motivo vazio | `reason` ausente ou só espaços | Rejeitado na validação | 400 "motivo do suprimento é obrigatório" |
| Papel waiter | Operador logado é garçom | Acesso negado | 403 "garçom não pode registrar suprimento" |
| Reatribuição histórica | Suprimento registrado contra sessão X; depois do sync, X perde conflito de abertura pra sessão Y (menor HLC) | Projeção reatribui o suprimento pra `deposits` da sessão Y (canônica), não de X | N/A — resolvido na projeção, sem erro |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/events.ts` -- novo `CashDepositRecordedSchema` (mesmo molde de `CashWithdrawalRecordedSchema`: `aggregateType: "cash_session"`, payload `{amountCents: z.number().int().positive(), reason: z.string().trim().min(1)}`); adicionar à união `DomainEventSchema` (25→26 tipos)
- `packages/shared-types/test/events.test.ts` -- fixture + teste de validação (valor inválido, motivo vazio), mesmo padrão de `cash_withdrawal_recorded`
- `packages/sync-engine/src/reconciliation.ts` -- novo `case "cash_deposit_recorded"` (mesmo corpo de `case "cash_withdrawal_recorded"`, linha ~524, mas dá `push` em `.deposits` em vez de `.withdrawals`); REAPROVEITA `resolveCanonicalCashSession` já existente (não recriar)
- `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- ESTENDER com um teste de reatribuição histórica de suprimento, espelhando o teste de sangria já existente
- `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- ESTENDER (mesmo arquivo) com `POST /cash-sessions/deposits`, cópia estrutural exata de `POST /cash-sessions/withdrawals` (linhas 64-126): `requireSession` → bloqueio inline de `waiter` (403 "garçom não pode registrar suprimento") → lê e valida `amountCents`/`reason` (400) → resolve sessão aberta (400 "nenhuma sessão de caixa aberta" se não achar) → grava evento com `type: "cash_deposit_recorded"`
- `apps/desktop/src/lib/cash-sessions.ts` -- nova função `recordDeposit(amountCents, reason)` (mesmo padrão de `recordWithdrawal`)
- `apps/desktop/src/routes/cash-register.tsx` -- novo componente `DepositForm` (cópia estrutural de `WithdrawalForm`, valor+motivo, lista de `openSession.deposits` com fallback `?? []`), renderizado ao lado de `WithdrawalForm` dentro de `CashSessionSection`; `handleSubmit` chama `onRecorded()` tanto no sucesso quanto no erro (lição da 1.2)
- `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- ESTENDER o CENÁRIO 4 com as mesmas 5 asserções de rota HTTP já feitas pra sangria (garçom bloqueado, sem sessão, valor inválido, motivo vazio, registro normal + propagação), agora pra suprimento

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/events.ts` -- criar `CashDepositRecordedSchema` + adicionar à união -- schema do evento novo
- [x] `packages/shared-types/test/events.test.ts` -- fixture + validação -- cobertura de schema
- [x] `packages/sync-engine/src/reconciliation.ts` -- `case "cash_deposit_recorded"` reaproveitando `resolveCanonicalCashSession` -- projeção + reatribuição histórica
- [x] `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- teste de reatribuição histórica de suprimento -- regressão do mecanismo
- [x] `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- `POST /cash-sessions/deposits` -- endpoint novo, ordem corpo-antes-de-sessão desde o início
- [x] `apps/desktop/src/lib/cash-sessions.ts` -- `recordDeposit` -- cliente API
- [x] `apps/desktop/src/routes/cash-register.tsx` -- `DepositForm` em `CashSessionSection` -- interface do usuário
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender CENÁRIO 4 com as 5 linhas da matriz no nível de rota HTTP real

**Acceptance Criteria:**
- Given uma sessão de caixa aberta, when o operador (caixa/dono) informa valor e motivo válidos e confirma, then `cash_deposit_recorded` é gravado com `aggregateId` da sessão canônica e aparece em `deposits`
- Given nenhuma sessão aberta, when o operador tenta registrar suprimento, then bloqueado com mensagem clara, sem gravar evento
- Given valor zero/negativo/não-inteiro ou motivo vazio, when o operador tenta confirmar, then a validação impede o envio
- Given o operador logado é `waiter`, when tenta registrar suprimento, then acesso negado
- Given um suprimento registrado contra uma sessão que depois perde um conflito de abertura concorrente, when a projeção é recalculada após o sync, then o suprimento aparece em `deposits` da sessão canônica, não da perdedora

### Review Findings

`bmad-build` step 4 (3 camadas). Cada achado verificado contra o código real antes do veredito.

- [x] `[Review][Patch]` `sprint-status.yaml` ficou em `in-progress`. Corrigido pra `review`. *blind-hunter*.
- [x] `[Review][Patch]` `POST /cash-sessions/withdrawals` e `POST /cash-sessions/deposits` eram duplicação quase byte-a-byte. Corrigido — extraído `handleCashMovementRoute` compartilhado, parametrizado por tipo de evento e mensagens; comportamento re-verificado idêntico (`concurrency-scenario.mjs` passou de novo, sem alteração nas asserções). [apps/desktop/sidecar/src/routes/cash-sessions.ts] *blind-hunter*.
- [x] `[Review][Defer]` Mesmo padrão de duplicação um nível acima: `recordDeposit`/`recordWithdrawal` (`lib/cash-sessions.ts`) e `DepositForm`/`WithdrawalForm` (`cash-register.tsx`) são estruturalmente idênticos, sem abstração compartilhada. [apps/desktop/src/lib/cash-sessions.ts, apps/desktop/src/routes/cash-register.tsx] — deferred: refatorar componente React sem nenhuma rede de teste no frontend (achado já confirmado como convenção pré-existente do projeto) é mais arriscado que o ganho imediato — melhor esperar a história 1.4 trazer a terceira forma e refatorar as três de uma vez, com mais contexto do formato final. *blind-hunter*.
- [x] `[Review][Defer]` `recordDeposit`/`DepositForm.handleSubmit` não trata rejeição do `fetch()` em si — mesma causa raiz já adiada nas Stories 1.2/1.1 (`postJson` não tem `try/catch` ao redor do `fetch`), reaparecendo no componente novo. *edge-case-hunter, achado duplicado*.

**Rejeitados:**
- Testes de "valor inválido" só testam `0`, nunca um número negativo, apesar do nome da variável (`zeroOrNegative`) sugerir os dois casos — **[false]** a comparação usada (`amountCents <= 0`) é um único operador que estruturalmente rejeita zero e negativo do mesmo jeito; não há como passar um e falhar o outro com essa checagem.
- Nenhum teste de uma sessão acumulando sangria E suprimento na mesma passada de projeção — **[false]** os dois `case`s escrevem em campos (`.withdrawals`/`.deposits`) completamente separados, sem estado compartilhado que pudesse interferir — não há como um afetar o outro por construção.
- Sem cobertura de teste do componente `DepositForm` em si (disable, limpeza de erro, sort) — **[false]** confirmado pelo `verification-gap`: convenção pré-existente do projeto inteiro (zero testes de componente React em qualquer lugar do app), não lacuna introduzida por esta story.
- `amountCents`/`reason` sem limite superior — **[false]** mesmo já aceito nas Stories 1.1/1.2, consistente em todo o schema.
- Resposta 201 não devolve o id da sessão em que o suprimento foi registrado — **[false]** nenhum caller hoje precisa disso — `DepositForm` só olha `result.ok`/`result.error` e sempre recarrega o estado inteiro via `onRecorded()` → `refresh()`.

## Implementation Notes

- Todos os arquivos do Code Map foram tocados exatamente como descrito; nenhum desvio de escopo. `cash_deposit_recorded` usa `aggregateType: "cash_session"` (sub-evento, sem tipo próprio), espelho estrutural de `cash_withdrawal_recorded`.
- `resolveCanonicalCashSession` foi REAPROVEITADA de `reconciliation.ts` (criada na Story 1.2) — nenhuma função nova de reatribuição foi criada, só o novo `case "cash_deposit_recorded"` que dá `push` em `.deposits` em vez de `.withdrawals`.
- `POST /cash-sessions/deposits`: mesma ordem corpo-antes-de-sessão desde o início (`requireSession` -> bloqueio inline de `waiter`, 403 "garçom não pode registrar suprimento" -> lê e valida `amountCents`/`reason`, 400 -> resolve sessão canônica aberta, 400 "nenhuma sessão de caixa aberta" se não achar -> grava evento). Nenhum helper novo em `context.ts`.
- UI: `DepositForm` (novo componente em `cash-register.tsx`) renderizado logo abaixo de `WithdrawalForm`, dentro de `CashSessionSection`, reaproveitando as mesmas classes (`.inline-form`/`.table-map-section`/`.catalog-list`). `handleSubmit` chama `onRecorded()` tanto no sucesso quanto no erro (mesmo fix já aplicado à sangria na 1.2). `openSession.deposits ?? []` como fallback de sidecar desatualizado, mesmo racional de `withdrawals`.
- **Risco de processo (já documentado na Story 1.2, reincidiu aqui):** `packages/shared-types/dist` e `packages/sync-engine/dist` ficam desatualizados em relação ao `src` entre sessões de trabalho — o sidecar importa esses pacotes pelo `dist` compilado. Rebuildar só `shared-types` e pular `sync-engine` faz o `concurrency-scenario.mjs` falhar silenciosamente: a rota aceita o suprimento (201), mas a projeção embutida no bundle do sidecar não tem o `case "cash_deposit_recorded"` novo, então `deposits` fica vazio no `/state` e o teste de propagação estoura em timeout (sem nenhuma mensagem de erro real). Aconteceu exatamente isso nesta verificação; corrigido rodando `npm run build -w packages/sync-engine` antes de `npm run build:bundle -w apps/desktop/sidecar`. Recomendação pro próximo dev: sempre rebuildar TODOS os pacotes de dependência (`shared-types` E `sync-engine`) antes do smoke test do sidecar, não só o pacote que a story tocou diretamente.
- Nenhum code review formal (`bmad-code-review`) foi rodado nesta sessão — só a implementação + verificação dos comandos abaixo. Status do spec mantido em `in-progress` até esse passo acontecer (mesmo ciclo da Story 1.2: implementação primeiro, `status: done` só depois da rodada de review).

## Spec Change Log

## Review Triage Log

## Design Notes

Suprimento é estruturalmente idêntico a sangria (Story 1.2) — mesma rota-irmã, mesmo evento-irmão, mesmo `resolveCanonicalCashSession`, só o campo de destino (`deposits` em vez de `withdrawals`) e o sinal no cálculo do valor esperado (soma em vez de subtrai, história 1.4) mudam. Não há decisão de design nova aqui — só replicar o padrão já revisado duas vezes (implementação + code review) na Story 1.2, já COM a ordem corpo-antes-de-sessão correta desde o início (não como um patch depois).

## Verification

**Commands:**
- `npm test -w packages/shared-types` -- PASSOU (13 testes, incluindo fixture + validação de `cash_deposit_recorded`)
- `npm test -w packages/sync-engine` -- PASSOU (12 arquivos, 63 testes, incluindo o teste novo de reatribuição histórica de suprimento em `arch-4.4-cash-session-conflict.test.ts`)
- `npx tsc --noEmit -p packages/shared-types`, `-p packages/sync-engine`, `-p apps/desktop/sidecar`, `-p apps/desktop` -- PASSOU nos 4 workspaces (depois de rebuildar `dist` de `shared-types`/`sync-engine` — ver Implementation Notes)
- `npm run build -w apps/desktop` -- PASSOU (build de produção do frontend + typecheck/bundle/SEA do sidecar, tudo limpo)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- PASSOU depois do rebuild completo de `sync-engine` (ver Implementation Notes); CENÁRIO 4 estendido cobrindo as 5 linhas de suprimento no nível de rota HTTP real: bloqueio de garçom (403), bloqueio sem sessão aberta (400), valor inválido (400), motivo vazio (400), registro normal (201, propagado e visível em `deposits` nos dois terminais A/B). "TODOS OS CENÁRIOS PASSARAM."

**Manual checks:** nenhum restante — as 5 linhas da matriz I/O de suprimento (I/O & Edge-Case Matrix) têm cobertura automatizada: as 5 primeiras no nível de rota HTTP real (`concurrency-scenario.mjs`), reatribuição histórica no nível de projeção (`arch-4.4-cash-session-conflict.test.ts`). Valor/motivo inválidos também têm cobertura redundante no nível de schema (`events.test.ts`).
