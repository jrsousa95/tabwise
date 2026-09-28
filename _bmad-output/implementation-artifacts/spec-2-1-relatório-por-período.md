---
title: 'Relatório por período (Epic 2 / Story 2.1)'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a88942d5c32b588d98d165199e6688b36618b53c'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O dono só enxerga o resumo do dia atual (Resumo de Caixa, Épico 6) — sem visão de semana/mês nem comparação com o período anterior, tendência de negócio exige somar dia a dia manualmente.

**Approach:** Nova função `computeCashRegisterSummaryForRange` (sync-engine, ARCH §3.5), nova rota owner-only no sidecar, e uma tela nova (`/reports`) com seletor de intervalo de datas que mostra o resumo do período escolhido lado a lado com o período equivalente imediatamente anterior (mesma duração, sem semântica de calendário).

## Boundaries & Constraints

**Always:**
- `computeCashRegisterSummaryForRange(orders, fromDateKey, toDateKey)` nova em `reporting.ts`, bounds INCLUSIVOS (`fromDateKey <= localDateKey(...) <= toDateKey`, comparação lexicográfica de string). Extrai um helper interno compartilhado com `computeCashRegisterSummary` — NÃO altera a assinatura da função existente (dois call sites hoje: sidecar M8, backend M11).
- `pendingOrders` sempre = comandas abertas AGORA, sem filtro de intervalo (mesma semântica já usada no relatório de dia único).
- "Período anterior" pro comparativo = MESMA duração em dias do intervalo escolhido, deslocada imediatamente pra trás (ex: intervalo de 7 dias → os 7 dias anteriores). Regra única, sem semântica de calendário (mês civil) — generaliza pra qualquer intervalo, não só semana/mês.
- Rota nova em arquivo PRÓPRIO, `apps/desktop/sidecar/src/routes/reports.ts` — não estender `state.ts` (suas rotas irmãs hoje não têm NENHUM controle de papel/sessão, resquício pré-Epic-1; não é o padrão a seguir numa rota nova). Bloqueio explícito de "waiter"/"cashier" no nível de API, não só no frontend.
- Tela nova em `/reports`, owner-only via `RequireRole` (mesmo padrão de `/catalog`/`/settings`/`/table-conflicts`), com item de nav novo em `layout.tsx`.
- Dinheiro sempre em centavos inteiros (NFR7).
- Corpo/query lido e validado ANTES de qualquer retorno antecipado de invariante de negócio.

**Never:**
- Não alterar a assinatura nem o comportamento de `computeCashRegisterSummary` existente.
- Não implementar as stories 2.2/2.3/2.4 nesta rodada (filtro por operador, ranking de produto, exportação CSV).
- Não adicionar filtro por operador ao helper compartilhado — isso é da Story 2.2, fora do helper.
- Não usar semântica de calendário (mês civil, semana ISO) pro cálculo do período anterior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Relatório de um intervalo válido | `from=2026-09-01&to=2026-09-07`, dono logado | 200 com resumo agregado do intervalo + resumo do período anterior (2026-08-25..2026-08-31, mesma duração) | N/A |
| Bounds inclusivos | order fechada exatamente em `from` ou em `to` | Conta no resumo (nenhuma ponta é exclusiva) | N/A |
| `pendingOrders` não filtra | comanda aberta fora do intervalo pedido | Aparece em `pendingOrders` mesmo assim (retrato do agora) | N/A |
| Intervalo invertido ou mal formatado | `from > to`, ou data fora do formato `YYYY-MM-DD` | Rejeitado antes de calcular qualquer coisa | 400 "intervalo de datas inválido" |
| Sem parâmetros | `GET` sem `from`/`to` | Rejeitado — não assume um intervalo default | 400 "intervalo de datas obrigatório" |
| Papel waiter ou cashier | operador logado não é owner | Acesso negado | 403 "acesso restrito ao dono" |

</frozen-after-approval>

## Code Map

- `packages/sync-engine/src/reporting.ts` -- extrair helper interno compartilhado (agregação sobre uma lista já filtrada de `closedOrders`) de `computeCashRegisterSummary`; nova `computeCashRegisterSummaryForRange(orders, fromDateKey, toDateKey): CashRegisterSummary` reaproveitando o mesmo helper
- `packages/sync-engine/test/reporting.test.ts` -- testes novos: bounds inclusivos nas duas pontas, `pendingOrders` não filtrado, cálculo do período anterior (duração igual, deslocado pra trás)
- `apps/desktop/sidecar/src/routes/reports.ts` -- NOVO arquivo. `handleReportRoutes(req, res, url, ctx)`; `GET /reports/cash-register/range?from=&to=` (nome evita colidir com `/cash-register/summary` já existente, `state.ts`); `requireSession` + bloqueio inline de `waiter`/`cashier` (só `owner` passa); parseia/valida `from`/`to` ANTES de qualquer cálculo; computa range atual + range anterior (mesma duração) via `computeCashRegisterSummaryForRange`; devolve os dois num único payload (evita uma segunda viagem de rede)
- `apps/desktop/sidecar/src/index.ts` -- registrar `handleReportRoutes` no dispatcher, mesmo padrão de `handleCashSessionRoutes`
- `apps/desktop/src/lib/reports.ts` -- NOVO arquivo. `getCashRegisterSummaryRange(from, to)`, mesmo padrão `getJson` de `apps/desktop/src/lib/cash-sessions.ts`
- `apps/desktop/src/routes/reports.tsx` -- NOVO arquivo. Dois `<input type="date">` (from/to, primeiro precedente de date-picker no app — usar input nativo, sem lib nova), botão "Ver relatório", mostra resumo do período + comparativo com período anterior (reaproveita `formatCentsToBRL` de `money.ts`). Também usa `useTablesAndOrders` (`lib/tables.ts`) só pra resolver o identificador da mesa na lista de `pendingOrders` (mesmo `orderLabel` de `cash-register.tsx`) — achado no code review, 2026-09-28 (blind-hunter): essa dependência não estava documentada aqui.
- `apps/desktop/src/app.tsx` -- nova rota `/reports` dentro do grupo `RequireRole allowed={["owner"]}` já existente (linha 29-33), ao lado de `/catalog`/`/settings`/`/table-conflicts`
- `apps/desktop/src/layout.tsx` -- novo `NavLink` "/reports" (`operator?.role === "owner"`), mesmo padrão dos outros itens condicionais (linhas 136-155)

## Tasks & Acceptance

**Execution:**
- [x] `packages/sync-engine/src/reporting.ts` -- extrair helper + `computeCashRegisterSummaryForRange` -- cálculo do período, reaproveitável
- [x] `packages/sync-engine/test/reporting.test.ts` -- testes de bounds/pendingOrders/período anterior -- cobertura da matriz
- [x] `apps/desktop/sidecar/src/routes/reports.ts` -- rota `GET` nova, owner-only -- endpoint do relatório
- [x] `apps/desktop/sidecar/src/index.ts` -- registrar a rota no dispatcher -- fiação
- [x] `apps/desktop/src/lib/reports.ts` -- cliente HTTP -- consumo da rota
- [x] `apps/desktop/src/routes/reports.tsx` -- tela nova -- interface do usuário
- [x] `apps/desktop/src/app.tsx` + `layout.tsx` -- rota + nav item owner-only -- navegação
- [x] `apps/desktop/sidecar/test/concurrency-scenario.mjs` (ou smoke script equivalente) -- teste no nível de rota HTTP real -- matriz I/O coberta fora do nível de projeção

**Acceptance Criteria:**
- Given um intervalo de datas selecionado, when o dono abre o relatório, then o sistema mostra o resumo agregado desse intervalo via `computeCashRegisterSummaryForRange`
- Given o relatório de um período, when exibido, then mostra ao menos um comparativo direto com o período equivalente anterior
- Given `pendingOrders`, when exibidas, then mostram todas as comandas abertas agora, sem filtrar pelo intervalo pedido
- Given papel "waiter" ou "cashier", when tenta acessar (rota ou tela), then acesso negado

## Implementation Notes

- `computeCashRegisterSummaryForRange` extrai `aggregateClosedOrders` (soma sobre uma lista já filtrada) e `pendingOrdersSnapshot` (retrato de agora) como helpers internos privados de `reporting.ts`, reaproveitados tanto pela função de dia único existente quanto pela nova de intervalo. `computeCashRegisterSummary` teve seu corpo reescrito em cima dos mesmos helpers, mas a assinatura e o comportamento observável não mudaram (coberto por um teste de equivalência dedicado em `reporting.test.ts`, comparando `computeCashRegisterSummary` com `computeCashRegisterSummaryForRange` chamada com `from === to`).
- `CashRegisterSummary.date` pro relatório de intervalo é preenchido como `"${fromDateKey}..${toDateKey}"` (o campo é reaproveitado do tipo existente; o frontend já conhece o intervalo pedido, então não depende desse valor pra nada).
- O cálculo do "período anterior" (mesma duração em dias, deslocado imediatamente pra trás) vive em `apps/desktop/sidecar/src/routes/reports.ts` (não em `reporting.ts`) — a rota faz aritmética de data (`Date.UTC` sobre as chaves `YYYY-MM-DD`) pra derivar `previousFrom`/`previousTo` e chama `computeCashRegisterSummaryForRange` de novo com esse intervalo. `reporting.test.ts` cobre essa regra chamando a função genérica duas vezes com intervalos adjacentes de mesma duração e verificando que não vaza comanda de um período pro outro na fronteira.
- Bloqueio de papel na rota usa `ctx.requireSession` + checagem inline `acting.role !== "owner"` (não `ctx.requireOwner`, que já existe em `context.ts` mas devolve a mensagem "só o dono pode fazer isso" — a matriz de I/O desta spec pede a mensagem literal "acesso restrito ao dono"). Isso bloqueia "waiter" e "cashier" igualmente, diferente do padrão de `/cash-register` (que permite cashier).
- Tela `/reports`: dois `<input type="date">` nativos, sem lib nova. Mostra um bloco de comparativo (delta de `totalSoldCents` em R$ e %), depois o resumo do período escolhido, depois o do período anterior, depois `pendingOrders` (mostrado uma única vez, já que `current.pendingOrders` e `previous.pendingOrders` são idênticos — mesmo cálculo, mesmo instante).
- Smoke test HTTP real: novo "CENÁRIO 5" em `concurrency-scenario.mjs`, entre o Cenário 4 (sessão de caixa) e o Cenário 3 (queda de terminal, que precisa continuar sendo o último). Cobre toda a matriz I/O da spec: sem parâmetros, intervalo invertido, formato inválido, bloqueio de waiter E cashier (a suíte anterior só tinha um garçom cadastrado — foi adicionada uma operadora "Carla" com papel cashier), bounds inclusivos (fecha uma comanda real hoje e consulta o relatório de hoje) e `pendingOrders` não filtrado (comanda de mesa ainda aberta aparece mesmo consultando 2020 ou o próprio dia de hoje).

## Spec Change Log

## Review Triage Log

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] **medium → Patch** — `DATE_KEY_PATTERN` (`reports.ts`) aceita datas com formato certo mas calendário inválido (`2026-02-30`, `2026-13-01`) e `dateKeyToUtcDayMs` (`Date.UTC`) rola silenciosamente pra outra data real em vez de rejeitar com 400. Corrigido com `isValidCalendarDateKey` (round-trip via `shiftDateKey(key, 0)`), verificado manualmente (`2026-02-30`/`2026-13-01`/`0050-01-01` → inválido; `2026-02-28` → válido). *blind-hunter + edge-case-hunter (achado duplicado)*.
- [x] **medium → Patch** — `dateKeyToUtcDayMs`/`shiftDateKey` usam `Date.UTC(year, ...)` na forma "componente" — pra `year` com poucos dígitos, o JS remapeia (`0-99` → `1900+year`), deslocando a data ~1900 anos sem erro. Mesma causa raiz do achado acima, corrigida pelo mesmo round-trip (`isValidCalendarDateKey`). *edge-case-hunter*.
- [x] **medium → Patch** (consequência do mesmo achado) — com uma data calendário-inválida, `durationDays` podia sair `<= 0`, produzindo um `previous` invertido/vazio devolvido como 200. Resolvido junto com a validação acima (datas calendário-inválidas agora nunca chegam no cálculo de `durationDays`). *edge-case-hunter*.
- [x] **medium → Patch** — a aritmética do "período anterior" nunca era verificada contra um valor esperado. Corrigido em `concurrency-scenario.mjs`: consulta independente do range `[3 dias atrás, 2 dias atrás]` esperado, comparada byte-a-byte (`totalByPaymentMethod`/`closedOrdersCount`) contra o `previous` devolvido pra `[ontem, hoje]`, mais uma asserção de que a venda de hoje não vaza pro `previous`. *verification-gap, achado pré-verificado*.
- [x] **low → Patch** — `shiftDateKey` formata `month`/`day` com `padStart(2, "0")` mas NÃO `year` — pra um ano com menos de 4 dígitos, a chave perdia a largura fixa de que a comparação lexicográfica depende. Corrigido (`String(year).padStart(4, "0")`), mesmo padrão de mês/dia. *edge-case-hunter*.
- [x] **low → Patch** — `todayDateKey` (`reports.tsx`) duplicava a lógica de `localDateKey` (`sync-engine`) sem comentário explicando por quê. Comentário adicionado, espelhando o já existente em `localDateKeyForTest`. *blind-hunter*.
- [x] **low → Patch** — `computeCashRegisterSummaryForRange` devolve `date: "${from}..${to}"`, formato nunca testado. Adicionada asserção (`expect(summary.date).toBe("2026-03-03..2026-03-04")`) em `reporting.test.ts`. *blind-hunter*.
- **low** — `SummaryBlock`/`orderLabel`/lista de comandas pendentes em `reports.tsx` duplicam quase byte-a-byte o bloco "Resumo do dia" e `orderLabel` já existentes em `cash-register.tsx`, sem abstração compartilhada. *blind-hunter + verification-gap (achado duplicado, "Other findings")*.
- **low** — `getJson` (`lib/reports.ts`) não captura a rejeição do `fetch()` em si (só `.json()` tem `.catch`) — mesma causa raiz já adiada desde as Stories 1.1-1.4 (`postJson`/`getJson` em todo o app têm essa mesma lacuna). *blind-hunter + edge-case-hunter (achado duplicado)*.
- **low** — o mesmo `getJson`, quando a resposta é 200 mas o corpo não é JSON válido, trata isso como `{ok: true, data: null}` em vez de erro — mesmo padrão já usado (e já aceito) em todo `getJson`/`postJson` existente no app, não uma lacuna nova desta story. *edge-case-hunter*.
- **false** — `computeCashRegisterSummaryForRange` não valida `fromDateKey > toDateKey` internamente, dependendo só da validação já feita na rota — checado: não existe hoje NENHUM caller que chame essa função sem passar pela validação da rota primeiro; mesmo padrão de camadas já usado em todo o resto do sync-engine (`computeExpectedCashSessionAmountCents` também confia no chamador). *edge-case-hunter*.
- **low, rejeitado** — nenhum limite superior no tamanho do intervalo `from`/`to` pedido — pouco provável de ser um problema real na escala do produto (uma única loja/estabelecimento, dataset local pequeno); corrigir exigiria uma decisão de produto nova (qual o teto?), não uma correção direta. *blind-hunter*.
- **low, rejeitado** — tela `/reports` não tem indicador de "dado pode estar desatualizado" pra um intervalo que inclui hoje — é um fluxo de "rodar um relatório" sob demanda (botão "Ver relatório"), não o dashboard sempre-ao-vivo de `cash-register.tsx`; ambos os padrões já coexistem no app, e mudar isso exigiria uma decisão de UX nova, não uma correção direta. *blind-hunter*.

#### Rodada 2 — `bmad-code-review` (commit `3235536`, 2026-09-28)

4 camadas (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Acceptance Auditor não achou violação real de AC/constraint (só sinalizou `status: done` da spec vs `sprint-status.yaml: review`, que é a convenção de duas camadas já estabelecida, não uma inconsistência). Cada achado abaixo verificado contra o código real antes do veredito.

- [x] **medium → Patch, achado real e sutil** — o guard `isValidCalendarDateKey` (Rodada 1) é aplicado só ao `from`/`to` informados pelo usuário, nunca aos `previousFrom`/`previousTo` derivados internamente. `previousFrom = shiftDateKey(previousTo, -(durationDays - 1))` reprocessava a STRING intermediária de `previousTo` de volta por `dateKeyToUtcDayMs` — pra um `from` com ano < 200 (ex: `from=to="0100-01-01"`), essa segunda parse podia cair de novo no quirk do `Date.UTC` (ano 0-99 → 1900+ano), produzindo `previousFrom="1999-12-31" > previousTo="0099-12-31"` — um intervalo invertido devolvido como 200 vazio em vez de erro. Reproduzido e confirmado via Node antes e depois do fix. Corrigido calculando os dois limites do período anterior direto do `from` já validado (`shiftDateKey(from, -durationDays)`), sem encadear um shift no resultado do outro. [apps/desktop/sidecar/src/routes/reports.ts] *edge-case-hunter*.
- [x] **medium → Patch** — o guard de calendário-inválido (`isValidCalendarDateKey`, Rodada 1) só tinha sido "confirmado manualmente via Node" (ver Verification) — nenhum teste automatizado cobria `2026-02-30`/`2026-13-01`. Adicionados dois casos em `concurrency-scenario.mjs` Cenário 5. [apps/desktop/sidecar/test/concurrency-scenario.mjs] *verification-gap*.
- [x] **low → Patch** — os dois `<input type="date">` não tinham nenhuma restrição cruzada — um intervalo invertido só era percebido depois do 400 do servidor. Adicionado `min={fromDate}` no campo "Até". [apps/desktop/src/routes/reports.tsx] *blind-hunter*.
- [x] **low → Patch** — `orderLabel` (comanda avulsa) não tinha o mesmo fallback `"?"` que o ramo de mesa já tem pra `number` ausente. Corrigido. [apps/desktop/src/routes/reports.tsx] *blind-hunter*.
- [x] **low → Patch** — `ComparisonBlock` podia mostrar "sem variação (0.0%)" — percentual redundante junto do rótulo. Suprimido quando `deltaCents === 0`. [apps/desktop/src/routes/reports.tsx] *blind-hunter*.
- [x] **low → Patch** — Code Map não documentava que `reports.tsx` também depende de `useTablesAndOrders` (só pra resolver identificador de mesa em `pendingOrders`). Adicionado ao Code Map. *blind-hunter*.
- [x] **low → Defer** — `getJson`/`postJson` sem tratamento de rejeição do `fetch()` e 200-com-corpo-inválido tratado como sucesso — mesma causa raiz já adiada na Rodada 1 e nas Stories 1.1-1.4, reconfirmada aqui pelas duas camadas de novo. *blind-hunter + edge-case-hunter, achado duplicado já em `deferred-work.md`*.

**Rejeitados (Rodada 2):**
- 403 hardcoded `"acesso restrito ao dono"` em vez de reaproveitar `ctx.requireOwner` (`"só o dono pode fazer isso"`) — **[rejeitado]** a spec congelada (Boundaries & Constraints / I/O Matrix) já especifica essa mensagem exata como decisão deliberada — mudar isso exigiria editar a seção congelada, fora do escopo deste code review.
- `pendingOrdersSnapshot(orders)` calculado duas vezes por requisição (uma pro `current`, outra pro `previous`, mesmo resultado) — **[low, rejeitado]** array de comandas abertas é pequeno na escala real do produto; a correção exigiria reestruturar a função compartilhada, não uma correção direta, pra um ganho de performance imperceptível hoje.
- `handleSubmit` sem `AbortController`/guarda de unmount — **[low, rejeitado]** mesma classe de risco já aceita em todo formulário assíncrono do app; corrigir direito exige gerenciamento de estado mais complexo, não uma correção direta.
- `aggregateClosedOrders` percorre a lista 4 vezes em vez de 1 passada acumulando tudo — **[rejeitado]** nitpick de estilo/performance sem dano demonstrado na escala real (histórico de pedidos de um único estabelecimento); refatorar é mudança de estilo, não correção de defeito.
- Zero testes de frontend pra `reports.tsx`/`lib/reports.ts` — **[rejeitado]** convenção pré-existente do projeto inteiro (zero testes de componente React em qualquer lugar do app), não uma lacuna introduzida por esta story.
- Sem cache/memoização, duas varreduras completas de `orders` por requisição, custo cresce com o histórico — **[rejeitado]** mesmo padrão arquitetural já usado em `computeCashRegisterSummary` desde o Épico 6 (nenhuma memoização em nenhum lugar do `reporting.ts`); não é uma regressão introduzida aqui.
- `status: 'done'` da spec vs `sprint-status.yaml: review` — **[false]** convenção de duas camadas já estabelecida (spec fecha em `done` no fim do `bmad-build`; `sprint-status.yaml` só avança pra `done` depois deste code-review separado aprovar), não uma inconsistência real.

## Design Notes

**Regra do "período anterior":** duração fixa em dias (inclusive, `to - from`), deslocada imediatamente pra trás de `from`. Evita a assimetria de meses (28 a 31 dias) e generaliza pra qualquer intervalo que o dono escolher — não só "semana" ou "mês" no sentido de calendário civil. Uma semana escolhida (7 dias) naturalmente compara contra os 7 dias anteriores, satisfazendo o exemplo da AC ("esta semana vs. semana passada") sem precisar de lógica de calendário.

**Rota em arquivo próprio:** `state.ts` hoje serve `/state` e `/cash-register/summary` sem nenhuma checagem de sessão/papel — um resquício de antes da convenção mais rigorosa estabelecida no Epic 1. Uma rota nova owner-only não deveria herdar esse padrão desprotegido nem forçar uma correção retroativa nas rotas existentes (fora do escopo desta story) — por isso vive em `reports.ts` próprio, com o bloqueio de papel already-established (inline, sem helper novo em `context.ts`).

**Formato do payload:** fica a critério da implementação devolver `{ current: CashRegisterSummary, previous: CashRegisterSummary }` ou uma forma equivalente — o requisito é um único `GET` trazendo os dois resumos já calculados, sem exigir uma segunda chamada do frontend.

## Verification

**Commands:**
- `npm test -w packages/sync-engine` -- expected: suíte completa passa, incluindo os testes novos de `computeCashRegisterSummaryForRange`
- `npx tsc --noEmit` nos workspaces afetados -- expected: sem erros (`shared-types`, `sync-engine`, `apps/desktop/sidecar`, `apps/desktop`)
- `npm run build -w apps/desktop` -- expected: build de produção limpo (rebuildar `shared-types` E `sync-engine` antes do bundle do sidecar — risco de processo já documentado nas Stories 1.2-1.4)
- `npm run build:bundle -w apps/desktop/sidecar && node apps/desktop/sidecar/test/concurrency-scenario.mjs` (estendido com a matriz desta story, ou um smoke script próprio) -- expected: todos os cenários da matriz cobertos no nível de rota HTTP real -- PASSOU (CENÁRIO 5 OK, incluindo os 6 casos da matriz)
- Re-verificação pós-`bmad-build` step 4 (patches aplicados, ver Review Triage Log): `npm test -w packages/sync-engine` (**73 testes**), `npx tsc --noEmit` limpo em `shared-types`/`sync-engine`/`apps/desktop/sidecar`/`apps/desktop`, rebuild completo (`shared-types` → `sync-engine` → bundle do sidecar) e `concurrency-scenario.mjs` -- todos PASSARAM ("TODOS OS CENÁRIOS PASSARAM."). Confirmado manualmente via Node que `isValidCalendarDateKey` rejeita `2026-02-30`/`2026-13-01`/`0050-01-01` e aceita `2026-02-28`.
- Re-verificação pós-`bmad-code-review` (Rodada 2, commit `3235536`, mesmos comandos de novo depois de todos os patches da Rodada 2): `npm test -w packages/sync-engine` (73 testes), `npx tsc --noEmit` limpo, rebuild completo e `concurrency-scenario.mjs` (incluindo os 2 novos casos de calendário-inválido no Cenário 5) -- todos PASSARAM. Bug real da Rodada 2 (offset do período anterior reintroduzindo o quirk de ano curto do `Date.UTC` pra `from`/`to` com ano < 200) reproduzido e confirmado corrigido via Node antes de aplicar o patch (ver Review Triage Log).
