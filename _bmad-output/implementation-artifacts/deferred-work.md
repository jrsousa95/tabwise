- source_spec: `_bmad-output/implementation-artifacts/spec-sistema-de-design-visual.md`
  summary: Mapa de mesas perdeu semântica de tabela pra leitor de tela ao virar um grid de `table-tile` (`<div>`s no lugar de `<table>`/`<tr>`/`<td>`). **Piso mínimo aplicado (2026-09-23)** — decisão de arquitetura completa segue aberta.
  evidence: Achado real (`blind-hunter`, verificado) — nenhum `role`/landmark substitui a semântica de tabela perdida. A correção exige escolher um padrão ARIA (grid/list/landmark por tile) que serve o produto como um todo, não uma correção pontual desta spec de repaginação visual.
  resolution: "Parcial (2026-09-23, validação de UX): `role=\"list\"` no grid + `role=\"listitem\"` em cada tile + `aria-label` com a contagem (`table-map.tsx`) — resolve o sintoma mais grave (coleção sem anúncio nenhum), mas não é a arquitetura ARIA completa (grid/row/gridcell vs. list/listitem, relação identificador/status/capacidade dentro do tile) que este item original pedia. Segue como item de ação pra quando o produto justificar o investimento maior."

- source_spec: `_bmad-output/implementation-artifacts/spec-correcao-juncao-de-mesas.md`
  summary: A trava contra sobreposição em `POST /table-groups` só enxerga o estado local de cada sidecar — dois terminais diferentes podem, cada um, passar na validação antes de sincronizar entre si e produzir grupos sobrepostos mesmo assim.
  evidence: Achado real (`blind-hunter`, verificado) — não há corrida dentro de um único processo (checagem e gravação são síncronas, sem `await` entre elas), então o risco é só entre terminais via sync LAN eventual-consistency (mesma característica de toda a arquitetura, não introduzida por este diff). Resolver de verdade pediria um mecanismo tipo `mergeWarnings` (já existe pra conflito de mesa, ARCH §4.2) aplicado a grupos — trabalho de arquitetura novo, fora do escopo desta correção pontual.

- source_spec: `_bmad-output/implementation-artifacts/spec-renomear-remover-cadastros.md`
  summary: As 6 rotas novas de renomear/remover (mesa/categoria/produto) têm ramos de validação (400/404, incluindo as duas travas 409) sem nenhuma cobertura automatizada que rode num caminho de teste normal — só via `packaged-binary-smoke.mjs`, disparado manualmente.
  evidence: Achado real (`blind-hunter` + `verification-gap`, verificado) — não existe workflow `push`/`pull_request` no repo pra nenhum pacote hoje (ambos os workflows existentes são `workflow_dispatch` manual, por design). Resolver de verdade é decisão de infraestrutura de CI do repo inteiro, não algo que esta spec pontual deveria carregar sozinha.

- source_spec: `_bmad-output/implementation-artifacts/spec-renomear-remover-cadastros.md`
  summary: `table_removed` não trata a corrida entre terminais offline — terminal A remove uma mesa, terminal B (offline) abre uma comanda pra ela antes de sincronizar; depois do sync, a comanda referencia um `tableId` ausente de `tables`, sem nenhum reconhecimento do caso.
  evidence: Achado real (`edge-case-hunter`, verificado) — não quebra (fallbacks `?? "—"`/`?? "mesa"` já cobrem o label ausente), mas degrada silenciosamente. Mesma classe de trade-off arquitetural já deferida na spec de remoção de junção de mesas — resolver pediria um mecanismo tipo `mergeWarnings` aplicado a mesas removidas, trabalho de arquitetura novo fora do escopo desta spec.

- source_spec: `_bmad-output/implementation-artifacts/spec-aviso-mesclagem-recente.md`
  summary: ~~ARCH §4.2 promete um "registro de auditoria completo... visível ao dono" de mesclagens de comanda, além da notificação transitória no terminal afetado — mas nunca existiu uma tela separada pra isso; `layout.tsx` é o único consumidor de `mergeWarnings` em todo o frontend.~~ — **resolvido (2026-09-23)**.
  evidence: Achado real (`blind-hunter`, verificado por grep) — gap pré-existente (não introduzido por esta spec; a versão anterior do banner "resolvia" isso incidentalmente ao nunca esconder nada, o que era justamente a fonte da confusão relatada pelo usuário). Construir uma tela de auditoria dedicada pro dono é escopo de UI novo, fora do bug pontual corrigido aqui.
  resolution: Tela `routes/merge-audit.tsx` (`GET /merge-audit`, owner-only, nav própria) consumindo `lib/merge-audit.ts` (`useMergeAudit`) — lê `ProjectedState.mergeWarnings` completo, sem o filtro de 24h/dispensa que `useMergeWarnings`/o banner de `layout.tsx` aplicam. Banner ganhou um link "Ver histórico completo" pra essa tela. Validado manualmente injetando um conflito real de `order_opened` (dois eventos pra mesma mesa via `POST /events` numa instância isolada) e confirmando que `GET /state` retorna o formato esperado e a comanda canônica correta (menor HLC).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-abrir-sessão-de-caixa.md`
  summary: O `catch` único de `POST /cash-sessions` (`apps/desktop/sidecar/src/routes/cash-sessions.ts`) rotula qualquer erro — inclusive uma falha real de `insertEvent` (DB) — como "corpo da requisição não é um JSON válido", escondendo a causa real em caso de bug.
  evidence: Achado real (`blind-hunter` + `edge-case-hunter`, verificado) — `POST /orders` (`orders.ts`) tem exatamente o mesmo padrão de `catch` amplo; não é introduzido por esta story, é a convenção já usada em toda rota do sidecar. Corrigir só a rota nova seria inconsistente com o resto do arquivo — resolver de verdade é uma decisão de tratamento de erro pro sidecar inteiro, fora do escopo desta story pontual.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-abrir-sessão-de-caixa.md`
  summary: `postJson` em `apps/desktop/src/lib/cash-sessions.ts` não trata a rejeição do `fetch()` em si (só `.json()` tem `.catch`) — uma falha de rede/sidecar indisponível deixa a Promise rejeitar sem tratamento, travando `submitting=true` no formulário sem nenhum erro exibido.
  evidence: Achado real (`edge-case-hunter`, verificado) — `apps/desktop/src/lib/tables.ts` (o arquivo que esta story reaproveitou explicitamente como padrão) tem a mesma lacuna. Pré-existente em todo `postJson` do app, não introduzida por este diff — resolver de verdade é um helper HTTP compartilhado com tratamento de erro consistente, mudança arquitetural maior que uma story pontual.

## Deferred from: code review of spec-1-1-abrir-sessão-de-caixa (2026-09-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-abrir-sessão-de-caixa.md`
  summary: `useCashSessionState.refresh` e `useTableConflicts.refresh` (`apps/desktop/src/lib/cash-sessions.ts`, `apps/desktop/src/lib/table-conflicts.ts`) engolem qualquer falha de rede/sidecar indisponível silenciosamente pra array vazio, sem nenhum estado de erro exposto à UI.
  evidence: Achado real (`blind-hunter`, verificado) — mesmo padrão já usado em `useTablesAndOrders.refresh` (`tables.ts`), pré-existente em todo o app, não introduzido por esta story. Risco específico pra sessão de caixa: uma falha transitória de rede pode fazer a tela parecer "nenhuma sessão aberta" quando na verdade existe uma — não corrompe dado (o backend ainda bloqueia duplicata na origem via `isCashSessionOpen`), só confunde o operador momentaneamente. Resolver de verdade é decisão de tratamento de erro pro app inteiro (expor estado de erro em todo `refresh()`), fora do escopo de uma story pontual.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-abrir-sessão-de-caixa.md`
  summary: Sessão de caixa perdedora do conflito de abertura concorrente não gera nenhum aviso transitório (banner) — só aparece na tela permanente "Conflitos de Sincronização". Conflito de mesa tem os dois (banner em `layout.tsx`/`useMergeWarnings` + tela permanente).
  evidence: Achado real (`blind-hunter`, verificado) — a própria AC4 desta story menciona "aviso não bloqueante". Decisão do dono (2026-09-26): adiar — conflito de sessão de caixa exige dois terminais offline abrindo quase ao mesmo tempo (raro na prática, mesma raridade do conflito de mesa); a tela permanente já mostra o conflito com os valores das duas sessões, o banner transitório seria reforço, não a única forma de descoberta. Revisar se vier a incomodar na prática.

## Deferred from: bmad-build review of spec-1-2-registrar-sangria (2026-09-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-registrar-sangria.md`
  summary: Sangria não tem nenhuma checagem de sanidade contra o que realmente está na gaveta (fundo de troco + vendas em dinheiro da sessão − sangrias já feitas + suprimentos) — aceita qualquer valor positivo, mesmo maior do que o que fisicamente poderia existir na sessão.
  evidence: Achado real (`blind-hunter`, verificado) — calcular "quanto tem na gaveta agora" corretamente exige o mesmo mecanismo de valor esperado que a história 1.4 (fechamento com conferência) constrói (soma de vendas em dinheiro da sessão, ver ARCH §3.4). Implementar essa checagem antes da 1.4 exigiria antecipar esse cálculo fora de ordem — fica pra quando 1.4 existir, ou como melhoria futura se o dono achar necessário.

## Deferred from: bmad-code-review of spec-1-2-registrar-sangria (2026-09-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-registrar-sangria.md`
  summary: Reatribuição histórica de sangria (sessão que perde conflito de abertura tem sua sangria reatribuída à canônica) só é testada no nível de projeção (`arch-4.4-cash-session-conflict.test.ts`), não no nível de rota HTTP real (`concurrency-scenario.mjs`).
  evidence: Achado real (`blind-hunter`, verificado) — a lógica de reatribuição vive inteiramente em `resolveCanonicalCashSession`/`project()`; a rota HTTP só grava o evento, nunca decide reatribuição. O teste de projeção já cobre a lógica que importa; um teste HTTP adicional seria redundância de confiança (exercita o mesmo código por um caminho mais caro), não cobertura nova de comportamento — vale considerar se a suíte um dia precisar de mais confiança end-to-end nesse mecanismo.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-registrar-sangria.md`
  summary: Quando "sem sessão de caixa aberta" e "corpo inválido" acontecem ao mesmo tempo, a ordem corrigida de validação (corpo primeiro) faz o operador ver "valor da sangria inválido" em vez de "nenhuma sessão de caixa aberta" — nenhum teste cobre essa combinação.
  evidence: Achado real (`verification-gap`, disposição própria `defer` já no relatório) — combinação improvável no fluxo real, já que o frontend valida o corpo antes de chamar a rota; o caso comum (sem sessão, corpo válido) já é testado e funciona corretamente. Vale um teste de uma linha em `concurrency-scenario.mjs` se algum dia a ordem precisar ficar formalmente garantida.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-registrar-sangria.md`
  summary: Formulário de sangria não expõe nenhum valor calculado antes de confirmar — `epic-1-context.md` (UX & Interaction Patterns) pede isso explicitamente pra essa ação ("nunca uma confirmação cega").
  evidence: Achado real (`acceptance-auditor`, verificado) — sem o mecanismo de valor esperado (história 1.4, soma vendas em dinheiro), qualquer número mostrado agora seria parcial e poderia passar a falsa impressão de ser "o saldo real da gaveta". Decisão do dono (2026-09-26): esperar a história 1.4 trazer o cálculo completo antes de adicionar qualquer preview de valor no formulário de sangria.

## Deferred from: bmad-build review of spec-1-3-registrar-suprimento (2026-09-26)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-registrar-suprimento.md`
  summary: `recordDeposit`/`recordWithdrawal` (`apps/desktop/src/lib/cash-sessions.ts`) e `DepositForm`/`WithdrawalForm` (`apps/desktop/src/routes/cash-register.tsx`) são estruturalmente idênticos, sem nenhuma abstração compartilhada.
  evidence: Achado real (`blind-hunter`, verificado) — refatorar componente React sem nenhuma rede de teste no frontend (convenção pré-existente confirmada pelo `verification-gap`) é mais arriscado que o ganho imediato. Melhor esperar a história 1.4 (fechamento com conferência) trazer a terceira forma parecida e refatorar as três de uma vez só, com mais contexto do formato final compartilhado.

## Deferred from: bmad-build review of spec-1-4-fechar-sessão-de-caixa-com-conferência (2026-09-27)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-fechar-sessão-de-caixa-com-conferência.md`
  summary: Duas `cash_session_closed` concorrentes pra mesma sessão canônica (dois terminais offline fecham a mesma sessão antes de sincronizar) fazem a segunda, ao aplicar na projeção, sobrescrever silenciosamente `closing` da primeira, sem nenhum aviso de conflito — diferente da detecção de conflito de ABERTURA (`cashSessionMergeWarnings`).
  evidence: Achado real (`edge-case-hunter`, verificado lendo `packages/sync-engine/src/reconciliation.ts`, `case "cash_session_closed"`) — decidir COMO sinalizar esse conflito (qual `closing` vence? avisar os dois operadores? bloquear um dos dois retroativamente?) é uma decisão de produto/arquitetura nova; ARCH §4.4 hoje só cobre conflito de abertura de sessão, nunca de fechamento concorrente. Candidato a uma extensão futura de ARCH §4.4 se o caso se mostrar comum na prática (dois caixas fechando a mesma gaveta física é raro, mas não impossível com dois terminais).

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-fechar-sessão-de-caixa-com-conferência.md`
  summary: Uma venda em dinheiro fechada durante um intervalo em que NENHUMA sessão de caixa está aberta (sessão anterior já fechada, próxima ainda não aberta) fica fora da janela `[openedAt, closedAt ?? agora]` de toda sessão existente — não conta pra reconciliação de nenhuma sessão, apesar da Acceptance Criteria da história descrever "pertence à próxima sessão aberta".
  evidence: Achado real (`edge-case-hunter`, verificado contra `computeExpectedCashSessionAmountCents`) — não é um bug de fórmula (o cálculo é consistente com a definição), é uma falha de processo (permitir venda em dinheiro sem nenhuma sessão de caixa aberta) que o software não impede hoje. Candidato a um relatório de "vendas em dinheiro órfãs" (fora de qualquer janela de sessão) no Épico 2 (Relatórios Avançados), quando o dono já tiver visão de período mais ampla pra investigar esses casos.

## Deferred from: bmad-code-review of spec-1-4-fechar-sessão-de-caixa-com-conferência (2026-09-27)

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-fechar-sessão-de-caixa-com-conferência.md`
  summary: `ClosedSessionsSection` (`apps/desktop/src/routes/cash-register.tsx`) renderiza um `ClosedSessionCard` por sessão encerrada, cada um disparando sua PRÓPRIA chamada HTTP (`GET /cash-sessions/expected?sessionId=`) — sem paginação nem limite de quantas sessões são listadas/buscadas.
  evidence: Achado real (`blind-hunter`, verificado) — inofensivo hoje (um estabelecimento fecha o caixa no máximo poucas vezes por dia), mas sem cota nenhuma o padrão N+1 cresce sem limite com o histórico. Decidir a política certa (paginação? janela de datas padrão? carregamento sob demanda?) é uma decisão de produto que já está fora do escopo desta story (Boundaries & Constraints: "não implementar nada do Épico 2 nesta story") — candidato natural pro Épico 2 (Relatórios Avançados), quando o histórico de sessões provavelmente ganha uma visão de período de qualquer forma.

## Deferred from: bmad-build review of spec-2-1-relatório-por-período (2026-09-28)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-relatório-por-período.md`
  summary: `SummaryBlock`/`orderLabel`/lista de comandas pendentes em `apps/desktop/src/routes/reports.tsx` duplicam quase byte-a-byte o bloco "Resumo do dia" e `orderLabel` já existentes em `apps/desktop/src/routes/cash-register.tsx`, sem nenhuma abstração compartilhada.
  evidence: Achado real (`blind-hunter` + `verification-gap`, verificado) — mesma classe de achado já adiada nas Stories 1.2/1.3 pro par `WithdrawalForm`/`DepositForm` (mesmo racional: refatorar componente React sem nenhuma rede de teste no frontend é mais arriscado que o ganho imediato). Agora existem DOIS consumidores desse padrão de bloco de resumo (`cash-register.tsx` e `reports.tsx`) — candidato a extrair um componente compartilhado quando o Épico 2 trouxer a Story 2.2/2.3 (que devem reaproveitar o mesmo formato de resumo) ou quando o frontend ganhar cobertura de teste.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-relatório-por-período.md`
  summary: `getJson` (`apps/desktop/src/lib/reports.ts`, novo nesta story) reincide na mesma lacuna já adiada desde as Stories 1.1-1.4 — não captura a rejeição do `fetch()` em si (só `.json()` tem `.catch`), e trata uma resposta 200 com corpo não-JSON como `{ok: true, data: null}` em vez de erro.
  evidence: Achado real (`blind-hunter` + `edge-case-hunter`, verificado) — mesma causa raiz já documentada e aceita em `deferred-work.md` (Stories 1.1/1.2/1.3), reincidindo no `getJson` novo desta story por seguir o mesmo padrão estabelecido de `postJson`/`getJson` (cada lib de rota mantém seu próprio helper HTTP, não um cliente compartilhado). Corrigir de verdade é uma mudança de convenção em todo helper HTTP do app, não algo pontual desta story.

## Deferred from: bmad-build review of spec-2-2-relatório-por-operador (2026-09-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-relatório-por-operador.md`
  summary: `Reports.tsx`'s `handleSubmit` dispara `getCashRegisterSummaryRange`/`getCashRegisterSummaryByOperator` num `Promise.all` sem `try/catch` — se o `fetch()` de qualquer um dos dois rejeitar (rede fora), a exceção não tratada deixa `status` travado em `"loading"` pra sempre.
  evidence: Achado real (`edge-case-hunter`, verificado) — mesma causa raiz já adiada repetidamente desde as Stories 1.1-2.1 (`getJson`/`postJson` em todo o app não capturam a rejeição do `fetch()` em si), reincidindo no novo `Promise.all` da Story 2.2. Corrigir de verdade é a mesma mudança de convenção já registrada nas entradas anteriores — não pontual desta story.

## Deferred from: bmad-code-review of spec-2-2-relatório-por-operador (2026-09-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-relatório-por-operador.md`
  summary: O bloqueio "owner-only" da rota nova (`GET /reports/cash-register/by-operator`) é só sobre o RELATÓRIO derivado — o dado bruto que ele resume (`closing.operatorId`, `item.canceledByOperatorId`/`canceledAt`, retrofit desta story) já está exposto sem NENHUM controle de papel/sessão via `GET /state` e `GET /events` (ambos pré-existentes, de antes do Epic 1). Qualquer garçom/caixa (ou processo local) já consegue reconstruir a mesma atribuição de vendas/cancelamentos por operador lendo `/state` diretamente.
  evidence: Achado real (`blind-hunter`, verificado contra `apps/desktop/sidecar/src/routes/state.ts`/`events.ts`) — resquício arquitetural pré-Epic-1 (mesmo já documentado antes pra outras rotas de `state.ts`), amplificado por esta story ao adicionar NOVOS campos de atribuição por operador a um endpoint já sem controle de acesso — mas não introduzido por ela. Corrigir de verdade exige decidir se `/state`/`/events` precisam de controle de papel granular (filtrar campos por role) — decisão de arquitetura de segurança que afeta o sidecar inteiro, fora do escopo de uma story de relatório.

## Deferred from: bmad-build review of spec-2-3-relatório-por-produto-curva-abc (2026-09-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-relatório-por-produto-curva-abc.md`
  summary: `Reports.tsx`'s `handleSubmit` agora dispara TRÊS chamadas (período + por-operador + por-produto) no mesmo `Promise.all` sem `try/catch` — se o `fetch()` de qualquer uma rejeitar, a exceção não tratada deixa `status` travado em `"loading"` pra sempre.
  evidence: Achado real (`edge-case-hunter`, verificado) — mesma causa raiz já adiada repetidamente desde as Stories 1.1-2.2 (`getJson`/`postJson` em todo o app não capturam a rejeição do `fetch()` em si), reincidindo (com uma terceira chamada) no `Promise.all` já existente. Corrigir de verdade é a mesma mudança de convenção já registrada nas entradas anteriores — não pontual desta story.

## Deferred from: bmad-code-review of spec-2-3-relatório-por-produto-curva-abc (2026-09-29)

- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-relatório-por-produto-curva-abc.md`
  summary: `docs/architecture.md` (§3.4/3.5/4.4) ainda chama este trabalho de "Epic B — Relatórios Avançados", nunca atualizado pra "Epic 2" quando `epics.md`/`sprint-status.yaml` foram renumerados de letras pra números (achado real de arquitetura, necessário pro parser de `sprint_plan.py`). Quem lê só `architecture.md` não encontra "Epic 2" em lugar nenhum.
  evidence: Achado real (`blind-hunter`, verificado) — drift de documentação pré-existente desde a renumeração original (antes até da Story 1.1 começar), não introduzido nem agravado especificamente por esta story. Corrigir é uma limpeza de doc que abrange todo o Épico 9 (§3.4/3.5/4.4 inteiras), não algo pontual da Story 2.3.
