---
title: 'Relatório consolidado multi-terminal (Epic 3 / Story 3.1)'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '2f89ef3982fbd7d1e30882912513edc45998cd04'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O dono com mais de um terminal não vê o caixa consolidado de todos direto no app — precisaria consultar o backend manualmente (sem interface nenhuma pra isso hoje).

**Approach:** `GET /reports/cash-register` do backend (existente desde M11, só vendas) ganha dados de sessão de caixa consolidados. Nova rota no sidecar faz proxy autenticado pra essa rota do backend usando a credencial de nuvem já persistida localmente (`cloud-credential.ts`) — o frontend nunca fala com o backend diretamente, só com o sidecar (mesmo padrão de todo o resto do app). Tela nova, owner-only, mostra o resultado ou uma mensagem clara se a nuvem não estiver configurada.

## Boundaries & Constraints

**Always:**
- **Descoberta de arquitetura, não uma decisão nova:** o backend já projeta o log de eventos inteiro (todos os 27 tipos, incluindo os 4 de `cash_session`) via `project()` do `sync-engine` — a MESMA função usada localmente — e guarda o `ProjectedState` inteiro como JSONB em `projections` (`schema.sql`). Não existe "tabela relacional só de orders" pra espelhar; `cashSessions` já está disponível na projeção do backend hoje, sem nenhuma migration nova. "Projeção Postgres nova" (AC) é satisfeita por essa descoberta — não precisa de DDL novo.
- Nova função pura `computeConsolidatedCashSessionSummary(cashSessions, orders, nowMs)` em `packages/sync-engine/src/reporting.ts` — acha a sessão canônica (`mergedInto === undefined`); se `status === "open"`, devolve `{status: "open", openedAt, openingAmountCents, depositsCents, withdrawalsCents, expectedAmountCents}` (reaproveita `computeExpectedCashSessionAmountCents`); se não houver sessão canônica aberta, devolve `null` (mesma semântica de "nenhuma sessão aberta" já usada em `cash-register.tsx`, Épico 1). Não duplica o histórico de sessões encerradas (isso já existe localmente, Épico 1) — só o status ATUAL.
- `GET /reports/cash-register` (backend) passa a incluir `cashSession: ConsolidatedCashSessionSummary | null` na resposta, ao lado dos campos de venda já existentes — sem alterar os campos já devolvidos, só adicionando um novo.
- Rota nova no sidecar (`GET /reports/cash-register/consolidated`) faz o proxy: lê `loadCloudCredential(ctx.dataDir)`; se `null`, 400 com mensagem clara de configurar a sincronização primeiro (AC literal — NUNCA um erro genérico); se existir, `fetch(`${BACKEND_URL}/reports/cash-register`, {headers: {Authorization: `Bearer ${credential.credential}`}})` e repassa a resposta. Falha de rede/backend fora do ar é um erro DIFERENTE do "não configurado" (ver Matrix).
- Acesso: owner-only — bloqueio de papel acontece no SIDECAR (o backend não tem conceito de "papel de operador", só autentica o TERMINAL) e na tela (route guard), mesmo padrão das Stories 2.1-2.3.
- Tela nova e SEPARADA das de `/reports` (Épico 2) — natureza diferente (depende de nuvem configurada, sem seletor de intervalo de datas, snapshot de "hoje"), Epic 3 é isolado por arquitetura (epics.md: "único requisito de infraestrutura deste conjunto de épicos").
- Dinheiro sempre em centavos inteiros (NFR7).

**Never:**
- Não migrar o schema do Postgres — a descoberta acima já resolve o requisito sem DDL novo.
- Não expor a URL do backend nem a credencial de nuvem pro frontend/renderer — só o sidecar fala com o backend (ARCH §7).
- Não adicionar seletor de intervalo de datas nesta story — só o snapshot de hoje (mesmo comportamento atual de `GET /reports/cash-register`, que já usa `date` opcional default hoje).
- Não implementar histórico de sessões encerradas no relatório consolidado — isso já existe localmente (Épico 1); esta story mostra só o status ATUAL da sessão canônica.
- Não criar teste automatizado que suba um Postgres real (backend não tem nenhuma infraestrutura de teste hoje — nem um teste sequer, só `tsc --noEmit` no CI) — cobertura é: unitária pra `computeConsolidatedCashSessionSummary` (pura, sem Postgres) + verificação manual documentada do fluxo ponta a ponta (`docker-compose.yml` já existe pro Postgres local).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sessão canônica aberta | Estabelecimento com uma sessão de caixa aberta (qualquer terminal) | `cashSession` no JSON devolve status aberto + valor esperado calculado na hora | N/A |
| Nenhuma sessão aberta | Nenhuma sessão canônica com `status === "open"` | `cashSession: null` — tela mostra "nenhuma sessão de caixa aberta no momento" | N/A |
| Terminal sem credencial de nuvem | `loadCloudCredential` devolve `null` | Rota do sidecar rejeita ANTES de tentar qualquer chamada ao backend | 400 mensagem clara ("configure a sincronização com a nuvem primeiro"), nunca um erro genérico |
| Backend/nuvem inalcançável (credencial existe) | `fetch` pro backend falha (timeout, rede fora) | Rota do sidecar devolve um erro DIFERENTE do "não configurado" | 502 (ou equivalente) "não foi possível conectar à nuvem agora" |
| Papel waiter ou cashier | Operador logado não é owner | Acesso negado (rota e tela) | 403 "acesso restrito ao dono" |
| Sessão mesclada perdedora existe junto da canônica | Conflito de abertura já resolvido (ARCH §4.4), uma sessão com `mergedInto` definido | Relatório usa só a canônica — a perdedora nunca aparece nem é contada | N/A |

</frozen-after-approval>

## Code Map

- `packages/sync-engine/src/reporting.ts` -- nova `computeConsolidatedCashSessionSummary(cashSessions: readonly CashSessionState[], orders: readonly OrderState[], nowMs: number): ConsolidatedCashSessionSummary | null` -- acha a canônica (`mergedInto === undefined && status === "open"`); se achar, monta o resumo reaproveitando `computeExpectedCashSessionAmountCents`; se não, `null`
- `packages/sync-engine/test/reporting.test.ts` -- testes de `computeConsolidatedCashSessionSummary`: sessão aberta devolve resumo correto, nenhuma sessão aberta devolve `null`, sessão mesclada perdedora nunca conta, valor esperado reflete sangria/suprimento/vendas já registrados
- `apps/backend/src/index.ts` -- `GET /reports/cash-register` (rota já existente) passa a incluir `cashSession: computeConsolidatedCashSessionSummary(projection?.cashSessions ?? [], projection?.orders ?? [], Date.now())` na resposta
- `apps/desktop/sidecar/src/routes/reports.ts` -- nova rota `GET /reports/cash-register/consolidated`: `requireSession` + bloqueio owner-only + `loadCloudCredential(ctx.dataDir)` (400 se `null`) + `fetch` autenticado pro backend (importa `BACKEND_URL` de `cloud-sync-client.ts`) + repassa a resposta ou erro de rede (502)
- `apps/desktop/src/lib/reports.ts` -- `getConsolidatedCashRegisterReport()`, mesmo padrão `getJson` já usado
- `apps/desktop/src/routes/consolidated-report.tsx` -- NOVO arquivo, tela dedicada (não é seção de `/reports`): mostra resumo de vendas consolidado + status da sessão de caixa, ou mensagem de "configure a nuvem" / "nuvem indisponível"
- `apps/desktop/src/app.tsx` -- nova rota `/consolidated-report` dentro do grupo `RequireRole allowed={["owner"]}` já existente
- `apps/desktop/src/layout.tsx` -- novo `NavLink` owner-only, mesmo padrão dos outros itens condicionais

## Tasks & Acceptance

**Execution:**
- [x] `packages/sync-engine/src/reporting.ts` -- `computeConsolidatedCashSessionSummary` -- resumo da sessão canônica, reaproveitando `computeExpectedCashSessionAmountCents`
- [x] `packages/sync-engine/test/reporting.test.ts` -- testes da nova função -- cobertura da matriz
- [x] `apps/backend/src/index.ts` -- estender `GET /reports/cash-register` com `cashSession` -- dados de sessão na resposta já existente
- [x] `apps/desktop/sidecar/src/routes/reports.ts` -- rota `GET /reports/cash-register/consolidated`, proxy autenticado -- endpoint local que o frontend consome
- [x] `apps/desktop/src/lib/reports.ts` -- cliente HTTP -- consumo da rota
- [x] `apps/desktop/src/routes/consolidated-report.tsx` -- tela nova -- interface do usuário
- [x] `apps/desktop/src/app.tsx` + `layout.tsx` -- rota + nav item owner-only -- navegação
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- **achado no Matrix Test Audit do orquestrador, não estava no Code Map original** -- a linha "papel waiter/cashier" da matriz não tinha NENHUM teste, apesar de ser testável sem Postgres real (o bloqueio de papel acontece antes de qualquer chamada à nuvem). Adicionado CENÁRIO 8: bloqueio de waiter/cashier (403) + mensagem clara de nuvem não configurada (400, testável de graça já que nenhum terminal deste harness se registra num backend real) -- ver Implementation Notes

**Acceptance Criteria:**
- Given o backend precisa saber sobre sessão de caixa/sangria/suprimento pra consolidar de verdade, when esta story é implementada, then `GET /reports/cash-register` passa a incluir dados de sessão consolidados, não só vendas (sem migration nova — a projeção já existente já carrega esse dado, ver Boundaries)
- Given um terminal com credencial de nuvem configurada, when o dono abre o relatório consolidado, then vê o resumo agregado de todos os terminais do estabelecimento (vendas + sessão de caixa) direto na tela do app
- Given um terminal SEM credencial de nuvem configurada, when o dono tenta abrir o relatório consolidado, then vê uma mensagem clara explicando que precisa configurar a sincronização com a nuvem primeiro (não um erro genérico)
- Given papel "waiter" ou "cashier", when tenta acessar, then acesso negado

## Implementation Notes

Implementado 2026-09-29 (sem passar pelo loop formal de code review desta vez — implementação direta a pedido).

- `computeConsolidatedCashSessionSummary` segue exatamente o Code Map: acha a canônica (`mergedInto === undefined && status === "open"`), devolve `null` se não houver, senão monta `{status: "open", openedAt, openingAmountCents, depositsCents, withdrawalsCents, expectedAmountCents}` reaproveitando `computeExpectedCashSessionAmountCents` só pro campo `expectedAmountCents`; `depositsCents`/`withdrawalsCents` são somas brutas de `session.deposits`/`session.withdrawals` (não window-filtradas feito o helper reaproveitado — irrelevante pra uma sessão ainda ABERTA, cujos movimentos nunca caem fora de `[openedAt, nowMs]`).
- Testes novos em `reporting.test.ts` cobrem: sessão aberta com sangria/suprimento/venda em dinheiro já registrados; nenhuma sessão (array vazio); sessão fechada sem nenhuma outra aberta (`null`); sessão mesclada perdedora (confirma que só a canônica é lida — inclusive um depósito registrado contra o ID da perdedora, que a PROJEÇÃO já redireciona pra canônica via `resolveCanonicalCashSession`, nunca aparece com o `openingAmountCents`/estado da perdedora).
- Backend: `GET /reports/cash-register` agora faz spread do resultado de `computeCashRegisterSummary` + `cashSession` novo — nenhum campo existente mudou de formato.
- Sidecar: rota nova valida sessão + papel owner ANTES de olhar a credencial (mesma ordem das outras rotas de `reports.ts`); `loadCloudCredential(ctx.dataDir) === null` -> 400 com mensagem literal do AC; falha de `fetch` (exceção OU `!res.ok`) -> 502 com mensagem diferente; timeout de 8s (`AbortSignal.timeout`, mesmo valor de `cloud-sync-client.ts`) pra nunca deixar a requisição pendurada.
- Frontend: `consolidated-report.tsx` carrega uma vez ao montar (sem seletor de datas), com botão "Atualizar" manual; mostra os três estados da Matrix (sessão aberta / nenhuma sessão / erro — a mesma mensagem do sidecar é exibida direto, sem reformular).
- **Verificação manual ponta a ponta (Postgres real, `docker-compose up -d` + backend + sidecar apontando pra ele) NÃO foi executada nesta sessão** — só a verificação automatizada (`npm test -w packages/sync-engine`: 93/93 passam, incluindo os 5 testes novos; `tsc --noEmit` limpo nos 5 workspaces afetados; `npm run build -w apps/desktop` limpo, incluindo rebuild do sidecar SEA). Fica registrado como risco/pendência — ver seção Verification.

## Spec Change Log

## Review Triage Log

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] **high → Patch, achado real e importante, duplicado entre 2 camadas** — a justificativa original de que os caminhos de sucesso (200)/nuvem inalcançável (502) do proxy "exigem Postgres real" pra testar estava ERRADA: `BACKEND_URL` é só uma variável de ambiente (`PASSA_A_REGUA_BACKEND_URL`) e `loadCloudCredential` só lê um arquivo JSON local, sem nenhum passo de rede — os dois são testáveis com um stand-in HTTP mínimo + credencial escrita direto no data-dir, sem Postgres nenhum. Adicionado CENÁRIO 9: terceiro sidecar isolado apontando pra um stand-in local, confirma 200 com corpo repassado TAL E QUAL e 502 (mensagem diferente do 400) quando o stand-in cai. [apps/desktop/sidecar/test/concurrency-scenario.mjs] *blind-hunter + verification-gap, achado duplicado com plano de implementação idêntico*.
- [x] **medium → Patch** — um 401 do backend (credencial de TERMINAL inválida/revogada) era achatado na mesma mensagem genérica de "nuvem inalcançável" (502) — problema real e ACIONÁVEL diferente (precisa reconfigurar a sincronização, não esperar a rede voltar). Corrigido com uma checagem e mensagem específicas. [apps/desktop/sidecar/src/routes/reports.ts] *blind-hunter + edge-case-hunter, achado duplicado*.
- [x] **low → Patch** — `CLOUD_REQUEST_TIMEOUT_MS` duplicava `REQUEST_TIMEOUT_MS` de `cloud-sync-client.ts` (mesmo valor, cópia manual que podia divergir). `REQUEST_TIMEOUT_MS` exportado e reaproveitado. [apps/desktop/sidecar/src/cloud-sync-client.ts, apps/desktop/sidecar/src/routes/reports.ts] *blind-hunter*.
- [x] **low → Patch** — corpo do backend repassado sem nenhuma checagem de forma — um backend desalinhado (skew de versão) devolveria `200` com algo que quebraria o frontend tentando ler campos inexistentes. Guarda mínima adicionada (`typeof body !== "object"`). [apps/desktop/sidecar/src/routes/reports.ts] *edge-case-hunter*.
- [x] **low → Patch** — `cashSession` sempre usa `Date.now()`, independente do `date` opcional usado pro lado de vendas do mesmo endpoint — proposital (sessão de caixa é sempre "agora", Design Notes), mas não estava documentado. Comentário adicionado. [apps/backend/src/index.ts] *blind-hunter*.
- [x] **low → Defer** — `ConsolidatedReport` sem guarda de unmount (mesma classe de risco assíncrono já adiada desde as Stories 2.1-2.3). Registrado em `deferred-work.md`. [apps/desktop/src/routes/consolidated-report.tsx] *blind-hunter + edge-case-hunter, achado duplicado*.

**Rejeitados:**
- `ConsolidatedCashSessionSummary`/`ConsolidatedCashRegisterReport` redeclarados em `apps/desktop/src/lib/reports.ts` em vez de importar o tipo de `packages/sync-engine` — **[rejeitado]** mesmo padrão já estabelecido e deliberado em todo o app (`CashRegisterSummary` já é duplicado dessa mesma forma entre `sync-engine` e `apps/desktop/src/lib/cash-register.ts` desde o Épico 6/M8) — frontend nunca importa `@passa-a-regua/sync-engine` diretamente, só conversa com o sidecar via HTTP (decisão já registrada na Story 2.1).
- CENÁRIO 8 (papel/sem-credencial) inserido fisicamente entre o Cenário 7 e o Cenário 3 no arquivo — **[rejeitado]** mesmo padrão deliberado e pré-existente desde o Cenário 4 (o Cenário 3, queda de terminal, sempre roda por último por motivo estrutural, não por ordem sequencial de posição) — mesmo veredito já dado na Story 2.3.
- `catch` genérico também cobre `backendRes.json()` lançando (corpo 200 mas JSON inválido), rotulado com a mesma mensagem de "nuvem inalcançável" mesmo não sendo bem uma falha de conectividade — **[aceito como simplificação, não corrigido]** o próprio achado (`verification-gap`) reconhece que é uma simplificação intencional (`catch` único, mesmo tratamento) — dividir isso num terceiro tipo de erro é mais complexidade do que o caso (backend respondendo 200 com corpo corrompido) justifica; a checagem de forma já adicionada (`typeof body !== "object"`) cobre o caso mais provável desse tipo de skew.

## Design Notes

**Por que nenhuma migration de Postgres é necessária:** a arquitetura do backend (M9, `schema.sql`) já guarda o `ProjectedState` inteiro (resultado de `project()`, o MESMO `sync-engine` usado localmente) como JSONB numa única tabela `projections` — não existe uma tabela relacional por tipo de agregado pra espelhar "orders" e replicar pra "cash_session". Isso significa que os 4 eventos de `cash_session` (existentes desde o Épico 1) já estão sendo projetados e persistidos no backend desde que o primeiro terminal sincronizou — só nunca foram LIDOS por nenhum endpoint. Esta story é, na prática, inteiramente sobre LER um dado que já existe, não sobre gravar um novo.

**Por que uma tela separada, não uma seção de `/reports`:** as telas de `/reports` (Épico 2) são 100% locais (sidecar/SQLite), sempre disponíveis, com seletor de intervalo de datas. O relatório consolidado depende de uma pré-condição estrutural diferente (nuvem configurada) e mostra um snapshot de "agora", não um intervalo — misturar os dois na mesma tela criaria uma seção que às vezes funciona e às vezes não por um motivo alheio ao resto da página, confuso pro dono. Epic 3 já é tratado como isolado no planejamento (epics.md).

**Por que só o status ATUAL da sessão, não histórico:** "Sessões encerradas" (histórico completo, com o aviso de valor-pode-ter-mudado) já existe localmente desde a Story 1.4. Duplicar isso no relatório remoto seria retrabalho sem valor novo — o que falta hoje é só saber, de qualquer terminal, se HÁ uma sessão aberta agora e seu valor esperado.

**Por que sem teste automatizado ponta a ponta com Postgres real:** o backend não tem nenhuma infraestrutura de teste hoje (confirmado: `package.json` sem script `test`, CI só roda `tsc --noEmit`). Criar um harness novo de teste com Postgres real seria um investimento de infraestrutura desproporcional a uma única story — a lógica de verdade (`computeConsolidatedCashSessionSummary`) é pura e 100% testável sem Postgres nenhum; a integração (rota do backend + proxy do sidecar) é verificada manualmente com o `docker-compose.yml` já existente, documentado na seção Verification.

**Correção no code review (achado real, blind-hunter + verification-gap):** a premissa acima estava parcialmente errada — o PROXY do sidecar (`GET /reports/cash-register/consolidated`) e seus dois desfechos principais (sucesso repassando o corpo tal e qual; backend inalcançável → 502 distinto do 400 de "não configurado") SÃO testáveis sem Postgres nenhum, com um stand-in HTTP mínimo na mesma `BACKEND_URL` (variável de ambiente) e uma credencial de nuvem escrita direto no data-dir (sem passar pelo fluxo de pareamento real) — automatizado no CENÁRIO 9 de `concurrency-scenario.mjs`. O que continua exigindo Postgres real é só a projeção de `cash_session` de verdade fluindo pelo backend — isso segue verificado manualmente (ver Verification).

## Verification

**Commands:**
- `npm test -w packages/sync-engine` -- expected: suíte completa passa, incluindo os testes novos de `computeConsolidatedCashSessionSummary`
- `npx tsc --noEmit` nos workspaces afetados -- expected: sem erros (`shared-types`, `sync-engine`, `apps/backend`, `apps/desktop/sidecar`, `apps/desktop`)
- `npm run build -w apps/desktop` -- expected: build de produção limpo

**Manual checks (backend não tem harness de teste automatizado):**
- Subir Postgres local (`docker-compose up -d`), rodar o backend (`npm run dev -w apps/backend`) e um sidecar apontando pra ele (`PASSA_A_REGUA_BACKEND_URL`), abrir/fechar uma sessão de caixa, registrar sangria/suprimento, esperar o ciclo de sync, e confirmar que `GET /reports/cash-register/consolidated` no sidecar devolve o `cashSession` correto
- Confirmar que sem credencial de nuvem (`cloud-credential.json` ausente), a rota devolve 400 com a mensagem clara, não um erro genérico
- Confirmar visualmente na tela nova (`/consolidated-report`) os três estados: sessão aberta, sem sessão aberta, nuvem não configurada

**Resultados (verificação manual do orquestrador, ponta a ponta com Postgres real):**
- Subida uma instância isolada real: `docker compose up -d postgres`, backend (`node apps/backend/dist/index.js`, porta 4551) e um sidecar isolado (porta 4700, `PASSA_A_REGUA_BACKEND_URL=http://localhost:4551`, data-dir temporário) — nunca tocando a porta 4550/dados reais do usuário.
- Cadastrado Ana (dono), esperado o ciclo de cloud-sync registrar a credencial (`GET /pairing/cloud-status` → `connected: true` em ~3 ciclos de 5s).
- `GET /reports/cash-register/consolidated` sem nenhuma sessão de caixa aberta → 200, `cashSession: null` -- CONFIRMADO.
- Aberta sessão (fundo R$100), registrado suprimento (R$5) e sangria (R$2), fechada uma comanda de R$10 em dinheiro; após o próximo ciclo de sync, `GET /reports/cash-register/consolidated` → 200, `cashSession.expectedAmountCents: 11300` (10000 + 1000 venda + 500 suprimento − 200 sangria) -- CONFIRMADO, bate exatamente com o cálculo manual.
- Backend derrubado (`kill`) com credencial já configurada → `GET /reports/cash-register/consolidated` → **502** `"não foi possível conectar à nuvem agora"`, mensagem DIFERENTE do 400 de "não configurado" -- CONFIRMADO.
- Bloqueio de papel (waiter/cashier → 403) e "sem credencial de nuvem" (owner → 400, mensagem clara) também confirmados via o Cenário 8 novo em `concurrency-scenario.mjs` (não precisam de Postgres — o bloqueio de papel acontece antes de qualquer chamada à nuvem).
- Ambiente de verificação limpo ao final (processos próprios encerrados, `docker compose down`, sem sobra na porta 4551/4700/5432).
- `npm test -w packages/sync-engine` -- PASSOU (93 testes, 12 arquivos; eram 88 antes desta story, +5 novos de `computeConsolidatedCashSessionSummary`).
- `npx tsc --noEmit` -- limpo em `shared-types`, `sync-engine`, `apps/backend`, `apps/desktop/sidecar`, `apps/desktop`.
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- "TODOS OS CENÁRIOS PASSARAM", incluindo o novo CENÁRIO 8.
- Re-verificação pós-`bmad-build` step 4 (patches aplicados — 401 distinto de 502, timeout reaproveitado, corpo validado, comentário de `Date.now()`, e o CENÁRIO 9 novo): `npm test -w packages/sync-engine` (93 testes), `npx tsc --noEmit` limpo em `shared-types`/`sync-engine`/`apps/backend`/`apps/desktop/sidecar`/`apps/desktop`, rebuild completo e `concurrency-scenario.mjs` -- todos PASSARAM ("TODOS OS CENÁRIOS PASSARAM."), incluindo o CENÁRIO 9 (proxy repassa 200 tal e qual e distingue 502 de nuvem inalcançável, sem Postgres).
