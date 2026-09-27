---
title: 'Fechar sessão de caixa com conferência (Epic 1 / Story 1.4)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
baseline_commit: '30b339dc522f62e3b44158bda2ec81e8efc65bcf'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Caixa/dono não tem como conferir se o dinheiro físico da gaveta bate com o que deveria ter, no fim do turno — sem isso, sobra/falta passa despercebida ou vira uma surpresa não documentada.

**Approach:** Novo evento `cash_session_closed` (payload só com `countedAmountCents` — fato físico, contado uma vez). `expectedAmountCents`/`differenceCents` são SEMPRE derivados por uma função de projeção nova (nunca gravados no evento), reaproveitável tanto pra mostrar o valor esperado ANTES de pedir o contado (preview) quanto pra reexibir uma sessão já fechada depois (histórico). Fechar libera o slot canônico de sessão de caixa pra próxima abertura — mesmo princípio já usado pra mesa (`order_closed` limpando `tableToCanonicalOrder`).

## Boundaries & Constraints

**Always:**
- `cash_session_closed` usa `aggregate_type: "cash_session"`, `aggregateId` = sessão canônica aberta. Payload: `{countedAmountCents: int, >= 0}` — SÓ ISSO. `expectedAmountCents`/`differenceCents` NUNCA entram no payload.
- Valor esperado = `openingAmountCents` + pagamentos `paymentMethod === "cash"` de `orders` com `closing.closedAt` dentro de `[openedAt, closedAt ?? agora]` da sessão + `deposits` − `withdrawals`. Calculado por uma função nova em `packages/sync-engine/src/reporting.ts` (mesmo pacote de `computeCashRegisterSummary`, não em `shared-types` — precisa do array completo de `orders`), reaproveitada tanto pelo preview (sessão aberta, janela até agora) quanto pro histórico (sessão fechada, janela até `closing.closedAt`).
- `countedAmountCents` aceita **zero** (gaveta vazia é raro mas válido) — validação é `>= 0`, DIFERENTE de abertura/sangria/suprimento (que exigem `> 0`). Não copiar a validação das stories anteriores sem ajustar.
- Fechar a sessão TEM que limpar `canonicalOpenCashSession` quando a sessão fechada for a canônica atual — mesmo padrão já usado em `case "order_closed"` pra `tableToCanonicalOrder` (`reconciliation.ts`, comentário do achado real 2026-09-23). Sem isso, a PRÓXIMA sessão aberta seria tratada como conflito falso contra esta já fechada.
- Diferença (contado − esperado) NUNCA bloqueia o fechamento, mesmo ≠ 0 — só é calculada e exibida.
- Acesso: caixa e dono; `waiter` bloqueado — mesmo padrão de exclusão já usado em `cash-sessions.ts`.
- Corpo da requisição lido/validado ANTES de qualquer retorno antecipado de invariante de negócio (lição da Story 1.2).
- Uma sessão já fechada, quando revisitada, mostra o valor esperado RECALCULADO na hora (pode ter mudado desde o fechamento, por pedido em dinheiro que sincronizou tarde) com um aviso visível de que o valor pode ter mudado — não é um "antes/depois" comparado, é sempre o valor atual + um aviso estático (decisão já tomada na Story 1.1, UX-DR5).
- Funciona 100% offline.

**Never:**
- Não implementar nada do Épico 2 (relatórios) nesta story.
- Não gravar `expectedAmountCents`/`differenceCents` no payload do evento.
- Não bloquear o fechamento por diferença ≠ 0.
- Não criar `requireOwnerOrCashier` em `context.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Preview do valor esperado | Sessão aberta, com vendas em dinheiro/sangrias/suprimentos já registrados | Endpoint de leitura devolve `expectedAmountCents` calculado, sem gravar nada | 400 "nenhuma sessão de caixa aberta" se não houver sessão |
| Fechamento normal, sem diferença | `countedAmountCents` == esperado | `cash_session_closed` gravado; sessão vira `status: "closed"`; slot canônico liberado | N/A |
| Fechamento com diferença (sobra ou falta) | `countedAmountCents` ≠ esperado | Fechamento aceito normalmente; diferença calculada e devolvida na resposta | N/A — nunca é erro |
| `countedAmountCents` inválido | Ausente, negativo ou não-inteiro | Rejeitado na validação | 400 "valor contado inválido" |
| Sem sessão aberta | Nenhuma sessão canônica aberta | Bloqueado antes de gravar evento | 400 "nenhuma sessão de caixa aberta" |
| Papel waiter | Operador logado é garçom | Acesso negado | 403 "garçom não pode fechar sessão de caixa" |
| Reabertura após fechamento | Sessão fechada; nova sessão aberta depois | Nova sessão abre normalmente, sem ser tratada como conflito contra a fechada (slot canônico foi liberado) | N/A |
| Venda em dinheiro sincroniza após o fechamento | Order fechada em dinheiro, dentro da janela `[openedAt, closedAt]`, chega no log depois do `cash_session_closed` já ter sido processado | Ao reler a sessão fechada, `expectedAmountCents` recalculado já inclui essa venda; UI mostra aviso de que o valor pode ter mudado | N/A — resolvido na projeção, sem erro |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/events.ts` -- novo `CashSessionClosedSchema` (`aggregateType: "cash_session"`, payload `{countedAmountCents: z.number().int().nonnegative()}` — `.nonnegative()`, não `.positive()`); adicionar à união `DomainEventSchema` (26→27 tipos)
- `packages/shared-types/test/events.test.ts` -- fixture + teste de validação (negativo, não-inteiro) — e um teste extra confirmando que `0` é ACEITO (diferente das outras 3 validações de valor do épico)
- `packages/sync-engine/src/reconciliation.ts` -- novo `case "cash_session_closed"`: resolve canônica via `resolveCanonicalCashSession`, seta `status: "closed"` e `closing: {countedAmountCents, closedAt: event.createdAt, closedByOperatorId: event.operatorId}`; limpa `canonicalOpenCashSession` se apontar pra essa sessão (mesmo padrão de `case "order_closed"` limpando `tableToCanonicalOrder`, ver comentário nessa seção)
- `packages/sync-engine/src/reporting.ts` -- nova função `computeExpectedCashSessionAmountCents(session: CashSessionState, orders: readonly OrderState[], nowMs: number): number` — soma `openingAmountCents` + pagamentos `cash` de `orders` com `closing.closedAt` no intervalo `[session.openedAt, session.closing?.closedAt ?? nowMs]` + `deposits` − `withdrawals` (mesmo padrão de filtro/soma de `computeCashRegisterSummary`)
- `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- duas rotas novas: `GET /cash-sessions/expected` (preview — sem gravar nada, 400 se não houver sessão aberta) e `POST /cash-sessions/close` (com `countedAmountCents`; ordem corpo-antes-de-sessão; calcula `expectedAmountCents`/`differenceCents` na hora só pra devolver na resposta 201, nunca grava esses dois campos no evento). NÃO reaproveitar `handleCashMovementRoute` (payload/fluxo diferente — tem preview, valida com `>= 0` não `> 0`, não recebe `reason`)
- `apps/desktop/src/lib/cash-sessions.ts` -- `getExpectedAmount()`, `closeCashSession(countedAmountCents)`; `CashSessionState` (tipo do frontend) ganha `closing?: {countedAmountCents, closedAt, closedByOperatorId}` já espelhando o backend
- `apps/desktop/src/routes/cash-register.tsx` -- `CashSessionSection`: quando há sessão aberta, novo fluxo de fechamento em duas etapas (botão "Fechar sessão" → mostra valor esperado calculado (chama o preview) → campo de valor contado → confirma, mostra a diferença); nova seção "Sessões encerradas" (histórico, reaproveitando `state.cashSessions` completo — hoje só `openSession` é exposto por `useCashSessionState`, precisa expor a lista toda) listando sessões fechadas com valor esperado recalculado + aviso de que pode ter mudado desde o fechamento
- `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- teste confirmando que reabrir uma sessão depois de fechar a anterior NÃO gera conflito (mesmo padrão do teste equivalente já existente pra mesa, `arch-4.2-table-conflict.test.ts`)
- `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender CENÁRIO 4 com: preview do valor esperado, fechamento normal, papel waiter bloqueado, valor inválido, sem sessão aberta, e reabertura de uma nova sessão depois de fechar a anterior sem gerar conflito falso

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/events.ts` -- criar `CashSessionClosedSchema` (`countedAmountCents` >= 0) + adicionar à união -- schema do evento novo
- [x] `packages/shared-types/test/events.test.ts` -- fixture + validação (negativo/não-inteiro rejeitados, zero aceito) -- cobertura de schema
- [x] `packages/sync-engine/src/reporting.ts` -- `computeExpectedCashSessionAmountCents` -- cálculo do valor esperado, reaproveitável
- [x] `packages/sync-engine/src/reconciliation.ts` -- `case "cash_session_closed"` + limpeza de `canonicalOpenCashSession` -- projeção + liberação do slot
- [x] `packages/sync-engine/test/arch-4.4-cash-session-conflict.test.ts` -- teste de reabertura pós-fechamento sem conflito falso -- regressão do bug já corrigido pra mesa
- [x] `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- `GET /cash-sessions/expected`, `POST /cash-sessions/close` -- endpoints novos
- [x] `apps/desktop/src/lib/cash-sessions.ts` -- `getExpectedAmount`, `closeCashSession`, tipo `closing` -- cliente API
- [x] `apps/desktop/src/routes/cash-register.tsx` -- fluxo de fechamento em duas etapas + seção "Sessões encerradas" -- interface do usuário
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender CENÁRIO 4 com as 6 linhas da matriz no nível de rota HTTP real
- [x] `packages/sync-engine/test/reporting.test.ts` -- **adicionado na auditoria pós-implementação (orquestrador), não estava no Code Map original** -- 4 testes unitários de `computeExpectedCashSessionAmountCents`, incluindo o teste da linha mais importante da matriz ("venda em dinheiro sincroniza após o fechamento") -- ver Implementation Notes

**Acceptance Criteria:**
- Given uma sessão de caixa aberta com zero ou mais sangrias/suprimentos já registrados, when o operador inicia o fechamento, then o sistema mostra o valor esperado calculado antes de pedir o valor contado
- Given o valor esperado exibido, when o operador informa o valor contado e confirma, then gera `cash_session_closed` com `countedAmountCents`, e a diferença (contado − esperado) é exibida — nunca ajusta o esperado pra "bater"
- Given a diferença é ≠ 0, when o operador confirma mesmo assim, then o fechamento é permitido normalmente
- Given a sessão já fechada, when uma comanda em dinheiro é fechada depois, then ela não conta pra essa sessão — pertence à próxima sessão aberta
- Given um pedido em dinheiro que deveria contar pra essa sessão sincroniza depois do fechamento, when o dono revisita essa sessão fechada, then o valor esperado exibido reflete o novo total e a tela sinaliza que o valor pode ter mudado desde o fechamento

### Review Findings

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] `[Review][Patch]` **Crítico** — `CashSessionSection` chamava `useCashSessionState()` por conta própria, e `CashRegister` chamava o MESMO hook de novo, separadamente. O hook guarda estado local (`useState`), sem cache/contexto compartilhado — as duas cópias nunca se sincronizavam entre si. Fechar uma sessão atualizava só a cópia local de `CashSessionSection`; a lista "Sessões encerradas" (alimentada pela chamada separada em `CashRegister`) nunca via a sessão recém-fechada sem um reload completo da página — quebrava o entregável central da história. Corrigido: `CashSessionSection` passou a receber `status`/`openSession`/`refresh` por props; `CashRegister` chama o hook uma ÚNICA vez e repassa pras duas seções. [apps/desktop/src/routes/cash-register.tsx] *blind-hunter*.
- [x] `[Review][Patch]` `GET /cash-sessions/expected?sessionId=` não filtrava `mergedInto === undefined` como toda outra busca de sessão do arquivo — uma sessão perdedora de conflito de abertura nunca recebe suas próprias sangrias/suprimentos/fechamento (tudo redirecionado pra canônica via `resolveCanonicalCashSession`), então calcular o valor esperado em cima dela produziria um número plausível mas sem sentido em vez do 400 que qualquer outro id desconhecido recebe. Corrigido. [apps/desktop/sidecar/src/routes/cash-sessions.ts] *blind-hunter*.
- [x] `[Review][Patch]` `?sessionId=` com valor vazio (`?sessionId=`) caía no ramo de "sem sessionId" por `sessionId` ser truthy-checado — em vez de ser tratado como um id inválido (400), era silenciosamente tratado como se o parâmetro nem tivesse sido informado. Corrigido comparando com `!== null` em vez de truthiness. [apps/desktop/sidecar/src/routes/cash-sessions.ts] *edge-case-hunter*.
- [x] `[Review][Patch]` Doc comment de `CashSessionClosedSchema` (e, pelo mesmo padrão, `CashWithdrawalRecordedSchema`/`CashDepositRecordedSchema`) descrevia a resolução da sessão canônica como "via `isCashSessionOpen`" — mas nenhuma dessas três rotas chama esse helper; `isCashSessionOpen` só é usado por `POST /cash-sessions` (abertura, Story 1.1). As três na verdade fazem sua própria busca inline por `mergedInto === undefined && status === "open"`. Corrigido nas três ocorrências. [packages/shared-types/src/events.ts] *blind-hunter*.
- [x] `[Review][Patch]` `CloseSessionFlow`/`ClosedSessionCard` mostravam `differenceCents` cru (ex: "-R$ 7,00"), violando o próprio princípio "nunca uma confirmação cega" em ação financeira sensível — o operador tinha que inferir o sinal do número em vez de ler "sobra"/"falta" direto. Corrigido com `formatDifference()` novo, usado nos dois lugares. [apps/desktop/src/routes/cash-register.tsx] *blind-hunter*.
- [x] `[Review][Patch]` O desvio pontual do Code Map (`?sessionId=` — ver Implementation Notes) tinha zero cobertura de teste no nível de rota HTTP, só no nível de função pura (`reporting.test.ts`). Adicionado em `concurrency-scenario.mjs`: preview de uma sessão já fechada via `?sessionId=` (200 + valor batendo com o esperado no momento do fechamento) e um id desconhecido (400). [apps/desktop/sidecar/test/concurrency-scenario.mjs] *verification-gap*.
- [x] `[Review][Defer]` Duas `cash_session_closed` concorrentes pra mesma sessão (dois terminais offline fecham a mesma sessão canônica antes de sincronizar) fariam a segunda, ao aplicar na projeção, sobrescrever silenciosamente `closing` da primeira — sem gerar nenhum aviso de conflito, diferente da detecção de abertura concorrente (`cashSessionMergeWarnings`). [packages/sync-engine/src/reconciliation.ts, case "cash_session_closed"] — deferred: decidir COMO sinalizar esse conflito (qual closing "vence"? avisar os dois operadores?) é uma decisão de produto/arquitetura nova, fora do escopo desta story — a arquitetura (ARCH §4.4) só cobre conflito de ABERTURA. Registrado em `deferred-work.md` pra uma futura revisão de ARCH. *edge-case-hunter*.
- [x] `[Review][Defer]` `getJson`/`postJson` (`apps/desktop/src/lib/cash-sessions.ts`) não capturam a rejeição do `fetch()` em si — mesma causa raiz já adiada desde as Stories 1.1/1.2/1.3, reincidindo nos componentes novos desta história (`CloseSessionFlow.handleStart`/`handleConfirm` deixam `loadingPreview`/`submitting` travados em `true` se a rede falhar no meio; `ClosedSessionCard` fica preso em "carregando..." pra sempre). [apps/desktop/src/lib/cash-sessions.ts, apps/desktop/src/routes/cash-register.tsx] — deferred: mesmo padrão já aceito e documentado em `deferred-work.md`, consistente com toda rota de sessão de caixa existente; corrigir isso corretamente é uma mudança de convenção no `getJson`/`postJson` compartilhado por toda a lib, não algo pontual desta story. *edge-case-hunter*.
- [x] `[Review][Defer]` `try/catch` de `POST /cash-sessions/close` rotula qualquer erro (inclusive falha real de `insertEvent`/db) como "corpo da requisição não é um JSON válido" — mesma causa raiz já adiada desde `handleCashMovementRoute` (Stories 1.2/1.3), reincidindo aqui porque a rota não reaproveita o helper (Design Notes). [apps/desktop/sidecar/src/routes/cash-sessions.ts] *edge-case-hunter, achado análogo ao já adiado*.

**Rejeitados:**
- `GET /cash-sessions/expected?sessionId=<id-de-sessão-perdedora-de-conflito>` devolveria um valor esperado calculado sobre uma sessão inválida — **[false]** o filtro `mergedInto === undefined` já presente na busca por `sessionId` exclui exatamente esse caso, devolvendo 400 "sessão de caixa não encontrada" como qualquer outro id desconhecido. Confirmado lendo o código atual, não é uma lacuna.
- Uma venda em dinheiro fechada durante um intervalo em que NENHUMA sessão está aberta (sessão A já fechou, sessão B ainda não abriu) fica fora da janela `[openedAt, closedAt]` de QUALQUER sessão, contradizendo a leitura literal da AC "pertence à próxima sessão aberta" — **[defer, não false]** tecnicamente correto: essa venda fica invisível pra reconciliação de caixa nesse cenário específico. Mas depende de uma falha de processo (deixar vender em dinheiro sem nenhuma sessão de caixa aberta), não de um bug de código — a fórmula está consistente e documentada; a AC descreve o caso normal (sempre há uma sessão aberta durante o expediente), não a garantia universal. Caveat registrado abaixo em Implementation Notes (sem alterar a AC congelada) e em `deferred-work.md` como candidato a um relatório de "vendas órfãs" no Épico 2. *edge-case-hunter, achado de precisão de documentação*.

## Implementation Notes

- Todos os arquivos do Code Map foram tocados como descrito. `CashSessionClosedSchema` segue exatamente o molde pedido (`aggregateType: "cash_session"`, payload só com `countedAmountCents: z.number().int().nonnegative()`); `expectedAmountCents`/`differenceCents` nunca entram no payload nem em `CashSessionClosingState` (só `countedAmountCents`/`closedAt`/`closedByOperatorId`, já existentes em `reconciliation.ts` desde antes desta story).
- **Auditoria da matriz I/O (orquestrador, pós-implementação):** o subagent implementador cobriu 6 das 8 linhas efetivas da matriz em `concurrency-scenario.mjs` (nível de rota HTTP), mas a linha mais distintiva da story — "venda em dinheiro sincroniza após o fechamento" (Acceptance Criteria 5, a razão de existir do design "sempre derivado, nunca persistido") — não tinha NENHUM teste, nem de rota nem unitário, em lugar nenhum. Corrigido adicionando 4 testes novos em `packages/sync-engine/test/reporting.test.ts` (arquivo já existente, mesmo padrão de `computeCashRegisterSummary` logo acima): valor esperado só com fundo de troco; soma dinheiro dentro da janela e ignora cartão/pix/fora da janela, soma suprimento, subtrai sangria; sessão fechada usa janela até `closedAt` (não até "agora"); e o teste central — projeta o MESMO log duas vezes (antes/depois de uma venda em dinheiro "sincronizar tarde", com `closedAt` dentro da janela original mas processada depois do `cash_session_closed`) e confirma que o valor recalculado muda (`6000` → `6800`), provando que nunca fica congelado. Rodado com `npm test -w packages/sync-engine` — 68 testes, todos passando (64 pré-existentes + 4 novos).
- `computeExpectedCashSessionAmountCents` (`packages/sync-engine/src/reporting.ts`) reaproveita a mesma sessão materializada (`CashSessionState`) tanto pro preview (sessão aberta, janela até `nowMs`) quanto pro histórico (sessão fechada, janela até `closing.closedAt`) — a própria assinatura da função (`session.closing?.closedAt ?? nowMs`) já resolve as duas leituras sem nenhum parâmetro extra.
- `case "cash_session_closed"` em `reconciliation.ts` resolve a sessão canônica via `resolveCanonicalCashSession` (já existente desde a Story 1.2, reaproveitada sem alteração) e limpa `canonicalOpenCashSession` quando ela aponta pra essa sessão — espelho exato do `case "order_closed"` limpando `tableToCanonicalOrder`.
- **Desvio pontual do Code Map, necessário pra fechar a Acceptance Criteria de histórico:** o Code Map descrevia só duas rotas (`GET /cash-sessions/expected` e `POST /cash-sessions/close`), com o preview restrito à sessão canônica ABERTA. Mas a seção "Sessões encerradas" (histórico) também precisa recalcular o valor esperado de uma sessão JÁ FECHADA a cada leitura (Acceptance Criteria 5: "o dono revisita essa sessão fechada... o valor esperado exibido reflete o novo total"). Criar uma TERCEIRA rota só pra isso duplicaria a lógica de resolução de sessão sem necessidade — em vez disso, `GET /cash-sessions/expected` passou a aceitar um `?sessionId=` opcional: sem ele, mantém o comportamento original (preview da sessão aberta, 400 se não houver); com ele, recalcula pra QUALQUER sessão já conhecida (aberta ou fechada), usando a MESMA `computeExpectedCashSessionAmountCents` (que já resolve a janela certa sozinha via `session.closing?.closedAt`). Continua sem gravar nada, e o "Never" de não persistir `expectedAmountCents`/`differenceCents` continua respeitado — é só uma leitura parametrizada.
- `apps/desktop/src/lib/cash-sessions.ts`: `getExpectedAmount(sessionId?)` espelha essa extensão; `closeCashSession(countedAmountCents)` aceita zero (o parser `parseReaisToCents` + checagem `cents < 0` no frontend, `>= 0` no backend). `useCashSessionState` já expunha `cashSessions` completo desde antes desta story (achado na leitura do código existente — o Code Map presumia que precisaria expor, mas já estava exposto).
- `apps/desktop/src/routes/cash-register.tsx`: `CloseSessionFlow` novo (dentro de `CashSessionSection`) implementa as duas etapas (botão "Fechar sessão" -> preview -> valor contado -> confirma, mostra a diferença numa mensagem que persiste mesmo depois da sessão sumir da view de "aberta"). `ClosedSessionsSection`/`ClosedSessionCard` novos, cada card busca seu próprio `expectedAmountCents` recalculado via `getExpectedAmount(session.id)` e exibe um `status-badge status-badge-warning` fixo avisando que o valor pode ter mudado desde o fechamento (nunca um "antes/depois" comparado — UX-DR5 da Story 1.1).
- **Risco de processo já documentado nas Stories 1.2/1.3, reconfirmado aqui:** rebuildado `packages/shared-types` E `packages/sync-engine` antes de `npm run build:bundle -w apps/desktop/sidecar` — sem isso o `case "cash_session_closed"` novo não estaria no bundle e `concurrency-scenario.mjs` estouraria em timeout silencioso na propagação do fechamento.
- **Caveat achado no code review (edge-case-hunter):** a AC "uma comanda em dinheiro fechada depois de uma sessão já fechada... pertence à próxima sessão aberta" descreve o caso normal — pressupõe que sempre existe uma sessão de caixa aberta durante o expediente. Se uma venda em dinheiro fecha num intervalo em que NENHUMA sessão está aberta (sessão anterior já fechada, próxima ainda não aberta), ela cai fora da janela `[openedAt, closedAt ?? agora]` de toda sessão existente e fica de fato fora de qualquer reconciliação — não é um bug da fórmula (`computeExpectedCashSessionAmountCents`), é uma falha de processo (vender sem sessão aberta) que o software não impede hoje. Não corrigido nesta story (fora do escopo definido pela ARCH §4.4, que só cobre conflito de abertura) — ver `deferred-work.md`.

## Spec Change Log

## Review Triage Log

## Design Notes

`computeExpectedCashSessionAmountCents` vive em `reporting.ts`, não em `reconciliation.ts` — mesma separação já usada por `computeCashRegisterSummary` (projeção monta o estado bruto; `reporting.ts` faz cálculos derivados sobre esse estado). Isso também evita import circular (reporting já importa `OrderState`/`CashSessionState` de `reconciliation`, nunca o contrário).

A rota de fechamento NÃO reaproveita `handleCashMovementRoute` (criado na Story 1.3 pra sangria/suprimento) porque o formato genuinamente diverge: fechamento precisa de um preview antes (rota GET separada), valida `countedAmountCents >= 0` (não `> 0`), não recebe `reason`, e a resposta inclui valores derivados (`expectedAmountCents`/`differenceCents`) que as outras rotas não têm. Forçar o reaproveitamento aqui pioraria a legibilidade em vez de ajudar — o helper serve bem sangria/suprimento (que SÃO idênticos), não é uma regra geral pra qualquer rota de sessão de caixa.

## Verification

**Commands:**
- `npm test -w packages/shared-types` -- expected: suíte completa passa -- PASSOU (14 testes, incluindo fixture + validação `>= 0`/zero aceito de `cash_session_closed`)
- `npm test -w packages/sync-engine` -- expected: suíte completa passa, incluindo o teste de reabertura pós-fechamento -- PASSOU (12 arquivos, **68 testes** — 64 pré-existentes + 4 novos de `computeExpectedCashSessionAmountCents`, adicionados na auditoria da matriz I/O, ver Implementation Notes)
- `npx tsc --noEmit` nos workspaces afetados -- expected: sem erros -- PASSOU (`shared-types`, `sync-engine`, `apps/desktop/sidecar`, `apps/desktop`)
- `npm run build -w apps/desktop` -- expected: build de produção limpo (rebuildar `shared-types` E `sync-engine` antes do bundle do sidecar — risco de processo já documentado nas Stories 1.2/1.3) -- PASSOU (frontend + typecheck/bundle/SEA do sidecar)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- expected: CENÁRIO 4 estendido passa, incluindo reabertura de sessão pós-fechamento sem conflito falso e o preview por `?sessionId=` de uma sessão já fechada (achado do code review, ver Review Findings) -- PASSOU ("TODOS OS CENÁRIOS PASSARAM.", cobrindo 7 das 8 linhas da matriz no nível de rota HTTP: preview, fechamento normal com diferença ≠ 0 (não bloqueia), garçom bloqueado (preview e fechamento), valor contado inválido, sem sessão aberta, reabertura pós-fechamento sem conflito falso, preview por `?sessionId=` de sessão fechada (200) + id desconhecido (400) — a 8ª linha, "venda sincroniza após o fechamento", tem cobertura no nível de projeção/`reporting.ts` em vez de HTTP, ver Implementation Notes)
- Re-verificação pós-code-review (mesmos comandos acima, repetidos depois de todos os patches do Review Findings): `npm test -w packages/shared-types` (14 testes), `npm test -w packages/sync-engine` (68 testes), `npx tsc --noEmit` limpo em `shared-types`/`sync-engine`/`apps/desktop/sidecar`/`apps/desktop`, rebuild completo (`shared-types` → `sync-engine` → bundle do sidecar) e `concurrency-scenario.mjs` -- todos PASSARAM.
