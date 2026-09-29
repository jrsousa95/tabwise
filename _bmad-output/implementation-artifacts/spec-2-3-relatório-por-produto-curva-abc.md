---
title: 'Relatório por produto / curva ABC (Epic 2 / Story 2.3)'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'f183e0be70312542adb9c616f6d1dab621c1f4ac'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O dono não sabe quais produtos mais vendem (quantidade e valor) num período — hoje só existe o cardápio cadastrado, sem nenhuma leitura agregada do que de fato vendeu.

**Approach:** Nova função de leitura pura em `reporting.ts` que agrega `item_added` (excluindo cancelados) por nome de item, dentro do mesmo intervalo de datas das Stories 2.1/2.2 (janela pelo `closing.closedAt` da order dona, já que o item não tem timestamp próprio). Nova rota owner-only no mesmo arquivo `reports.ts`, nova seção "Por produto" na mesma tela `/reports`. Sem evento novo — só leitura agregada do log já existente.

## Boundaries & Constraints

**Always:**
- Nenhum evento novo, nenhuma mudança de schema (AC literal) — função pura sobre `OrderState[]` já materializado.
- Agrupamento por `item.name` (string) — `item_added` não carrega `productId`, só uma cópia própria de nome/preço no momento da venda (decisão deliberada, preserva histórico correto mesmo se o produto for renomeado/removido depois). Um produto renomeado no meio do período aparece como duas entradas distintas no ranking (uma por nome usado) — limitação aceita, não uma story de retrofit.
- Janela por `closing.closedAt` da ORDER dona do item (mesmo filtro de `computeCashRegisterSummaryForRange`) — item não tem timestamp próprio de quando foi adicionado. Extrair um helper interno compartilhado (`ordersClosedInRange`) reaproveitado pelas duas funções, em vez de duplicar o filtro uma terceira vez.
- Item cancelado (`item.canceled === true`) NUNCA conta na quantidade nem no valor, independente de quando foi cancelado.
- Ranking ordenado por valor vendido desc (`totalSoldCents`) — convenção de curva ABC (classificar por contribuição de receita); quantidade vendida (`quantitySold`) exposta junto, não como critério de ordenação primário.
- Mesma tela `/reports` ganha uma seção nova "Por produto", disparada pelo mesmo botão "Ver relatório"/mesmo intervalo já selecionado — sem tela nova, sem nav item novo.
- Rota nova no MESMO arquivo `apps/desktop/sidecar/src/routes/reports.ts`, reaproveitando `parseDateRange` já extraído na Story 2.2.
- Acesso: owner-only, mesmo bloqueio inline já usado nas rotas existentes.
- Corpo/query lido e validado ANTES de qualquer cálculo. Dinheiro sempre em centavos inteiros (NFR7).

**Never:**
- Não implementar cortes de classificação A/B/C (percentual acumulado de receita, tiers) — a AC pede só "ranking por quantidade vendida e por valor", não os cortes em si; decidir os percentuais de corte é uma decisão de produto fora do escopo desta story.
- Não adicionar `productId` a `item_added` nem qualquer evento novo/campo retroativo — a AC proíbe explicitamente mudança de modelo de dados.
- Não implementar a Story 2.4 nem o Epic 3 nesta rodada.
- Não alterar a assinatura nem o comportamento de `computeCashRegisterSummaryForRange`/`computeCashRegisterSummary` existentes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ranking de um intervalo válido | `from=2026-09-01&to=2026-09-07`, dono logado, comandas fechadas com itens variados | 200 com array `{name, quantitySold, totalSoldCents}` ordenado por `totalSoldCents` desc | N/A |
| Item cancelado não conta | Comanda fechada com 2 itens, 1 cancelado antes do fechamento | Ranking soma só o item não cancelado; o cancelado não aparece nem soma zero pro nome dele (se for o único desse nome) | N/A |
| Mesmo produto vendido em comandas diferentes | 2 comandas fechadas no período, cada uma com 1 unidade do mesmo item (mesmo `name`) | Quantidade e valor somados numa única entrada do ranking (`quantitySold: 2`) | N/A |
| Comanda ainda aberta no período | Order aberta com itens, sem `order_closed` | Nenhum item dela conta no ranking (mesma janela de `closing.closedAt`, comanda sem `closing` não entra) | N/A |
| Intervalo inválido (mesmas regras das Stories 2.1/2.2) | `from > to`, formato errado, ou calendário-inválido | Rejeitado antes de calcular qualquer coisa | 400 "intervalo de datas inválido" |
| Papel waiter ou cashier | Operador logado não é owner | Acesso negado | 403 "acesso restrito ao dono" |

</frozen-after-approval>

## Code Map

- `packages/sync-engine/src/reporting.ts` -- extrair `ordersClosedInRange(orders, fromDateKey, toDateKey): OrderState[]` do filtro já existente em `computeCashRegisterSummaryForRange` (mesma checagem `mergedInto === undefined && status === "closed" && localDateKey(closing.closedAt)` dentro do intervalo); `computeCashRegisterSummaryForRange` passa a reaproveitar esse helper. Nova `computeProductRanking(orders, fromDateKey, toDateKey): Array<{name: string, quantitySold: number, totalSoldCents: number}>` -- itera os itens de `ordersClosedInRange(...)`, pula `item.canceled`, acumula por `item.name` (`quantitySold += item.quantity`, `totalSoldCents += item.unitPriceCents * item.quantity`), ordena por `totalSoldCents` desc
- `packages/sync-engine/test/reporting.test.ts` -- testes novos: item cancelado não conta, mesmo nome em comandas diferentes soma, comanda ainda aberta não conta, ordenação por valor
- `apps/desktop/sidecar/src/routes/reports.ts` -- nova rota `GET /reports/cash-register/by-product?from=&to=`: `requireSession` + bloqueio owner-only + `parseDateRange` (reaproveitado) + `computeProductRanking(ctx.currentState().orders, from, to)`
- `apps/desktop/src/lib/reports.ts` -- `getCashRegisterSummaryByProduct(from, to)`, mesmo padrão `getJson` já usado
- `apps/desktop/src/routes/reports.tsx` -- `handleSubmit` passa a disparar as TRÊS chamadas (período + por-operador + por-produto) em paralelo; nova seção "Por produto" (tabela: nome, quantidade vendida, total vendido), renderizada junto do resultado já existente
- `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender com a matriz desta story no nível de rota HTTP real

## Tasks & Acceptance

**Execution:**
- [x] `packages/sync-engine/src/reporting.ts` -- extrair `ordersClosedInRange` + `computeProductRanking` -- ranking agregado, reaproveitando o filtro de janela já existente
- [x] `packages/sync-engine/test/reporting.test.ts` -- testes de `computeProductRanking` -- cobertura da matriz
- [x] `apps/desktop/sidecar/src/routes/reports.ts` -- rota `GET` nova, owner-only -- endpoint do ranking
- [x] `apps/desktop/src/lib/reports.ts` -- cliente HTTP -- consumo da rota
- [x] `apps/desktop/src/routes/reports.tsx` -- seção "Por produto" na mesma tela -- interface do usuário
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender com a matriz desta story no nível de rota HTTP real

**Acceptance Criteria:**
- Given um intervalo de datas, when o dono abre o relatório de produtos, then vê um ranking por quantidade vendida e por valor, baseado nos eventos `item_added` já existentes
- Given um item cancelado (`item_canceled`), when o ranking é calculado, then esse item não conta na quantidade/valor vendido
- Given esta história, when implementada, then não adiciona nenhum evento novo ao modelo de dados — só leitura agregada do log já existente
- Given papel "waiter" ou "cashier", when tenta acessar, then acesso negado

## Implementation Notes

## Spec Change Log

## Review Triage Log

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] **low → Patch** — nenhum teste construía um empate real de `totalSoldCents` pra verificar o desempate por nome (`|| a.name.localeCompare(b.name)`) — uma regressão que removesse/invertesse o desempate passaria despercebida. Teste novo adicionado com dois produtos empatados. [packages/sync-engine/test/reporting.test.ts] *blind-hunter + verification-gap, achado duplicado*.
- [x] **low → Patch** — `computeProductRanking` lê `item.quantity` do estado FINAL projetado, que já reflete `item_quantity_incremented` (achado real: esse evento existe e eu não tinha investigado — Épico 4/M6), mas nenhum teste construía essa interação. Teste novo adicionado (`item_added` + `item_quantity_incremented` somando corretamente no ranking). [packages/sync-engine/test/reporting.test.ts] *blind-hunter*.
- [x] **low → Patch** — agrupamento por `item.name` é sensível a maiúsculas/espaços (`"Cerveja"` ≠ `"cerveja "`), além da limitação já documentada de renomeação — não estava explícito no Design Notes. Nota estendida. [_bmad-output/implementation-artifacts/spec-2-3-relatório-por-produto-curva-abc.md] *blind-hunter*.
- [x] **low → Defer** — `Reports.tsx`'s `handleSubmit` (agora com TRÊS chamadas no mesmo `Promise.all`) continua sem `try/catch` — mesma causa raiz já adiada repetidamente desde as Stories 1.1-2.2. [apps/desktop/src/routes/reports.tsx] *edge-case-hunter*.

**Rejeitados:**
- Rota nova reimplementa o bloqueio owner-only inline em vez de reaproveitar `ctx.requireOwner()` (`context.ts`) — **[rejeitado]** mesmo achado já rejeitado na Story 2.2: a spec congelada desta story explicitly manda "mesmo bloqueio inline já usado nas rotas existentes" (mensagem `"acesso restrito ao dono"`, diferente de `requireOwner`'s `"só o dono pode fazer isso"`) — decisão deliberada de consistência entre as 3 rotas de relatório do mesmo arquivo, não um descuido.
- `item_quantity_incremented`'s `deltaQuantity` sem revalidação de positividade, item incrementado-a-zero/negativo poderia poluir o ranking — **[false]** `deltaQuantity: z.number().int().positive()` no schema (`events.ts`) — incremento só soma um delta sempre positivo à quantidade existente, nunca pode zerar/negativar via esse caminho. Confirmado lendo o schema e o `case` da projeção.
- `handleSubmit` (`Promise.all` das três chamadas) não tem caminho de sucesso PARCIAL — se só a chamada por-produto falhar, as seções de período/por-operador (que tiveram sucesso) também não renderizam — **[rejeitado]** mesmo trade-off de design já aceito no code review da Story 2.2 ("não filing como achado, é uma escolha de design"), não uma regressão introduzida aqui.
- Nenhum teste (unitário ou HTTP) cobre o caso de sessão AUSENTE (401 "faça login primeiro") pra nenhuma das 3 rotas de relatório — **[rejeitado, pré-existente]** lacuna já presente desde a Story 2.1/2.2 em todas as rotas irmãs, não introduzida por esta story; se vale corrigir, é uma correção que afeta as 3 rotas de uma vez, não pontual da 2.3.
- `postJson(.../session/login)` no script de teste nunca verifica o status da resposta antes de prosseguir — **[rejeitado, pré-existente]** mesmo padrão usado em TODO login do script desde o Cenário 1, não introduzido por esta story.

#### Rodada 2 — `bmad-code-review` (commit `d4b3b55`, 2026-09-29)

4 camadas (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Acceptance Auditor não achou violação de AC/constraint. Edge Case Hunter e Verification Gap só reconfirmaram o `fetch()` sem tratamento já adiado (nenhum achado novo). Cada achado abaixo verificado contra o código real antes do veredito.

- [x] **medium → Patch, achado real** — o único teste de agregação entre comandas diferentes usava o MESMO preço nas duas vendas — a razão de existir da curva ABC (ranquear por VALOR acumulado, não só quantidade) nunca era verificada com preços DIFERENTES pro mesmo produto (ex: reajuste no meio do período). Teste novo adicionado: duas vendas do mesmo item a R$10 e R$12, confirmando soma 2200 (nunca `2 × preço`). [packages/sync-engine/test/reporting.test.ts] *blind-hunter*.
- [x] **low → Patch** — `quantitySold` renderizado sem formatação de milhar (`{row.quantitySold}`) enquanto `totalSoldCents` ao lado já usa `formatCentsToBRL` — inconsistente na mesma linha. Corrigido com `toLocaleString("pt-BR")`. [apps/desktop/src/routes/reports.tsx] *blind-hunter*.
- [x] **low → Defer** — `docs/architecture.md` (§3.4/3.5/4.4) ainda chama este trabalho de "Epic B", nunca atualizado pra "Epic 2" na renumeração original. Registrado em `deferred-work.md`. [docs/architecture.md] *blind-hunter*.

**Rejeitados (Rodada 2):**
- `docs/architecture.md` desatualizado — achado de doc real, mas roteado como `defer` (tabela acima), não rejeitado — listado aqui só pra registro de que foi triado, não ignorado.
- `status: 'done'` da spec vs `sprint-status.yaml: review` dentro do MESMO commit (diferente de rodadas anteriores, que tinham commits separados) — **[false]** é a mesma convenção de duas camadas já usada em TODA implementação desta epic (2.1, 2.2): o `bmad-build` já deixa spec em `done` + sprint-status em `review` no commit de implementação; só o `bmad-code-review` SEPARADO (esta rodada) avança sprint-status pra `done`. Não é uma inconsistência nova, é o padrão de sempre.
- `handleSubmit` checa as 3 respostas sequencialmente e só mostra a PRIMEIRA falha se mais de uma rejeitar — **[rejeitado, pré-existente]** já existia com 2 chamadas desde a Story 2.2, mais provável de acontecer agora com 3 mas não introduzido por esta story; probabilidade real de duas chamadas falharem simultaneamente contra o mesmo sidecar saudável é baixa.
- Tela `/reports` inteira trava em "loading" até as 3 chamadas resolverem — sem renderização progressiva por seção — **[rejeitado]** baixa severidade na escala real do produto (catálogo pequeno, poucos operadores); corrigir exigiria um refactor de estado por seção desproporcional ao problema demonstrado.
- Cenário 7 inserido fisicamente entre o Cenário 6 e o Cenário 3 no arquivo (ordem física 6, 7, 3) — **[false]** padrão deliberado e pré-existente desde o Cenário 4: o Cenário 3 (queda de terminal) sempre roda por ÚLTIMO por motivo estrutural (derruba o terminal A), não por numeração sequencial de posição — mesmo padrão já usado por todo cenário novo desde a Story 1.2.
- Tabelas `ByProductBlock`/`ByOperatorBlock` sem `<caption>`/`aria-label` ligando à `<h2>` anterior — **[rejeitado]** lacuna de acessibilidade compartilhada com a tabela da Story 2.2 (não introduzida agora); corrigir só a tabela nova criaria inconsistência com a existente — candidato a uma rodada de acessibilidade que cubra as duas de uma vez, fora do escopo desta story.
- `key={row.name}` no `.map` assume unicidade de nome sem garantia em nível de tipo — **[rejeitado]** `computeProductRanking` agrupa num `Map` (chaves unicamente garantidas por construção) — não há caminho de código alcançável hoje que produza nomes duplicados; preocupação hipotética sobre uma mudança futura, não um defeito atual.

## Design Notes

**Por que agrupar por `name`, não por um id de produto:** `item_added` nunca carregou `productId` — só uma cópia própria de `name`/`unitPriceCents` no momento da venda (decisão original: histórico de vendas nunca muda retroativamente se o produto for renomeado ou removido depois). Um retrofit pra adicionar `productId` violaria a AC literal desta story ("não adiciona nenhum evento novo ao modelo de dados"). Consequência aceita: renomear um produto no meio de um período consultado divide o ranking em duas entradas (nome antigo + nome novo) — comportamento correto dado o dado disponível, não um bug a corrigir aqui. Mesma consequência se estende a maiúsculas/espaços (achado no code review, 2026-09-29, blind-hunter): `"Cerveja"` e `"cerveja "` contam como produtos DIFERENTES — agrupamento é por string exata, sem normalização. Normalizar exigiria decidir uma regra (case-insensitive? trim? e quanto a acentos?) não especificada em nenhuma AC — mesma família de limitação aceita do nome copiado, não corrigida aqui.

**Por que não implementar cortes A/B/C:** a AC pede só "ranking por quantidade vendida e por valor" — os percentuais de corte de uma classificação ABC de verdade (ex: produtos que somam 80% da receita = "A") não são especificados em nenhum lugar do PRD/épico. Implementar cortes arbitrários seria inventar um requisito não pedido. O ranking ordenado por valor já dá ao dono o que precisa pra fazer essa leitura visualmente; classificação automática fica pra uma story futura se o dono pedir.

**Por que a janela usa `closing.closedAt` da order, não um timestamp do item:** `ItemState` não tem campo de "quando foi adicionado" (só `canceledAt`, retrofit da Story 2.2, exclusivo de item cancelado). O único proxy disponível pra "vendido dentro do intervalo" é o fechamento da comanda — mesmo princípio já usado por `computeCashRegisterSummaryForRange` (Story 2.1) pra sinalizar quando uma venda "aconteceu".

## Verification

**Commands:**
- `npm test -w packages/sync-engine` -- expected: suíte completa passa, incluindo os testes novos de `computeProductRanking`
- `npx tsc --noEmit` nos workspaces afetados -- expected: sem erros (`shared-types`, `sync-engine`, `apps/desktop/sidecar`, `apps/desktop`)
- `npm run build -w apps/desktop` -- expected: build de produção limpo (rebuildar `shared-types` E `sync-engine` antes do bundle do sidecar)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- expected: matriz desta story coberta no nível de rota HTTP real

**Resultados:**
- `npm test -w packages/sync-engine` -- PASSOU (85 testes antes dos patches do code review, 12 arquivos; +6 novos de `computeProductRanking`).
- `npx tsc --noEmit` -- limpo em `shared-types`, `sync-engine`, `apps/desktop/sidecar`, `apps/desktop`.
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- "TODOS OS CENÁRIOS PASSARAM", incluindo o novo CENÁRIO 7 (relatório por produto): validações de `from`/`to`, bloqueio de waiter/cashier, item cancelado excluído, comanda ainda aberta excluída, agregação entre comandas, ordenação por valor (não por quantidade).
- Re-verificação pós-`bmad-build` step 4 (patches aplicados — teste de desempate, teste de `item_quantity_incremented`, nota de Design Notes): `npm test -w packages/sync-engine` (**87 testes**, +2 novos), `npx tsc --noEmit` limpo, rebuild completo e `concurrency-scenario.mjs` -- todos PASSARAM ("TODOS OS CENÁRIOS PASSARAM.").
- Re-verificação pós-`bmad-code-review` (Rodada 2, commit `d4b3b55`, patches aplicados — teste de preços diferentes pro mesmo produto, formatação de `quantitySold`): `npm test -w packages/sync-engine` (**88 testes**, +1 novo), `npx tsc --noEmit` limpo, rebuild completo e `concurrency-scenario.mjs` -- todos PASSARAM ("TODOS OS CENÁRIOS PASSARAM.").
