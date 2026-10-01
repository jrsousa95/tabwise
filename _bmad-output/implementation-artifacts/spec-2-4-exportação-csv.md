---
title: 'Exportação CSV do relatório por período (Epic 2 / Story 2.4)'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b6759bd085d3f6b0ad14c0f1b73f112df1cf0211'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** O dono precisa levar o resumo de caixa por período (Story 2.1) pro contador, mas hoje só existe a tela — sem forma de exportar os números sem digitar tudo de novo.

**Approach:** Botão "Exportar CSV" na tela `/reports` (visível só depois de "Ver relatório" carregar um resultado), gerando o CSV 100% no navegador a partir dos dados já em memória (sem chamada nova ao sidecar/backend) e disparando o download nativo do navegador.

## Boundaries & Constraints

**Always:** Geração client-side, sem `fetch` novo. Reaproveitar `formatCentsToBRL` (mesma formatação já exibida em tela) pra toda célula monetária — nunca reformatar centavos com lógica própria. Delimitador `;` (ponto-e-vírgula), não `,` — convenção do Excel em pt-BR, que já trata `,` como separador decimal; usar `,` como delimitador quebraria a leitura de qualquer valor monetário na primeira tentativa de abrir o arquivo. Acesso owner-only herdado estruturalmente do `RequireRole` já existente na tela `/reports` inteira (app.tsx) — nenhum bloqueio novo necessário.

**Decisão (Open Question resolvida na aprovação):** sem teste automatizado novo pro `csv.ts` — mesma lacuna já aceita hoje em todo `apps/desktop/src/lib/*.ts` (nenhum arquivo dessa pasta tem teste, incluindo `money.ts`, igualmente puro); verificação por leitura de código + checagem manual na tela, documentada na seção Verification. Sem footprint de infraestrutura de teste novo no frontend.

**Never:** Não inclui os blocos "Por operador" (2.2) nem "Por produto" (2.3) — o CSV desta story reproduz só o relatório por período (2.1: período escolhido, período anterior, comparativo), conforme `epic-2-context.md` ("Exportação CSV reproduz o mesmo período e os mesmos totais já mostrados em tela (relatório por período)"). Não introduz PDF (fora de escopo, citado explicitamente como evolução futura). Não adiciona lib nova de CSV — string-building nativo (`;`-joined rows, `\r\n` entre linhas).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Caminho feliz | Relatório carregado (`result` com `current`/`previous` populados) | CSV com linhas: identificação do período, comparativo (total atual/anterior/variação), resumo do período escolhido (comandas fechadas, subtotal, taxa de serviço, total vendido, dinheiro/cartão/pix, comandas pendentes), resumo do período anterior (mesmos campos, exceto pendentes) | N/A |
| Variação zero | `current.totalSoldCents === previous.totalSoldCents` | Linha de variação mostra "sem variação", sem percentual (mesma regra da `ComparisonBlock` já exibida) | N/A |
| Período anterior sem vendas | `previous.totalSoldCents === 0` e `current.totalSoldCents > 0` | Percentual de variação omitido (divisão por zero não tem leitura útil — mesma regra já exibida em tela) | N/A |
| Botão antes de carregar relatório | `status !== "ready"` ou `result === null` | Botão "Exportar CSV" não aparece (ou fica desabilitado) — nunca gera CSV vazio/com dado stale | N/A |
| Acesso por papel não-owner | `waiter`/`cashier` tenta acessar `/reports` | Acesso negado — herdado do `RequireRole` já existente na tela inteira, nada novo a testar aqui | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/lib/reports.ts` -- nova `computeSummaryDelta(current: CashRegisterSummary, previous: CashRegisterSummary): { deltaCents: number; deltaLabel: string; deltaPercent: number | null }` -- extraída do cálculo hoje inline em `ComparisonBlock` (`reports.tsx`), reaproveitada tanto pela UI quanto pelo CSV, garantindo que os dois NUNCA divirjam no valor de variação exibido
- `apps/desktop/src/routes/reports.tsx` -- `ComparisonBlock` passa a chamar `computeSummaryDelta` em vez do cálculo próprio (mesmo resultado, sem duplicar a lógica); novo botão "Exportar CSV" renderizado junto do resultado (`status === "ready" && result`), chama `buildCashRegisterSummaryCsv` + `downloadCsv`
- `apps/desktop/src/lib/csv.ts` -- NOVO arquivo: `buildCashRegisterSummaryCsv(fromDate: string, toDate: string, range: CashRegisterSummaryRange): string` (monta o texto do CSV: cabeçalho de período, linha de comparativo via `computeSummaryDelta`, bloco do período escolhido, bloco do período anterior — todas as células monetárias via `formatCentsToBRL`, `;` como delimitador, `\r\n` entre linhas); `downloadCsv(filename: string, content: string): void` (Blob com BOM UTF-8 pra acentuação abrir correta no Excel + `<a download>` temporário, revoga o Object URL depois do clique)

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src/lib/reports.ts` -- extrair `computeSummaryDelta` -- fonte única de verdade do cálculo de variação, reaproveitada por UI e CSV
- [x] `apps/desktop/src/lib/csv.ts` -- `buildCashRegisterSummaryCsv` + `downloadCsv` -- geração do CSV e disparo do download, 100% client-side
- [x] `apps/desktop/src/routes/reports.tsx` -- refatorar `ComparisonBlock` pra usar `computeSummaryDelta`; botão "Exportar CSV" -- interface do usuário
- [x] Cobertura da Matrix -- verificação manual documentada em Verification (sem teste automatizado novo, decisão registrada em Boundaries & Constraints)

**Acceptance Criteria:**
- Given um período já mostrado em tela (2.1), when o dono clica em "Exportar CSV", then um arquivo `.csv` é baixado com os mesmos totais exibidos (período escolhido, período anterior, comparativo)
- Given a exportação, when implementada, then não faz nenhuma chamada nova ao sidecar/backend — usa só os dados já carregados em `state`
- Given papel "waiter" ou "cashier", when tenta acessar `/reports`, then acesso negado (herdado do `RequireRole` já existente, nada novo)

## Implementation Notes

Implementado 2026-10-01. `computeSummaryDelta` extraída tal e qual do cálculo que já existia inline em `ComparisonBlock` (nenhuma mudança de comportamento, só relocação). `csv.ts` novo: `row()` interno junta células com `;` sem nenhum escaping (decisão deliberada — todo conteúdo é controlado, rótulos fixos em português ou strings já formatadas por `formatCentsToBRL`, nunca texto livre que poderia conter `;`/aspas/quebra de linha). Filename do download: `relatorio-periodo-{from}-a-{to}.csv` (não especificado no Code Map, decisão de implementação).

## Spec Change Log

## Review Triage Log

`bmad-build` step 4 (3 camadas: blind-hunter, edge-case-hunter, verification-gap). Cada achado verificado contra o código real antes do veredito.

- [x] **medium → Patch, achado real, duplicado entre 2 camadas** — `computeSummaryDelta` unificou só o CÁLCULO da variação (`deltaCents`/`deltaPercent`), mas a combinação final pra exibição ("`+R$ 10,00 (+10.0%)`") continua duplicada: `formatDelta` em `csv.ts` reimplementa exatamente a mesma expressão que já está inline na JSX de `ComparisonBlock` (`reports.tsx`). Contradiz a própria razão de ser da extração ("NUNCA divirjam") — hoje produzem o mesmo texto, mas uma mudança futura num dos dois lugares (arredondamento, sinal, espaçamento) diverge silenciosamente do outro. [apps/desktop/src/lib/csv.ts, apps/desktop/src/routes/reports.tsx] *blind-hunter + verification-gap ("Other findings"), achado duplicado*.
- [x] **medium → Patch, achado real** — `row()` junta células com `;` sem nenhuma proteção contra uma célula que comece com `+`, `-`, `=` ou `@` — e a célula "Variação" frequentemente começa com `+` ou `-` (ex.: `"+R$ 10,00 (...)"`). Alguns programas de planilha podem interpretar isso como início de fórmula em vez de mostrar o valor, quebrando exatamente a informação mais importante pro contador ler. Correção mínima: prefixar com `'` quando a célula começar com um desses caracteres. [apps/desktop/src/lib/csv.ts] *edge-case-hunter*.
- [x] **low → Patch** — o BOM UTF-8 em `downloadCsv` está embutido como um caractere invisível de verdade dentro do template literal (confirmado via inspeção de bytes: `ef bb bf`), em vez do escape explícito `"﻿"`. Invisível em qualquer diff/code review, e uma edição futura no arquivo pode apagá-lo sem ninguém perceber, quebrando a acentuação no Excel silenciosamente. [apps/desktop/src/lib/csv.ts] *blind-hunter*. **Nota:** o subagente de implementação relatou ter aplicado essa correção, mas a verificação em bytes do orquestrador mostrou que o byte cru continuava no arquivo (só movido pra uma constante nomeada) — corrigido diretamente pelo orquestrador via substituição a nível de byte.
- [x] **medium → Defer, maybe-false (severidade não verificada)** — `downloadCsv` (Blob + `<a download>` + `URL.createObjectURL`/`revokeObjectURL` imediato) é a PRIMEIRA feature de download de arquivo do app — nunca testada dentro da webview real empacotada do Tauri (WebView2/WKWebView), só via `tsc`/build e leitura de código (ver Verification). O `revokeObjectURL` rodando logo após o `click()` é um padrão comum mas com histórico de causar falha em alguns webviews mais antigos se o download ainda não tiver sido lido. Se o problema for real, é `high` (a própria entrega central da story não funcionaria dentro do app empacotado) — não dá pra confirmar sem abrir o app de verdade. O que resolveria: rodar o app em modo dev/empacotado de verdade, clicar "Exportar CSV" e confirmar que um arquivo cai na pasta de Downloads. [apps/desktop/src/lib/csv.ts] *blind-hunter + edge-case-hunter, achados agrupados (mesma causa raiz: mecanismo de download nunca exercitado na webview real)*.
- [x] **medium → Defer, pré-existente** — o botão "Exportar CSV" usa `fromDate`/`toDate` (sempre ao vivo, dos `<input type="date">`) junto de `result` (só atualizado no último "Ver relatório" bem-sucedido) — se o dono mudar as datas sem clicar "Ver relatório" de novo, o CSV baixado mostra as datas NOVAS no cabeçalho/nome do arquivo mas os totais ANTIGOS no corpo. Confirmado que esse exato padrão (rótulo com datas ao vivo + `summary` potencialmente obsoleto) já existia desde a Story 2.1 na própria tela (`SummaryBlock title={... fromDate ... toDate ...} summary={result.current}`, commit `b6759bd`, não introduzido por esta story) — o CSV só herda o mesmo comportamento, agora num arquivo persistente em vez de um rótulo transitório na tela. [apps/desktop/src/routes/reports.tsx] *edge-case-hunter*.

**Rejeitados:**
- `row()` sem escaping de `;`/aspas/quebra de linha — **[rejeitado]** hoje só recebe rótulos fixos em português e saídas de `formatCentsToBRL`, nenhum dos quais pode conter esses caracteres; o risco citado (reaproveitar `row()` pra texto livre de operador/produto) é hipotético e explicitamente fora de escopo desta story (`Never`: "não inclui os blocos Por operador/Por produto"). Adicionar escaping agora seria complexidade especulativa pra uma entrada que não pode ocorrer no estado atual do código.
- Valores monetários no CSV são strings formatadas (`"R$ 1.234,56"`, com espaço não-quebrável), não números puros — Excel provavelmente importa como texto, dificultando somar/analisar — **[rejeitado]** consequência direta de uma decisão já tomada e congelada em Boundaries & Constraints ("reaproveitar `formatCentsToBRL`... nunca reformatar centavos com lógica própria"), com justificativa própria documentada em Design Notes (fidelidade byte-a-byte ao que já é exibido, a própria letra do AC "os mesmos totais exibidos"). Corrigir isso significaria reabrir uma decisão já congelada pelo humano na aprovação do spec.
- Nenhum teste automatizado novo pra `computeSummaryDelta`/`buildCashRegisterSummaryCsv` — **[rejeitado]** é exatamente a Open Question já resolvida na aprovação do spec ("sem teste automatizado novo... mesma lacuna já aceita hoje em todo `apps/desktop/src/lib/*.ts`"), registrada em Boundaries & Constraints. Corrigir significaria reverter uma decisão já tomada pelo humano.
- `downloadCsv` sem `try/catch` no handler de clique (Blob/`URL.createObjectURL` lançando, ou a webview bloqueando o download programático, ficaria em silêncio sem feedback) — **[rejeitado]** baixíssima probabilidade de ocorrer na prática (essas APIs essencialmente nunca lançam em uso normal) e a correção exigiria mais que uma correção direta (novo estado de erro + feedback de UI, já que não existe affordance pra "exportação falhou" hoje) — mesma classe de lacuna (ausência de tratamento de erro assíncrono) já aceita repetidamente em todo o app.

#### Rodada 2 — `bmad-code-review` (commit 161c60e, 2026-10-01)

4 camadas (blind-hunter, edge-case-hunter, verification-gap, acceptance-auditor). Cada achado verificado contra o código real antes do veredito.

- [x] **decision-needed → resolvido pelo usuário: manter sem teste** — `escapeFormulaInjection` (guard de CSV injection, nascido no patch da Rodada 1) não tem nenhum teste automatizado — diferente das outras funções puras do CSV, essa é especificamente um controle de segurança. Esbarra na decisão já congelada ("sem teste automatizado novo"), mas essa decisão foi tomada ANTES dessa função existir. Usuário escolheu manter sem teste, consistente com a decisão original — registrado em `deferred-work.md` como o gatilho natural pra reconsiderar se o projeto um dia adicionar teste de frontend. [apps/desktop/src/lib/csv.ts] *verification-gap, achado pré-verificado*.
- [x] **low → Patch** — rótulos "Total vendido - período escolhido/anterior" no CSV usavam hífen (`-`), enquanto a tela (`ComparisonBlock`) usa travessão (`—`) — divergência de texto literal entre tela e export, contradizendo a fidelidade "byte-a-byte" que é a própria razão de reaproveitar `formatCentsToBRL`. Corrigido pra travessão. [apps/desktop/src/lib/csv.ts] *acceptance-auditor*.
- [x] **low → Patch** — `SummaryDelta.deltaCents` era computado e exposto no tipo público/retorno de `computeSummaryDelta`, mas nenhum dos dois consumidores (`ComparisonBlock`, `buildCashRegisterSummaryCsv`) o lê — dado morto na interface pública, candidato a confundir um futuro mantenedor achando que é usado em algum lugar. Removido do tipo/retorno (continua como `const` local, só não é mais exposto). [apps/desktop/src/lib/reports.ts] *blind-hunter*.
- [x] **low → Patch** — `escapeFormulaInjection` só olhava `value[0]`, sem tratar um espaço/tab antes de `+`/`-`/`=`/`@` — hoje nenhuma célula tem esse formato (hipotético), mas a correção é trivial (`trimStart()[0]`) e sem custo. Corrigido. [apps/desktop/src/lib/csv.ts] *blind-hunter*.
- [x] **low → Patch** — `downloadCsv` fazia `appendChild`/`click`/`removeChild`/`revokeObjectURL` em sequência sem `try/finally` — se `click()` lançasse uma exceção (caso raro), o `<a>` ficaria preso no DOM e a Object URL vazaria (nunca revogada). Envolvido em `try/finally` pra garantir a limpeza mesmo em caso de exceção. [apps/desktop/src/lib/csv.ts] *edge-case-hunter*.
- [x] **low → Patch** — o comentário acima do botão "Exportar CSV" afirmava que o botão "nunca gera CSV vazio/com dado stale", mas isso não cobre o caso (pré-existente, ver Defer abaixo) de `fromDate`/`toDate` mudarem sem reenviar o formulário — o comentário superestimava a garantia. Reescrito pra ser preciso e referenciar a limitação conhecida; adicionado também um comentário explícito sobre a suposição de formato `YYYY-MM-DD` no nome do arquivo (achado do blind-hunter sobre a interpolação sem guard/comentário). [apps/desktop/src/routes/reports.tsx] *verification-gap ("Other findings") + blind-hunter*.
- [x] **medium → Defer, carried (mesma linha já registrada na Rodada 1)** — `downloadCsv` (Blob + `<a download>`) nunca foi exercitada dentro da webview real empacotada do Tauri (WebView2/WKWebView) — só verificada via `tsc`/build/leitura de código. [apps/desktop/src/lib/csv.ts] *blind-hunter + edge-case-hunter, carried*.
- [x] **medium → Defer, carried (mesma linha já registrada na Rodada 1)** — `fromDate`/`toDate` ao vivo podem divergir de `result` obsoleto se o dono mudar as datas sem reenviar o formulário — pré-existente desde a Story 2.1. [apps/desktop/src/routes/reports.tsx] *edge-case-hunter + verification-gap ("Other findings"), carried*.

**Rejeitados (Rodada 2):**
- Valores monetários no CSV são strings formatadas, não números puros — **[rejeitado, carried]** mesma decisão já congelada em Boundaries & Constraints, reconfirmada pelo blind-hunter nesta rodada sem nenhum fato novo.
- CSV não é uma tabela normalizada (linhas com número variável de células: título, separador em branco, cabeçalho só-rótulo, rótulo+valor) — **[rejeitado]** é exatamente o formato de "relatório", não "dataset", deliberado desde o Code Map original (reproduz a mesma estrutura em blocos já exibida em tela) — mesma razão de ser da decisão já congelada sobre valores formatados em vez de números crus.
- `escapeFormulaInjection`/`row()` sem escaping genérico de `;`/aspas/quebra de linha — **[rejeitado, carried]** mesmo veredito da Rodada 1: hoje só recebe rótulos fixos e `formatCentsToBRL`, nenhum dos quais pode conter esses caracteres; reaproveitar `row()` pra texto livre (operador/produto) é hipotético e fora de escopo desta story.
- Falta de teste automatizado pras funções puras em geral (`computeSummaryDelta`, `formatDelta`, `buildCashRegisterSummaryCsv`) — **[rejeitado, carried]** mesma Open Question já resolvida na aprovação do spec; distinto do caso específico de `escapeFormulaInjection` (tratado acima como decision-needed, resolvido mantendo sem teste).
- `computeSummaryDelta` não documenta/guarda o caso de `previous.totalSoldCents` negativo — **[false]** dinheiro é sempre não-negativo em toda a stack (somas de `unitPriceCents * quantity`, ambos não-negativos por schema Zod na camada de eventos) — não é um caminho alcançável, não é uma lacuna real, só uma nota de documentação opcional pra um estado que não pode ocorrer.

## Design Notes

**Por que `;` como delimitador, não `,`:** o público-alvo explícito é "levar pro contador" — no Excel em pt-BR, `,` já é o separador decimal padrão, então um CSV separado por vírgula com valores tipo "150,50" quebra a leitura de coluna na primeira tentativa de abrir sem um assistente de importação manual. `;` é o delimitador que o Excel em pt-BR já espera por padrão.

**Por que BOM UTF-8 no Blob:** os rótulos das linhas são em português com acentuação ("Comandas fechadas", "Taxa de serviço"). Sem o BOM (`﻿` no início do conteúdo), o Excel no Windows abre o arquivo interpretando como uma codificação diferente de UTF-8 e corrompe os acentos.

**Por que reaproveitar `formatCentsToBRL` em vez de formatar direto:** é a MESMA função já usada em toda a tela — garante por construção que o valor no CSV é byte-a-byte o mesmo já exibido (a própria letra do AC: "os mesmos totais exibidos"), em vez de duas implementações de formatação de dinheiro que podem divergir com o tempo.

## Verification

**Commands:**
- `npx tsc --noEmit -p apps/desktop` -- expected: sem erros
- `npm run build -w apps/desktop` -- expected: build de produção limpo

**Manual checks (sem harness de teste de componente React no projeto):**
- Na tela `/reports`, escolher um período com vendas, clicar "Ver relatório" e depois "Exportar CSV"; abrir o arquivo baixado e conferir que os números batem exatamente com os exibidos em tela (período escolhido, período anterior, variação)
- Confirmar que o botão não aparece (ou está desabilitado) antes de carregar um relatório
- Abrir o CSV no Excel/LibreOffice em locale pt-BR e confirmar que os valores monetários caem cada um na própria coluna (delimitador `;` funcionando) e que os acentos aparecem corretos (BOM funcionando)

**Resultados:**
- `npx tsc --noEmit -p apps/desktop` -- PASSOU, sem erros.
- `npm run build -w apps/desktop` -- PASSOU, build de produção limpo.
- Reexecução independente do orquestrador (fora do que o subagente já tinha rodado) de `buildCashRegisterSummaryCsv` via `tsx`, cobrindo as 5 linhas da Matrix: caminho feliz (blocos corretos, "Comandas pendentes" só no período escolhido), variação zero (`"sem variação"` sem percentual), período anterior sem vendas (percentual omitido, rótulo `"+R$ 100,00"`) -- CONFIRMADO, saída byte-a-byte como esperado. Botão só dentro de `{result && status === "ready" && (...)}` e `/reports` só dentro de `RequireRole allowed={["owner"]}` (`app.tsx`) -- CONFIRMADO por leitura direta do código.
- **Não realizado**: clique real na tela `/reports` do app rodando (Tauri/navegador) nem abertura do arquivo baixado no Excel/LibreOffice de verdade -- nem o subagente nem o orquestrador abriram a sessão de desenvolvimento real do usuário pra esse teste (ambiente já tinha um sidecar/vite dev do próprio usuário rodando nas portas 4550/1420, e interagir com a sessão real exigiria login com credenciais que não temos). Essa checagem visual fica pendente -- ver nota ao usuário. Registrado em `deferred-work.md` (risco real, não verificado).

**Resultados (pós-patches da Rodada de revisão, 2026-10-01):**
- `formatDelta` extraída pra `apps/desktop/src/lib/reports.ts` (fonte única), reaproveitada por `ComparisonBlock` (`reports.tsx`) e por `buildCashRegisterSummaryCsv` (`csv.ts`) -- CONFIRMADO lendo o diff: nenhum dos dois lugares monta mais a string "(+X.X%)" de forma independente.
- Guard de CSV injection (`escapeFormulaInjection`, prefixa `'` quando a célula começa com `+`/`-`/`=`/`@`) -- CONFIRMADO via reexecução independente do orquestrador: célula "Variação" com variação positiva vira `'+R$ 10,00 (+10.0%)`, negativa vira `'-R$ 10,00 (-10.0%)`, célula "sem variação" (não começa com nenhum desses caracteres) continua sem prefixo.
- BOM UTF-8: o subagente alegou ter trocado o caractere invisível cru pelo escape `"﻿"`, mas a verificação em bytes do orquestrador (`xxd`) mostrou que o byte cru (`ef bb bf`) continuava no arquivo, só movido pra uma constante nomeada -- achado NÃO corrigido de verdade apesar do relato. Corrigido diretamente pelo orquestrador (substituição a nível de byte); reconfirmado em bytes que `ef bb bf` não aparece mais no arquivo e o texto `﻿` aparece 3x (constante + 2 menções no comentário).
- `npx tsc --noEmit -p apps/desktop` -- PASSOU, sem erros (reexecutado depois da correção do BOM).
- `npm run build -w apps/desktop` -- PASSOU, build de produção limpo (inclui rebuild do bundle/SEA do sidecar, inalterado nesta story).

**Resultados (pós-patches da Rodada 2 — bmad-code-review, 2026-10-01):**
- Travessão nos rótulos de comparativo do CSV (igualando a tela), `deltaCents` removido do tipo público `SummaryDelta`, guard de injeção de fórmula com `trimStart()`, `try/finally` em `downloadCsv`, comentários corrigidos -- todos aplicados diretamente pelo orquestrador (sem subagente, dada a imprecisão já observada na Rodada 1).
- Reexecução independente do orquestrador de `buildCashRegisterSummaryCsv` -- CONFIRMADO: rótulos agora usam `—` (travessão) idêntico à tela, resto do CSV inalterado.
- `npx tsc --noEmit -p apps/desktop` -- PASSOU.
- `npm run build -w apps/desktop` -- PASSOU, build de produção limpo.
