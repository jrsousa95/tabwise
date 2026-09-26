---
title: 'Abrir sessão de caixa (Epic 1 / Story 1.1)'
type: 'feature'
created: '2026-09-25'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5fff265becd74683b4acce91adb3180218ad141a'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Não existe conceito de sessão/turno de caixa hoje — "Resumo de Caixa" (Épico 6) é só um relatório somativo recalculado a cada consulta; o caixa/dono não tem como registrar quanto tinha na gaveta antes de começar a vender.

**Approach:** Introduzir o primeiro evento do novo agregado `cash_session` (`cash_session_opened`), com o invariante "uma sessão aberta por vez" resolvido no nível do ESTABELECIMENTO (não do terminal), usando o mesmo mecanismo de conflito por HLC já usado pra mesas (§4.2), mais a tela de abertura no frontend.

## Boundaries & Constraints

**Always:**
- `aggregate_type: "cash_session"` novo no enum fechado `AggregateTypeSchema`; `aggregateId` gerado via `randomUUID()` (padrão do projeto, não ULID).
- Invariante "uma sessão aberta por vez" é do estabelecimento inteiro — nunca filtrado por `terminal_id`.
- Conflito de duas aberturas concorrentes (dois terminais offline sem se enxergar) resolvido por menor HLC como canônica; a perdedora é marcada `mergedInto` e gera aviso não bloqueante — mesmo padrão do §4.2, adaptado pra **1 slot global** (variável única, não um `Map` por mesa).
- Acesso: caixa e dono; `waiter` bloqueado — mesma checagem inline por exclusão já usada no fechamento de comanda (`orders.ts`), não um helper novo em `context.ts`.
- Valor de abertura em centavos, inteiro, > 0 (NFR7).
- Funciona 100% offline (evento gravado local, sincroniza depois).
- A tela de abertura vive DENTRO da tela já existente `/cash-register` (Resumo de Caixa), como um novo bloco "Sessão de Caixa" no topo — o resumo do dia continua abaixo, sem rota nova nem item de nav novo (decisão confirmada com o dono, 2026-09-25).

**Never:**
- Não implementar fechamento, sangria ou suprimento nesta story (1.2/1.3/1.4, backlog separado).
- Não misturar o conceito de "resumo do dia" (Épico 6, lógica de `cash-register.ts` existente) com o de sessão — o bloco novo é aditivo na mesma tela, não uma reescrita da lib existente.
- Não criar `requireOwnerOrCashier` em `context.ts`.
- Não tocar em `tableToCanonicalOrder` nem no fluxo de conflito de mesa — só adicionar mecanismo paralelo.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Abertura normal | Nenhuma sessão aberta; `openingAmountCents: 5000` | `cash_session_opened` gravado; sessão aparece aberta | N/A |
| Sessão já aberta | Já existe sessão canônica aberta | Bloqueado antes de gravar evento | 400 "já existe uma sessão de caixa aberta" |
| Papel waiter | Operador logado é garçom | Acesso negado | 403 "garçom não pode abrir sessão de caixa" |
| Valor inválido | `openingAmountCents` ausente, ≤ 0 ou não-inteiro | Rejeitado na validação | 400 "valor de abertura inválido" |
| Conflito offline | 2 terminais abrem sessão quase ao mesmo tempo sem se enxergar, depois sincronizam | Menor HLC vira canônica; a outra `mergedInto` + aviso não bloqueante (ambas ordens de merge dão o mesmo resultado) | N/A — resolução automática, não é erro |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/common.ts:18-19` -- adicionar `"cash_session"` ao enum `AggregateTypeSchema`
- `packages/shared-types/src/events.ts` -- novo `CashSessionOpenedSchema` (mesmo molde de `CategoryRegisteredSchema`/`OrderOpenedSchema`: `baseEventSchema.extend({type, aggregateType, aggregateId, payload})`); adicionar ao `DomainEventSchema` (união discriminada)
- `packages/sync-engine/src/reconciliation.ts` -- novo `CashSessionState` (status, `openedByTerminalId` informativo/nunca decide invariante, `mergedInto?`, `openingAmountCents`, `openedAt`, `openedByOperatorId`, `withdrawals: []`/`deposits: []` vazios por ora); `ProjectedState.cashSessions: readonly CashSessionState[]`; variável única `canonicalOpenCashSession: string | undefined` espelhando a lógica de `tableToCanonicalOrder` do `case "order_opened"` pro novo `case "cash_session_opened"` -- NÃO reusar o `Map` de mesa, é 1 slot global
- `apps/desktop/sidecar/src/context.ts` -- método `isCashSessionOpen(state)` espelhando `isTableFree`
- `apps/desktop/sidecar/src/routes/cash-sessions.ts` (novo) -- `handleCashSessionRoutes`, `POST /cash-sessions`: `requireSession` + bloqueio inline de `waiter`, parse/valida body, `isCashSessionOpen` check, `randomUUID()` pro `aggregateId`, `nextHlc()`, `DomainEventSchema.parse`, `insertEvent`, `sendJson(201, ...)` -- mesmo padrão de `POST /orders` em `orders.ts:11-74`
- `apps/desktop/sidecar/src/index.ts` -- import + registro de `handleCashSessionRoutes` perto de `handleOrderRoutes`
- `apps/desktop/src/lib/cash-sessions.ts` (novo) -- `postJson` local (padrão de `tables.ts:54-63`), `openCashSession(openingAmountCents)`, hook `useCashSessionState()` lendo `cashSessions` de `GET /state`
- `apps/desktop/src/routes/cash-register.tsx` -- novo bloco "Sessão de Caixa" no topo, acima do resumo do dia existente; guard de rota já existente (`owner`/`cashier`) em `app.tsx:27-29` cobre esta tela
- `apps/desktop/src/routes/table-conflicts.tsx` + `apps/desktop/src/lib/table-conflicts.ts` -- renomear conceito pra também listar conflitos de sessão de caixa (mesmo mecanismo, payload diferente)
- `packages/sync-engine/test/arch-9.1-cash-session-conflict.test.ts` (novo) -- espelhar `arch-4.2-table-conflict.test.ts`: conflito por HLC, comutatividade do merge (`project(merge(logT1,logT2)) === project(merge(logT2,logT1))`)

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/common.ts` -- adicionar `"cash_session"` ao `AggregateTypeSchema` -- novo aggregate type
- [x] `packages/shared-types/src/events.ts` -- criar `CashSessionOpenedSchema` + adicionar à união `DomainEventSchema` -- schema do evento novo
- [x] `packages/shared-types/test/events.test.ts` -- fixture pro tipo novo (mesmo padrão dos outros 23) -- cobertura de schema
- [x] `packages/sync-engine/src/reconciliation.ts` -- `CashSessionState`, `ProjectedState.cashSessions`, `canonicalOpenCashSession`, `case "cash_session_opened"` com resolução por HLC -- projeção + conflito
- [x] `packages/sync-engine/test/arch-9.1-cash-session-conflict.test.ts` -- conflito por HLC + comutatividade -- regressão do mecanismo
- [x] `apps/desktop/sidecar/src/context.ts` -- `isCashSessionOpen(state)` -- invariante de negócio
- [x] `apps/desktop/sidecar/src/routes/cash-sessions.ts` -- `POST /cash-sessions` -- endpoint novo
- [x] `apps/desktop/sidecar/src/index.ts` -- registrar a rota nova -- dispatch HTTP
- [x] `apps/desktop/src/lib/cash-sessions.ts` -- `openCashSession`, `useCashSessionState` -- cliente API
- [x] `apps/desktop/src/routes/cash-register.tsx` -- UI de abertura, bloco novo no topo da tela existente -- interface do usuário
- [x] `apps/desktop/src/routes/table-conflicts.tsx` + `lib/table-conflicts.ts` -- estender pra listar conflito de sessão de caixa -- UX-DR4

**Acceptance Criteria:**
- Given nenhuma sessão aberta no estabelecimento, when o operador (caixa/dono) informa um valor de abertura válido e confirma, then `cash_session_opened` é gravado e a sessão aparece aberta na tela
- Given já existe uma sessão aberta, when o operador tenta abrir outra, then a ação é bloqueada com mensagem clara, sem gravar evento
- Given o operador logado é `waiter`, when tenta acessar a abertura de caixa, then acesso negado
- Given dois terminais offline abrem sessão quase ao mesmo tempo sem se enxergar, when os logs sincronizam, then a de menor HLC vira canônica e a outra é marcada `mergedInto`, aparecendo como aviso não bloqueante e na tela de conflitos — em qualquer ordem de merge dos dois logs
- Given o terminal está offline, when o operador abre uma sessão, then funciona normalmente (evento local, sincroniza depois)

### Review Findings

`bmad-code-review` rodado sobre o commit `11b8f5f` (4 camadas: `blind-hunter`, `edge-case-hunter`, `verification-gap`, `acceptance-auditor` — `review_mode: full`). Cada achado verificado contra o código real antes do veredito.

- [x] `[Review][Defer]` Sessão de caixa perdedora do conflito de abertura concorrente não gera nenhum aviso transitório (banner), só aparece na tela permanente "Conflitos de Sincronização" — diferente de conflito de mesa, que tem os dois (banner + tela). [apps/desktop/src/layout.tsx, apps/desktop/src/lib/merge-warnings.ts] — deferred: raridade + tela já cobre o essencial (conflito exige dois terminais offline abrindo quase ao mesmo tempo; a tela permanente já mostra o conflito com os valores das duas sessões, o banner seria reforço, não a única forma de descoberta). Decisão do dono, 2026-09-26. *blind-hunter*.

- [x] `[Review][Patch]` `docs/architecture.md:74` documenta `aggregate_id` de `cash_session_opened` como "ULID", mas a spec e o código usam `randomUUID()` — desalinhado. Corrigido. *blind-hunter*.
- [x] `[Review][Patch]` `docs/architecture.md:157` ainda trata a tela de conflitos como "decisão de UI a tomar no detalhamento de 9.1" — já foi tomada e implementada (UX-DR4) nesta story, doc não reflete isso. Corrigido. *blind-hunter*.
- [x] `[Review][Patch]` `apps/desktop/src/routes/cash-register.tsx:handleOpen` não chama `refresh()` quando o servidor rejeita com "já existe uma sessão de caixa aberta" (400). Corrigido — `refresh()` chamado também no branch de erro. [apps/desktop/src/routes/cash-register.tsx] *blind-hunter*.
- [x] `[Review][Patch]` Campo de valor em `CashSessionSection` não fica `disabled` durante o envio (só o botão fica). Corrigido. [apps/desktop/src/routes/cash-register.tsx] *blind-hunter*.
- [x] `[Review][Defer]` `useCashSessionState.refresh`/`useTableConflicts.refresh` engolem falha de rede silenciosamente pra array vazio, sem estado de erro exposto — pré-existente (`useTablesAndOrders.refresh` já faz o mesmo), mas com um risco específico pra sessão de caixa (visão pode sugerir "nenhuma sessão aberta" por falha transitória de rede, não por realidade — o backend ainda bloqueia duplicata na origem, então não corrompe dado, só confunde). [apps/desktop/src/lib/cash-sessions.ts, apps/desktop/src/lib/table-conflicts.ts] — deferred: pré-existente, mesmo padrão de `tables.ts`, resolver é uma mudança de tratamento de erro pro app inteiro. *blind-hunter*.
- [x] `[Review][Defer]` `catch` amplo em `cash-sessions.ts` (rotula qualquer erro como JSON inválido) — já adiado na rodada de revisão do próprio `bmad-build` (ver entrada acima no Review Triage Log, item 4). *edge-case-hunter, achado duplicado*.
- [x] `[Review][Defer]` `postJson` não trata rejeição do `fetch()` em si — já adiado na rodada de revisão do próprio `bmad-build` (ver item 12 acima). *edge-case-hunter, achado duplicado*.

**Rejeitados:**
- `docs/architecture.md`/`sprint-status.yaml` reportarem status diferentes (spec "done", sprint "review") — **[false]** é o estado intermediário esperado do próprio fluxo do projeto (sprint só avança pra "done" depois do code-review aprovar — este workflow resolve isso na seção 6).
- Checagem `isCashSessionOpen` → `insertEvent` sem lock teria race entre dois POSTs no MESMO terminal — **[false]** verificado: não há nenhum `await` entre a leitura do estado e a gravação do evento (`insertEvent` é síncrono); o event loop de um único processo Node não intercala duas requisições no meio de um trecho síncrono — mesma garantia que já protege `isTableFree`/`POST /orders`.
- Teste novo de `cash_session_opened` não cobre campo ausente/tipo errado — **[false]** `z.number().int().positive()` já garante essa rejeição por construção do zod; não é lógica de validação sob medida que pudesse ter um buraco.
- `openingAmountCents` sem limite superior (`.max()`) — **[false]**, já verificado na rodada anterior: nenhum campo `*Cents` do schema tem limite superior, consistente em 100% dos campos monetários.

## Implementation Notes

- Todos os arquivos do Code Map foram tocados exatamente como descrito; nenhum desvio de escopo.
- `ProjectedState` ganhou dois campos novos (`cashSessions`, `cashSessionMergeWarnings`) e dois tipos novos (`CashSessionState`, `CashSessionMergeWarning`, mais `CashMovementRecord`/`CashSessionClosingState` já deixados no formato certo pras stories 1.2-1.4, mas sempre vazios/`undefined` nesta story). `canonicalOpenCashSession` é uma variável `string | undefined` (não um `Map`), exatamente como o Design Notes já pedia.
- `POST /cash-sessions` segue a ordem exata pedida no Code Map: `requireSession` -> bloqueio inline de `waiter` (403 "garçom não pode abrir sessão de caixa") -> valida `openingAmountCents` (400 "valor de abertura inválido" se ausente/≤0/não-inteiro) -> `isCashSessionOpen` (400 "já existe uma sessão de caixa aberta") -> grava o evento. Nenhum helper novo em `context.ts` além de `isCashSessionOpen` (não criei `requireOwnerOrCashier`).
- UI: bloco "Sessão de Caixa" (`CashSessionSection`) entra no topo de `cash-register.tsx`, acima do resumo do dia existente — reaproveita `parseReaisToCents`/`formatCentsToBRL` e o padrão visual `.inline-form`/`.table-map-section` já catalogado (nenhum componente/estilo novo). O guard de rota `owner`/`cashier` já existente em `app.tsx` cobre o acesso; não adicionei checagem de papel na UI (a UI nem carrega pra um `waiter`, e o backend já bloqueia na origem).
- `table-conflicts.tsx`/`lib/table-conflicts.ts`: renomeado pra "Conflitos de Sincronização" (UX-DR4, `_bmad-output/planning-artifacts/epics.md:58/93`, decidido com o dono em 2026-09-25) e passou a listar as duas seções (mesa e sessão de caixa) na mesma tela/rota (`/table-conflicts`, sem rota nova). Conflito de sessão de caixa aparece só como aviso não bloqueante, sem ação de "marcar como resolvido" — não existe (nem foi pedido nesta story) um evento equivalente a `table_conflict_resolved` pro agregado `cash_session`; fica registrado como próximo passo natural se/quando o dono pedir.
- `layout.tsx`: só o texto do link de navegação/comentário atualizado pro nome novo da tela; nenhuma mudança de comportamento.
- Não toquei em `tableToCanonicalOrder` nem no fluxo de conflito de mesa (só usei o mesmo padrão ao lado, em variável separada), não implementei fechamento/sangria/suprimento (1.2/1.3/1.4) e não criei `requireOwnerOrCashier` — as três restrições do "Never" da spec foram respeitadas.

- **Auditoria da matriz I/O (orquestrador, pós-implementação):** o subagent de implementação só rodou testes de `shared-types`/`sync-engine` — isso cobre as linhas "abertura normal" e "conflito offline" da matriz (nível de projeção), mas deixava "sessão já aberta", "papel waiter" e "valor inválido" sem NENHUM teste automatizado no nível de rota HTTP (a lógica de projeção testa outra coisa: o merge de dois eventos já gravados, não a validação da rota que decide se grava o evento). Corrigido estendendo `apps/desktop/sidecar/test/concurrency-scenario.mjs` (convenção do sidecar: sem vitest, só smoke test roteirizado) com um CENÁRIO 4 novo cobrindo as 3 linhas que faltavam, mais o conflito de abertura concorrente A/B no nível de HTTP real (não só projeção isolada). Rodado com `node test/concurrency-scenario.mjs` após `npm run build:bundle -w apps/desktop/sidecar` — PASSOU, todas as 5 linhas da matriz agora cobertas por teste que rodou e passou.

## Spec Change Log

## Review Triage Log

Três camadas rodadas em paralelo sobre o diff (`blind-hunter`, `edge-case-hunter`, `verification-gap`). `verification-gap`: sem achados. `blind-hunter`: 10 achados. `edge-case-hunter`: 3 achados. Cada um verificado contra o código real antes do veredito (não confiando na alegação do revisor).

1. **[low → patch]** `packages/sync-engine/test/arch-9.1-cash-session-conflict.test.ts` (nome do arquivo + `describe`) usa rótulo "9.1" que não corresponde a nenhuma seção real — a arquitetura documenta isso em ARCH §4.4 (mesmo padrão de `arch-4.2-table-conflict.test.ts`, que usa o número da seção de arquitetura, não de épico/história). *blind-hunter*.
2. **[false]** "`canonicalOpenCashSession` nunca é resetado no fechamento, reproduzindo o bug já corrigido de `tableToCanonicalOrder`" — verificado: esta story não implementa `cash_session_closed` (fora do escopo, história 1.4); não existe nenhum caminho de código nesta árvore que feche uma sessão, logo o cenário descrito é inalcançável no diff atual. Fica como lembrete pra história 1.4 (ver Design Notes abaixo), não como defeito desta story. *blind-hunter*.
3. **[false]** "`cashSessions` ordenado por `id` (texto) em vez de `compareCreatedAt`, contradizendo o formato de `OrderState`/`TableState`" — verificado em `reconciliation.ts:505-527`: `orders` (o análogo mais próximo — entidade gerada por evento, não cadastro manual) TAMBÉM ordena por `compareText(id)`, não por `compareCreatedAt`. Só `categories`/`products`/`tables` (cadastro manual do dono, comentário explícito de 2026-09-22) usam `compareCreatedAt`. `cashSessions` seguiu o precedente correto (`orders`), não o contrário do que a alegação diz. *blind-hunter*.
4. **[low → defer]** `catch` único em `apps/desktop/sidecar/src/routes/cash-sessions.ts` rotula qualquer erro (inclusive falha de `insertEvent`) como "corpo da requisição não é um JSON válido". Verificado: `orders.ts` (`POST /orders`) tem exatamente o mesmo padrão — não é introduzido por esta story, é a convenção já existente em todas as rotas do sidecar. Corrigir só aqui seria inconsistente com o resto do arquivo. *blind-hunter + edge-case-hunter (mesma causa raiz)*.
5. **[false]** "Novo padrão de sanitização de input (filtra caracteres no `onChange`) inconsistente com `catalog.tsx`" — verificado: não há resultado incorreto, a filtragem preventiva é um superconjunto razoável do padrão existente, sem dano demonstrado. *blind-hunter*.
6. **[low → patch]** `apps/desktop/src/lib/cash-sessions.ts`: `withdrawals`/`deposits` tipados como `unknown[]` em vez do `CashMovementRecord[]` já conhecido (mesmo formato do backend). Sem efeito hoje (arrays sempre vazios nesta story), mas é dívida de tipo trivial de evitar. *blind-hunter*.
7. **[false]** "Nenhum teste cobre a combinação garçom+valor inválido" — verificado: a checagem de papel roda incondicionalmente ANTES da leitura do valor no corpo da rota (`cash-sessions.ts`); a ordem é garantida pela estrutura do código (retorno antecipado), não pela cobertura de teste — não há ambiguidade real a testar. *blind-hunter*.
8. **[low → patch]** Teste "garçom bloqueado" (`concurrency-scenario.mjs` CENÁRIO 4) confere só o status 403, não que nenhum evento foi gravado. Reforço trivial de robustez contra regressão futura. *blind-hunter*.
9. **[low → patch]** Lista "Conflitos de sessão de caixa" (`table-conflicts.tsx`) mostra só timestamp + selo genérico, menos identificação que a lista irmã de mesa (que mostra o nome da mesa). Adição trivial de mais campos já disponíveis nos dados (`losingSession`/`canonicalSession`/valor de abertura). *blind-hunter*.
10. **[false]** "Spec Change Log vazio / nenhuma revisão automatizada rodou antes de marcar `in-review`" — observação de processo sobre o workflow, não um defeito no código do diff (a própria revisão que gerou esse achado é a revisão que estava faltando). *blind-hunter*.
11. **[false]** `openingAmountCents` sem `.max()` — verificado contra todo campo `*Cents` em `events.ts` (`priceCents`, `unitPriceCents`, `subtotalCents`, `serviceFeeCents`, `totalCents`, `amountCents`, `changeCents`): nenhum tem limite superior. Consistente com a convenção existente em 100% dos campos monetários do schema, não é uma lacuna introduzida por este diff. *edge-case-hunter*.
12. **[low → defer]** `postJson` em `apps/desktop/src/lib/cash-sessions.ts` não trata rejeição do `fetch()` em si (só `.json()` tem `.catch`), deixando `submitting=true` travado em caso de falha de rede. Verificado: `apps/desktop/src/lib/tables.ts` (o arquivo que esta story explicitamente reaproveitou como padrão) tem exatamente a mesma lacuna — pré-existente em todo o app, não introduzida aqui. *edge-case-hunter*.

**Resumo do roteamento:** 4 `patch` (itens 1, 6, 8, 9 — aplicados nesta rodada), 2 `defer` (itens 4, 12 — registrados em `deferred-work.md`), 6 `false` (itens 2, 3, 5, 7, 10, 11 — rejeitados). Nenhum `intent_gap`/`bad_spec` — sem necessidade de loopback pro step 2.

**Patches aplicados (subagent original não estava mais alcançável — aplicados diretamente pelo orquestrador):**
- Item 1: `arch-9.1-cash-session-conflict.test.ts` renomeado pra `arch-4.4-cash-session-conflict.test.ts` (`git mv`), `describe` atualizado pra "ARCH §4.4 — duas sessões de caixa abertas concorrentemente".
- Item 6: `withdrawals`/`deposits` em `apps/desktop/src/lib/cash-sessions.ts` tipados como `CashMovementRecord[]` (tipo novo, espelha o backend) em vez de `unknown[]`.
- Item 8: `concurrency-scenario.mjs` CENÁRIO 4 ganhou uma asserção extra confirmando `cashSessions.length === 0` depois do bloqueio de garçom.
- Item 9: `useTableConflicts` (`lib/table-conflicts.ts`) passou a ler `cashSessions` de `/state` e expor `cashSessionAmount(id)`; `table-conflicts.tsx` mostra o valor de abertura das duas sessões envolvidas no conflito (perdedora e canônica) em vez de só timestamp + selo genérico.

**Re-verificação pós-patch (tudo PASSOU):** `npm test -w packages/sync-engine` (61 testes), `tsc --noEmit` nos 4 workspaces afetados, `npm run build:bundle -w apps/desktop/sidecar` + `node apps/desktop/sidecar/test/concurrency-scenario.mjs` (incluindo a asserção nova do item 8), `npm run build -w apps/desktop` (frontend + sidecar completo, incluindo o binário SEA).

## Design Notes

`canonicalOpenCashSession` é uma variável única (não um `Map<chave, id>`) porque sessão de caixa tem exatamente 1 slot compartilhado no estabelecimento inteiro — diferente de mesa, que tem N slots (um por `tableId`). A lógica de "processar em ordem de HLC, primeiro processado vence" é idêntica à de `tableToCanonicalOrder`, só a estrutura de armazenamento muda.

**Aviso pra história 1.4 (achado no review desta story, item 2 do Review Triage Log):** quando `cash_session_closed` for implementado, o `case` correspondente em `project()` PRECISA limpar `canonicalOpenCashSession` (setar `undefined`) quando a sessão fechada for a canônica atual — mesmo padrão já usado em `case "order_closed"` pra `tableToCanonicalOrder`. Sem isso, a primeira sessão de caixa aberta na vida do estabelecimento fica "dona" do slot pra sempre, e toda sessão aberta depois do primeiro fechamento seria falsamente tratada como conflito — reproduzindo o bug real já corrigido uma vez pra mesas (2026-09-23).

## Verification

**Commands:**
- `npm run build -w packages/shared-types` -- PASSOU (build limpo)
- `npm test -w packages/sync-engine` -- PASSOU (12 arquivos, 61 testes, incluindo os 3 novos de `arch-9.1-cash-session-conflict.test.ts`)
- `npm test -w packages/shared-types` -- PASSOU (9 testes, incluindo a fixture/validação nova de `cash_session_opened`)
- `npx tsc --noEmit -p packages/shared-types/tsconfig.json` -- PASSOU
- `npx tsc --noEmit -p packages/sync-engine/tsconfig.json` -- PASSOU
- `npx tsc --noEmit -p apps/desktop/sidecar/tsconfig.json` -- PASSOU
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` -- PASSOU
- `npm run build -w apps/desktop` -- PASSOU (build de produção do frontend + typecheck/bundle/SEA do sidecar, tudo limpo)
- `node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- PASSOU, incluindo o CENÁRIO 4 novo (sessão de caixa: bloqueio de garçom 403, valor inválido 400, conflito de abertura concorrente A/B convergindo pra uma canônica, bloqueio de segunda sessão 400 depois do conflito resolvido) -- adicionado durante a auditoria da matriz I/O da spec (step 3 do build): as linhas "sessão já aberta"/"papel waiter"/"valor inválido" da matriz não tinham nenhum teste automatizado cobrindo o nível de rota HTTP (só a lógica de projeção, que é uma coisa diferente) — corrigido estendendo o smoke test já existente (convenção do sidecar: sem vitest, só smoke test roteirizado), não criando um framework novo.

**Manual checks (if no CLI):** nenhum restante — o cenário que antes dependia de verificação manual (duas instâncias do sidecar, abertura offline, sync, conferência do conflito) agora está automatizado no CENÁRIO 4 acima.
