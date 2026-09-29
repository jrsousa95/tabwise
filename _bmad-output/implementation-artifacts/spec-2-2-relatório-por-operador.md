---
title: 'Relatório por operador (Epic 2 / Story 2.2)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e104f5505cee8fd04e8c7c56079b778b1ce3ff8e'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O dono não tem visibilidade de desempenho por pessoa — quanto cada operador vendeu, nem quantos itens cada um cancelou (perda) — pra isso hoje precisaria vasculhar o histórico manualmente.

**Approach:** Retrofit aditivo em `ClosingState` (`operatorId`, já carregado pelo evento `order_closed` desde sempre) e em `ItemState` (`canceledByOperatorId`/`canceledAt`, já carregados por `item_canceled`, nunca expostos na projeção). Nova rota owner-only que, pro mesmo intervalo de datas da Story 2.1, agrupa vendas (via `computeCashRegisterSummaryForRange` pré-filtrada por operador) e cancelamentos de item por operador. Nova seção na MESMA tela `/reports` (reaproveita o seletor de datas já existente).

## Boundaries & Constraints

**Always:**
- `ClosingState` ganha `operatorId: string` (de `event.operatorId` em `case "order_closed"`, `reconciliation.ts`) — retrofit aditivo, comandas fechadas ANTES desta mudança de código ficam com esse campo ausente na leitura retroativa (aceitável, documentado no AC).
- `ItemState` ganha `canceledByOperatorId?: string` e `canceledAt?: number` (de `event.operatorId`/`event.createdAt` em `case "item_canceled"`) — mesmo racional aditivo. Sem os dois, não tem como filtrar cancelamento por intervalo de datas nem atribuir a um operador.
- Agrupamento de VENDAS por operador acontece FORA de `computeCashRegisterSummaryForRange`: quem chama pré-filtra `orders` por `closing.operatorId === X` antes de passar pro helper (ARCH/AC literal) — a função em si não sabe o que é "operador".
- Agrupamento de CANCELAMENTOS por operador é lógica NOVA (não cabe em `computeCashRegisterSummaryForRange`, que opera por order, não por item) — nova função em `reporting.ts`, janela pelo `canceledAt` do item (não pelo `closing.closedAt` da order, que pode nem existir ainda se a order seguir aberta).
- Bounds inclusivos nas duas pontas, mesma regra de `localDateKey`/comparação lexicográfica já usada na Story 2.1.
- Mesma tela `/reports` (Story 2.1) ganha uma seção nova "Por operador", disparada pelo MESMO botão "Ver relatório" (mesmo `fromDate`/`toDate` já selecionado) — sem tela nova, sem item de nav novo, sem repetir o seletor de datas.
- Rota nova (`GET /reports/cash-register/by-operator?from=&to=`) no MESMO arquivo `apps/desktop/sidecar/src/routes/reports.ts` (não em `state.ts`) — reaproveita a validação de data já existente (extrair um helper compartilhado de `isValidCalendarDateKey`/`DATE_KEY_PATTERN`/parse de `from`/`to`, hoje só usado pela rota da Story 2.1).
- Acesso: owner-only, mesmo bloqueio inline `acting.role !== "owner"` já usado na Story 2.1.
- Corpo/query lido e validado ANTES de qualquer cálculo.
- Dinheiro sempre em centavos inteiros (NFR7).

**Never:**
- Não alterar a assinatura nem o comportamento de `computeCashRegisterSummaryForRange`/`computeCashRegisterSummary` existentes.
- Não implementar as stories 2.3/2.4 nem o Epic 3 nesta rodada.
- Não adicionar filtro por operador como parâmetro do helper compartilhado — o filtro é responsabilidade de quem chama.
- Não criar rota/tela/nav item novo — estende a rota/tela já existentes da Story 2.1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Relatório por operador de um intervalo válido | `from=2026-09-01&to=2026-09-07`, dono logado, 2+ operadores com atividade no período | 200 com array de `{operatorId, operatorName, totalSoldCents, closedOrdersCount, itemsCanceledCount}`, um item por operador conhecido | N/A |
| Venda atribuída ao operador certo | Order fechada por operador A, com pagamento em dinheiro | `totalSoldCents` de A inclui essa venda; nenhum outro operador a conta | N/A |
| Cancelamento atribuído ao operador certo | Item cancelado por operador B (diferente de quem fechou a order, ou a order nem fechou ainda) | `itemsCanceledCount` de B inclui esse cancelamento, baseado em `canceledAt` dentro do intervalo — independe de quem fechou a order ou se ela já fechou | N/A |
| Cancelamento fora da janela | Item cancelado antes de `from` ou depois de `to` | Não conta pro `itemsCanceledCount` de ninguém nessa consulta | N/A |
| Comanda cancelada antes deste retrofit existir | `item_canceled` gravado antes da mudança de código (sem `canceledByOperatorId`/`canceledAt` na projeção antiga) | Reprocessado do zero (event replay), passa a ter os campos — sem dado órfão | N/A |
| Intervalo inválido (mesmas regras da Story 2.1) | `from > to`, formato errado, ou calendário-inválido (`2026-02-30`) | Rejeitado antes de calcular qualquer coisa | 400 "intervalo de datas inválido" |
| Papel waiter ou cashier | Operador logado não é owner | Acesso negado | 403 "acesso restrito ao dono" |

</frozen-after-approval>

## Code Map

- `packages/sync-engine/src/reconciliation.ts` -- `ClosingState` ganha `operatorId: string`; `case "order_closed"` passa a gravar `canonical.closing = { ...event.payload, closedAt: event.createdAt, operatorId: event.operatorId }`. `ItemState` ganha `canceledByOperatorId?: string`/`canceledAt?: number`; `case "item_canceled"` grava os dois a partir de `event.operatorId`/`event.createdAt`
- `packages/sync-engine/src/reporting.ts` -- nova `countCanceledItemsByOperator(orders: readonly OrderState[], fromDateKey: string, toDateKey: string): Map<string, number>` (ou forma equivalente) -- percorre TODOS os itens de TODAS as orders (`mergedInto === undefined`, independente de a order estar aberta ou fechada), filtra `item.canceled && item.canceledByOperatorId && localDateKey(item.canceledAt)` dentro de `[fromDateKey, toDateKey]`, agrupa por `canceledByOperatorId`
- `apps/desktop/sidecar/src/routes/reports.ts` -- extrair `parseDateRange(url): {from, to} | null` (ou lançar erro) reaproveitando `DATE_KEY_PATTERN`/`isValidCalendarDateKey`/checagem `from > to`, usado pelas DUAS rotas agora. Nova rota `GET /reports/cash-register/by-operator?from=&to=`: pra cada `operator` em `ctx.currentState().operators`, filtra `orders` por `closing?.operatorId === operator.id` e chama `computeCashRegisterSummaryForRange` pra pegar `totalSoldCents`/`closedOrdersCount`; combina com `countCanceledItemsByOperator(state.orders, from, to).get(operator.id) ?? 0`; devolve array ordenado por `totalSoldCents` desc
- `apps/desktop/src/lib/reports.ts` -- `getCashRegisterSummaryByOperator(from, to)`, mesmo padrão `getJson` já usado nesta lib
- `apps/desktop/src/routes/reports.tsx` -- `Reports()`: `handleSubmit` passa a disparar as DUAS chamadas (período + por-operador) em paralelo; nova seção "Por operador" (tabela: nome, total vendido, comandas fechadas, itens cancelados), renderizada junto do resultado já existente
- `packages/sync-engine/test/reporting.test.ts` -- testes novos pra `countCanceledItemsByOperator`: janela por `canceledAt` (não por `closedAt` da order), cancelamento numa order ainda aberta conta, cancelamento fora da janela não conta
- `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- estender com a matriz desta story no nível de rota HTTP real

## Tasks & Acceptance

**Execution:**
- [x] `packages/sync-engine/src/reconciliation.ts` -- retrofit `ClosingState.operatorId` + `ItemState.canceledByOperatorId`/`canceledAt` -- expõe dado que os eventos já carregam
- [x] `packages/sync-engine/src/reporting.ts` -- `countCanceledItemsByOperator` -- agregação de cancelamentos por operador, janelada por `canceledAt`
- [x] `packages/sync-engine/test/reporting.test.ts` -- testes da nova função -- cobertura da matriz (cancelamento em order aberta, fora da janela)
- [x] `apps/desktop/sidecar/src/routes/reports.ts` -- extrair `parseDateRange` + rota `GET /reports/cash-register/by-operator` -- endpoint do relatório por operador
- [x] `apps/desktop/src/lib/reports.ts` -- `getCashRegisterSummaryByOperator` -- cliente HTTP
- [x] `apps/desktop/src/routes/reports.tsx` -- seção "Por operador" na mesma tela -- interface do usuário
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` -- novo Cenário 6 com a matriz desta story no nível de rota HTTP real

**Acceptance Criteria:**
- Given o evento `order_closed` já carrega `operatorId`, when esta story é implementada, then `ClosingState` passa a expor esse campo (retrofit aditivo, comandas fechadas antes ficam sem o dado retroativamente)
- Given um intervalo de datas (mesmo mecanismo da Story 2.1), when o dono abre o relatório por operador, then vê total vendido e total de itens cancelados agrupados por operador
- Given o filtro por operador, when aplicado, then acontece fora do helper compartilhado (pré-filtro por `closing.operatorId`); comandas ainda abertas não aparecem em nenhum agrupamento de vendas
- Given papel "waiter" ou "cashier", when tenta acessar, then acesso negado

## Implementation Notes

- `ClosingState.operatorId` e `ItemState.canceledByOperatorId`/`canceledAt` vêm de `event.operatorId`/`event.createdAt` -- campos do NÍVEL DO EVENTO (`baseEventSchema`, `packages/shared-types/src/common.ts`), não do `payload` -- já presentes em `order_closed`/`item_canceled` desde sempre. O retrofit é só na projeção (`reconciliation.ts`), sem tocar em `events.ts`/schemas.
- `ClosingState.operatorId` é tipado como obrigatório (`string`, não `string | undefined`): como `event.operatorId` é obrigatório em todo `DomainEvent`, todo `order_closed` reprocessado do zero (event replay) sempre popula o campo -- a "ausência retroativa" citada no Intent se refere ao estado em memória de ANTES desta mudança de código rodar, não a um dado permanentemente órfão depois do replay.
- `ItemState.canceledByOperatorId`/`canceledAt` são opcionais porque `ItemState` representa TODO item (cancelado ou não) -- só populados quando `canceled === true`, ao contrário de `ClosingState` (que só existe, via `OrderState.closing?`, quando a order já fechou).
- `countCanceledItemsByOperator` (`reporting.ts`) itera `orders` filtrando `mergedInto === undefined` (mesma regra de todo o resto do arquivo) e depois cada `item` com `canceled && canceledByOperatorId && canceledAt !== undefined`, janelando por `localDateKey(item.canceledAt)` com os mesmos bounds inclusivos/comparação lexicográfica de `computeCashRegisterSummaryForRange`. Item cancelado numa order ainda ABERTA conta normalmente (nunca olha `order.status`/`order.closing`).
- `apps/desktop/sidecar/src/routes/reports.ts`: `parseDateRange(url)` extraído da validação que já existia inline na rota da Story 2.1 (presença, formato, `from <= to`, calendário válido) -- devolve `{ok:true,from,to} | {ok:false,error}`, reaproveitado pelas duas rotas do arquivo. A rota nova filtra `orders` por `closing?.operatorId === operator.id` (nunca um parâmetro do helper compartilhado) antes de chamar `computeCashRegisterSummaryForRange`; como esse filtro depende de `closing` existir, comandas abertas E orders perdedoras de merge (que nunca recebem `closing` -- ver ARCH §4.2, o campo só é setado na order canônica) já ficam naturalmente de fora, sem checagem extra de `mergedInto`. Devolve TODOS os operadores conhecidos (`ctx.currentState().operators`), mesmo sem nenhuma atividade no período, ordenados por `totalSoldCents` desc.
- Frontend: `handleSubmit` (`reports.tsx`) dispara as duas chamadas (`getCashRegisterSummaryRange` + `getCashRegisterSummaryByOperator`) em paralelo via `Promise.all`, mesmo botão "Ver relatório"/mesmo `fromDate`/`toDate` já existente da Story 2.1. `ByOperatorBlock` reaproveita a classe `.catalog-table` já existente (usada em `catalog.tsx`) em vez de `.catalog-list` (estilizada como lista, não tabela) -- sem CSS novo.
- `concurrency-scenario.mjs`: novo "CENÁRIO 6", entre o Cenário 5 (relatório por período) e o Cenário 3 (queda de terminal, que precisa continuar sendo o último). Cobre a matriz completa: parâmetros ausentes/invertidos (mesmo `parseDateRange` da Story 2.1), bloqueio de waiter E cashier, venda atribuída a quem FECHA a comanda (Ana, dono) vs. cancelamento atribuído a quem CANCELA o item (Carla, caixa, operador diferente), operador sem nenhuma atividade (Wagner) aparecendo zerado em vez de ausente, ordenação por `totalSoldCents` desc, e cancelamento de hoje não vazando pra uma consulta de um intervalo no passado.
- Testes unitários novos em `reporting.test.ts` (`describe("countCanceledItemsByOperator...")`) cobrem: janela por `canceledAt` com order ainda aberta, atribuição ao operador que cancelou (não a quem fechou), cancelamento fora da janela, bounds inclusivos nas duas pontas, item nunca cancelado não gera entrada, e order perdedora de merge (ARCH §4.2) nunca conta duas vezes (o item cancelado só existe na canônica, via `resolveCanonical`). Testes existentes que faziam `toEqual` no objeto `closing` inteiro (`other-events.test.ts`) foram atualizados pro novo campo `operatorId`; `items.test.ts` ganhou asserções pros novos `canceledByOperatorId`/`canceledAt`.

## Spec Change Log

## Review Triage Log

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] **medium → Patch** — `closedOrdersCount` nunca era verificado no caso POPULADO (só no zerado, `wagnerRow`); `anaRow.totalSoldCents` usava `>=` frouxo em vez de valor exato. Uma regressão que zerasse/trocasse `closedOrdersCount` pra Ana/Carla, ou inflasse `totalSoldCents`, passaria despercebida. Corrigido em `concurrency-scenario.mjs`: asserções exatas, comparadas por DELTA contra um "antes de fechar" capturado antes (robusto a outras comandas de Ana já fechadas hoje em cenários anteriores, como o Cenário 5). [apps/desktop/sidecar/test/concurrency-scenario.mjs] *blind-hunter + verification-gap, achado duplicado*.
- [x] **low → Patch** — a AC congelada ("comandas ainda abertas não aparecem em nenhum agrupamento de vendas") nunca tinha um teste no estado INTERMEDIÁRIO (item já cancelado, comanda ainda aberta) — só o caso já fechado. Adicionada consulta ao relatório nesse ponto exato, confirmando que o cancelamento já conta (propriedade do item) mas a venda ainda não (comanda sem `closing`). [apps/desktop/sidecar/test/concurrency-scenario.mjs] *blind-hunter*.
- [x] **low → Patch** — doc comment de `parseDateRange` atribuía a regra "ler/validar antes de calcular" à NFR7, que na verdade é sobre dinheiro em centavos (achado real, `epics.md` confirma). Corrigido. [apps/desktop/sidecar/src/routes/reports.ts] *blind-hunter*.
- [x] **low → Patch** — `summary.pendingOrders` dentro do loop por-operador SEMPRE vem `[]` (todo item de `ordersClosedByOperator` já tem `closing`, nenhum é `status: "open"`) — não é bug (o campo nunca é lido), mas era uma armadilha silenciosa pra quem reaproveitasse esse `summary` no futuro esperando o contrato documentado da função. Comentário adicionado. [apps/desktop/sidecar/src/routes/reports.ts] *blind-hunter*.
- [x] **low → Patch** — `countCanceledItemsByOperator` devolve `Map<string, number>`, que `JSON.stringify`/`sendJson` NUNCA serializam como esperado (vira `{}`) — hoje só é lido via `.get()`, mas nada documentava esse risco pra um caller futuro. Comentário adicionado. [packages/sync-engine/src/reporting.ts] *blind-hunter*.
- [x] **low → Defer** — `Reports.tsx`'s `handleSubmit` (`Promise.all` das duas chamadas) sem `try/catch` — mesma causa raiz já adiada repetidamente desde as Stories 1.1-2.1 (`getJson`/`postJson` não capturam rejeição do `fetch()`). [apps/desktop/src/routes/reports.tsx] *edge-case-hunter*.

**Rejeitados:**
- Design O(operadores × orders) na rota por-operador (um `.filter()`+`computeCashRegisterSummaryForRange` por operador, em vez de um único passe acumulando tudo como `countCanceledItemsByOperator` já faz) — **[low, rejeitado]** nitpick de estilo/performance sem dano demonstrado na escala real do produto (poucos operadores, histórico de um único estabelecimento); mesmo padrão de rejeição já aplicado a achados equivalentes na Story 2.1.
- `!item.canceledByOperatorId` (truthy) vs `item.canceledAt === undefined` (estrito) — estilo de guarda inconsistente dentro da mesma função — **[false]** `operatorId` em todo `DomainEvent` é `z.string().min(1)` (nunca vazio) — confirmado pelo `edge-case-hunter` — então os dois guards são comportamentalmente idênticos pra todo input alcançável hoje; não há caminho de código onde divergem.
- `ByOperatorBlock` não mostra o papel (owner/caixa/garçom) de cada operador na tabela — **[rejeitado]** o próprio achado reconhece que isso não é exigido pela spec congelada; melhoria de UX discricionária, não um defeito.

## Design Notes

**Por que `canceledAt` além de `canceledByOperatorId`:** sem um timestamp próprio no item, a única forma de janelar um cancelamento por data seria usar `closing.closedAt` da order — mas uma order pode ter um item cancelado e continuar ABERTA (cancelamento não fecha a order), ou fechar bem depois do cancelamento em si. Usar `closing.closedAt` sub-representaria cancelamentos de orders ainda abertas e atribuiria a data errada pras já fechadas. `canceledAt` (= `event.createdAt` do `item_canceled`) é o único timestamp correto pra essa métrica, mesmo princípio de `recordedAt` em `CashMovementRecord` (Épico 1).

**Por que uma função nova em vez de estender `computeCashRegisterSummaryForRange`:** essa função opera sobre ORDERS fechadas (nível de order); cancelamento é uma propriedade de ITEM que pode existir numa order aberta ou fechada. Forçar isso dentro do helper existente quebraria a separação já estabelecida (ARCH §3.5: o helper "não sabe o que é operador", muito menos "o que é item cancelado").

**Operadores sem nenhuma atividade no período:** a rota lista TODOS os operadores conhecidos (`ctx.currentState().operators`), não só os que venderam/cancelaram algo — um operador sem atividade aparece com zeros. Mais simples que filtrar, e útil pro dono ver quem não teve movimento nenhum no período (estabelecimento pequeno, poucos operadores).

## Verification

**Commands:**
- `npm test -w packages/sync-engine` -- expected: suíte completa passa, incluindo os testes novos de `countCanceledItemsByOperator`
- `npx tsc --noEmit` nos workspaces afetados -- expected: sem erros (`shared-types`, `sync-engine`, `apps/desktop/sidecar`, `apps/desktop`)
- `npm run build -w apps/desktop` -- expected: build de produção limpo (rebuildar `shared-types` E `sync-engine` antes do bundle do sidecar)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- expected: matriz desta story coberta no nível de rota HTTP real

**Resultados:**
- `npm test -w packages/sync-engine` -- PASSOU (79 testes, 12 arquivos; eram 73 antes desta story, +6 novos de `countCanceledItemsByOperator`).
- `npx tsc --noEmit` -- limpo em `packages/shared-types`, `packages/sync-engine`, `apps/desktop/sidecar` e `apps/desktop`.
- `npm run build -w apps/desktop` -- build de produção limpo (tsc + vite build do frontend; typecheck + esbuild bundle + geração do binário SEA do sidecar).
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` -- "TODOS OS CENÁRIOS PASSARAM", incluindo o novo CENÁRIO 6 (relatório por operador): validações de `from`/`to` ausente/invertido, bloqueio de waiter e cashier, venda atribuída a quem fechou vs. cancelamento atribuído a quem cancelou (operadores diferentes), operador sem atividade (Wagner) zerado, ordenação por `totalSoldCents` desc, e cancelamento de hoje não vazando pra uma consulta de 2020.
- Re-verificação pós-`bmad-build` step 4 (patches aplicados, ver Review Triage Log): `npm test -w packages/sync-engine` (79 testes), `npx tsc --noEmit` limpo, rebuild completo e `concurrency-scenario.mjs` -- todos PASSARAM, incluindo os patches: consulta no estado INTERMEDIÁRIO (comanda cancelada mas ainda aberta — cancelamento já conta, venda ainda não) e asserções exatas de `closedOrdersCount`/`totalSoldCents` por DELTA (robustas a outras comandas de Ana já fechadas hoje em cenários anteriores, como o Cenário 5).
