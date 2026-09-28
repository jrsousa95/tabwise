# Epic 2 Context: Relatórios Avançados de Caixa

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

O Resumo de Caixa (funcionalidade já existente) só mostra o dia atual, sem tendência nem quebra por operador ou produto. Este épico dá ao dono visão financeira além do "hoje": vendas agrupadas por semana/mês com comparativo direto contra o período anterior, desempenho e perdas por operador, ranking de produtos/categorias (curva ABC), e exportação em CSV para levar ao contador. É uma extensão pura de leitura/agregação sobre `orders` já existentes — não introduz nenhum evento novo no modelo de dados e não depende do Épico 1 (Sessão de Caixa). Todas as ações deste épico são owner-only.

## Stories

- Story 2.1: Relatório por período
- Story 2.2: Relatório por operador
- Story 2.3: Relatório por produto / curva ABC
- Story 2.4: Exportação CSV

## Requirements & Constraints

- Todo relatório aceita um intervalo de datas (não só uma data única), com bounds inclusivos nas duas pontas.
- O relatório por período deve mostrar ao menos um comparativo direto com o período equivalente anterior (ex.: esta semana vs. semana passada, este mês vs. mês anterior).
- `pendingOrders` (comandas ainda abertas) mantém a semântica já existente do relatório de um dia único: mostra todas as comandas abertas *agora*, sem filtrar pelo intervalo pedido — é um retrato do estado atual, não uma métrica do período.
- Relatório por operador precisa de total vendido (comandas fechadas) e total de itens cancelados, agrupados por operador, no mesmo intervalo de datas do relatório por período.
- Relatório por produto precisa de ranking por quantidade vendida e por valor, baseado em eventos `item_added` já existentes; itens cancelados (`item_canceled`) não contam na quantidade/valor vendido.
- Exportação CSV reproduz o mesmo período e os mesmos totais já mostrados em tela (relatório por período); é geração client-side, sem chamada nova ao backend/sidecar. PDF é evolução futura, não critério de aceite aqui.
- Valores monetários são inteiros em centavos, como em todo o resto do sistema.
- Acesso a todas as 4 stories é owner-only (mesmo padrão de permissão de Configurações/Cardápio); papéis "waiter" e "cashier" têm acesso negado.

## Technical Decisions

- `computeCashRegisterSummary(orders, dateKey)` (`packages/sync-engine/src/reporting.ts`) aceita hoje só uma data única e é usada por dois chamadores existentes (sidecar e backend) — sua assinatura não é alterada. Em vez disso, uma função **nova**, `computeCashRegisterSummaryForRange(orders, fromDateKey, toDateKey)`, cobre o relatório por período, extraindo a agregação comum (`subtotalCents`, `serviceFeeCents`, `totalByPaymentMethod`, etc. — ver `CashRegisterSummary`) para um helper interno compartilhado pelas duas funções.
- Bounds inclusivos: `fromDateKey <= localDateKey(...) <= toDateKey`, comparação lexicográfica de string `YYYY-MM-DD` (sem conversão de data).
- Filtro por operador (Story 2.2) acontece FORA do helper compartilhado, não como parâmetro dele: quem chama pré-filtra o array de `orders` por `closing.operatorId` antes de passar para `computeCashRegisterSummaryForRange`. A função em si não sabe o que é "operador".
- Pré-requisito da Story 2.2: `order_closed` já carrega `operatorId` no evento, mas `ClosingState` (`packages/sync-engine/src/reconciliation.ts`) ainda não expõe esse campo na projeção. É um retrofit aditivo (não muda schema de evento) a ser feito como parte desta story — comandas fechadas antes dessa mudança de código ficam sem essa informação retroativamente, o que é aceitável.
- Story 2.3 não adiciona nenhum evento novo ao modelo de dados — é leitura agregada do log de `item_added`/`item_canceled` já existente.
- Story 2.4 não tem decisão de arquitetura nova: gera o CSV client-side a partir do `CashRegisterSummary`/dados já retornados pelas stories 2.1-2.3, sem impacto na camada de dados.
- Limitação conhecida, não bloqueante: `localDateKey` calcula o dia com o fuso de quem processa (sidecar = fuso da máquina, backend = fuso do servidor); essa divergência de borda perto da meia-noite fica mais visível em relatórios por período do que já era no relatório de um dia único — registrado como algo a observar, não a resolver neste épico.

## Cross-Story Dependencies

- Este épico não depende do Épico 1 (Sessão de Caixa) — é extensão pura sobre `orders` já existentes.
- Story 2.2 depende de um retrofit prévio em `ClosingState` (exposição de `operatorId`), tratado como AC da própria story, não como story técnica separada.
- Stories 2.2 e 2.3 reaproveitam o mesmo intervalo de datas e mecanismo de seleção de período da Story 2.1.
- Story 2.4 depende dos totais já exibidos pela Story 2.1 (mesmo período, mesmos números, sem recálculo próprio).
- O Épico 3 (relatório consolidado multi-terminal) não depende deste épico.
