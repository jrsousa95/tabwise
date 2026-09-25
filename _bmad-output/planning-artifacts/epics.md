---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments: [docs/prd.md, docs/architecture.md, _bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/DESIGN.md, _bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/EXPERIENCE.md]
scope: "Épico 9 (Evolução do Fluxo de Caixa) apenas — Épicos 1-8 já implementados e validados (M0-M12 fechados, ver docs/implementation-plan.md), fora do escopo deste breakdown."
---

# passa-a-regua - Epic Breakdown

## Overview

Este documento quebra o **Épico 9 (Evolução do Fluxo de Caixa)** — o primeiro épico da fase pós-MVP — em stories implementáveis. Épicos 1-8 (MVP completo) já estão implementados e validados em uso real; este breakdown cobre só a extensão de sessão de caixa/relatórios registrada em `docs/prd.md` §Épico 9 e `docs/architecture.md` §3.4/3.5/4.4/5, ambos fechados nesta mesma sessão de trabalho (2026-09-24).

## Requirements Inventory

### Functional Requirements

(Numeração reaproveitada das histórias do PRD — FR-9.N ↔ história 9.N)

- **FR-9.1:** Caixa/dono pode abrir uma sessão de caixa informando o valor inicial em dinheiro (fundo de troco). Gera evento `cash_session_opened` (valor em centavos, operador). Bloqueado com mensagem clara se já existe uma sessão aberta no estabelecimento. Funciona offline.
- **FR-9.2:** Caixa/dono pode fechar a sessão de caixa informando o valor contado fisicamente. Sistema mostra o valor esperado (fundo + vendas em dinheiro da sessão − sangrias + suprimentos) e a diferença (sobra/falta) antes de confirmar. Gera evento `cash_session_closed` (valor contado + valor esperado + diferença, nunca ajustados pra "bater"). Sessão fechada não recebe mais movimentações.
- **FR-9.3:** Dono pode ver o resumo de vendas agrupado por período (semana/mês), com ao menos um comparativo direto (ex: esta semana vs. anterior). Owner-only.
- **FR-9.4:** Caixa/dono pode registrar uma sangria (retirada) com valor, motivo (texto livre) e operador — evento `cash_withdrawal_recorded`. Só com sessão aberta. Entra no cálculo do valor esperado (FR-9.2).
- **FR-9.5:** Caixa/dono pode registrar um suprimento (reforço) com valor, motivo e operador — evento `cash_deposit_recorded`. Entra no cálculo do valor esperado em sentido oposto à sangria.
- **FR-9.6:** Dono pode ver total vendido e total de itens cancelados por operador, no mesmo intervalo de datas de FR-9.3. Owner-only.
- **FR-9.7:** Dono pode ver ranking de produtos/categorias por quantidade e valor vendido no período (curva ABC), baseado em `item_added` já existente. Owner-only.
- **FR-9.8:** Dono pode ver, na própria tela do app, o relatório consolidado de todos os terminais do estabelecimento. Exige terminal com credencial de nuvem. Owner-only.
- **FR-9.9:** Dono pode exportar o resumo de caixa em CSV, com o mesmo período e totais mostrados em tela. Owner-only.

### NonFunctional Requirements

Reaproveitadas do PRD §4 (nenhuma NFR nova introduzida pelo Épico 9 — todas continuam se aplicando):

- **NFR1:** Aplicação deve operar 100% funcional sem conexão à internet — vale pra FR-9.1 a FR-9.7, FR-9.9 (tudo local-first); FR-9.8 é a exceção já assumida no próprio PRD (exige nuvem).
- **NFR3:** Dados são log append-only, não estado mutável — todos os 4 eventos novos seguem isso; nenhum é editado/apagado, inclusive quando o valor esperado muda por sync tardio (vira recálculo de projeção, não edição de evento — ver Additional Requirements).
- **NFR6:** Log de auditoria é append-only e não editável via UI — sangria/suprimento (FR-9.4/9.5) seguem o mesmo padrão do cancelamento de item.
- **NFR7:** Valores monetários em centavos (inteiro) — todo campo `*AmountCents`/`*Cents` dos eventos e relatórios novos.

### Additional Requirements

(Extraídas de `docs/architecture.md` §3.4/3.5/4.4/5 — decisões técnicas que restringem como as stories acima podem ser implementadas)

- 4 eventos novos com `aggregate_type: "cash_session"` (novo valor no enum `AggregateTypeSchema`, `packages/shared-types/src/common.ts`): `cash_session_opened`, `cash_session_closed`, `cash_withdrawal_recorded`, `cash_deposit_recorded`. `aggregate_id` = id da sessão (gerado na abertura, reaproveitado pelos demais).
- **Sessão de caixa é um recurso do estabelecimento, não do terminal** (ARCH §4.4, revisado após reviewer adversarial) — usa a MESMA regra de resolução de conflito do §4.2 (canônica por menor HLC, perdedora marcada `mergedInto`, aviso não bloqueante). Isso é uma mudança de escopo em relação à primeira leitura da história 9.1 do PRD — já alinhado (commit `724243c`).
- Novo estado materializado `CashSessionState` em `packages/sync-engine/src/reconciliation.ts` (`cashSessions: Map<string, CashSessionState>`), incluindo `CashMovementRecord` para sangria/suprimento.
- `ClosingState` (mesmo arquivo) ganha campo `operatorId`, lido de `event.operatorId` no handler de `order_closed` — aditivo, não muda schema de evento. Pré-requisito de FR-9.6.
- `expectedAmountCents`/`differenceCents` do fechamento da sessão são valores **derivados** (recalculados pela projeção), nunca congelados no payload do evento — só `countedAmountCents` é gravado no `cash_session_closed`. Isso evita o valor "esperado" ficar permanentemente errado quando uma comanda em dinheiro sincroniza depois do fechamento.
- Nova função `computeCashRegisterSummaryForRange(orders, fromDateKey, toDateKey)` em `packages/sync-engine/src/reporting.ts` — NÃO altera a assinatura de `computeCashRegisterSummary` existente. Bounds inclusivos nas duas pontas; `pendingOrders` não filtrado pelo período (mesmo comportamento da função de um dia); filtro por operador (FR-9.6) acontece FORA do helper (quem chama pré-filtra `orders` por `closing.operatorId`).
- FR-9.8 precisa de uma **projeção Postgres nova** no backend pros 4 eventos de `cash_session` (mesmo padrão da projeção de `orders` já existente desde M9/M11) — o endpoint `GET /reports/cash-register` de hoje só agrega orders, não sabe nada de sessão de caixa.
- Limitação conhecida (não bloqueante): `localDateKey` calcula o dia com o fuso de quem está processando (sidecar = fuso da máquina, backend = fuso do servidor) — mais visível em relatórios por período/consolidado (FR-9.3/9.8) do que já era no relatório de um dia único.

### UX Design Requirements

Não há um design contract específico pro Épico 9 ainda — `DESIGN.md`/`EXPERIENCE.md` (`_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/`) foram fechados antes desse épico existir. As stories abaixo devem seguir os padrões já estabelecidos, sem inventar um novo sistema:

- **UX-DR1:** Novas telas (sessão de caixa, sangria/suprimento, relatórios) seguem a mesma hierarquia de heading já padronizada (`<h1>` de página, `.section-heading`/`.subsection-heading` pra subseções — ver `EXPERIENCE.md`).
- **UX-DR2:** Formulários curtos (abertura de sessão, sangria, suprimento) seguem o padrão `inline-form` já catalogado em `DESIGN.md` (Component Patterns), não um layout novo.
- **UX-DR3:** Ações que alteram estado financeiro sensível (fechar sessão com diferença ≠ 0, registrar sangria) devem expor o valor calculado (diferença, valor esperado) de forma visível antes da confirmação — mesmo princípio já usado no fechamento de comanda com split (`order-closing.tsx`), não uma confirmação cega.
- **UX-DR4 (decidido com o dono, 2026-09-25):** conflito de sessão de caixa (ARCH §4.2/§4.4) aparece na MESMA tela hoje chamada "Conflitos de Mesas" (`apps/desktop/src/routes/table-conflicts.tsx`), que é renomeada pra algo mais genérico (ex: "Conflitos de Sincronização") e passa a listar os dois tipos de conflito.
- **UX-DR5 (decidido durante a story 1.4):** quando `expectedAmountCents` de uma sessão já fechada muda de valor por causa de um pedido em dinheiro que sincronizou atrasado, a tela dessa sessão sinaliza que o valor pode ter mudado desde o fechamento (ver Story 1.4, último AC) — não é silencioso.

### FR Coverage Map

- FR-9.1: Epic 1, story 1.1 — abertura de sessão de caixa
- FR-9.2: Epic 1, story 1.4 — fechamento de sessão com conferência (por último dentro do épico — depende dos valores de 1.2/1.3 já existirem)
- FR-9.3: Epic 2, story 2.1 — relatório por período (semana/mês, comparativo)
- FR-9.4: Epic 1, story 1.2 — sangria
- FR-9.5: Epic 1, story 1.3 — suprimento
- FR-9.6: Epic 2 — relatório por operador (inclui o retrofit `ClosingState.operatorId` como AC da própria story 2.2, não uma story técnica separada)
- FR-9.7: Epic 2 — relatório por produto/curva ABC
- FR-9.8: Epic 3 — relatório consolidado multi-terminal (única dependência de backend/nuvem)
- FR-9.9: Epic 2 — exportação CSV

## Epic List

**Epic 1 — Sessão de Caixa.** Caixa/dono controla o turno de caixa de ponta a ponta: abre com fundo de troco, registra sangria/suprimento durante o turno, fecha conferindo valor contado x esperado. 100% local, sem dependência de nuvem. FRs covered: FR-9.1, FR-9.4, FR-9.5, FR-9.2.

**Epic 2 — Relatórios Avançados de Caixa.** Dono enxerga tendência de vendas além do dia atual (período, operador, produto/ABC) e exporta o resumo pra levar ao contador. Extensão pura de relatório sobre `orders` já existentes — não depende do Epic 1. FRs covered: FR-9.3, FR-9.6, FR-9.7, FR-9.9.

**Epic 3 — Relatório Consolidado Multi-terminal.** Dono com mais de um terminal vê o caixa de todos consolidado direto no app, sem abrir o backend manualmente. Isolado por exigir credencial de nuvem configurada e uma projeção Postgres nova no backend (única dependência de infraestrutura deste conjunto de épicos). FRs covered: FR-9.8.

**Ordem de entrega sugerida (prioridade do dono, intercalando os épicos):** 1.1(9.1) → 2.1(9.3) → 1.2(9.4) → 1.3(9.5) → 1.4(9.2) → 2.2(9.6) → 2.3(9.7) → 3.1(9.8) → 2.4(9.9).

_(Reordenado durante a validação do step 4: a story de fechamento com conferência, FR-9.2, precisa vir DEPOIS de sangria/suprimento — FR-9.4/9.5 — porque sua fórmula de valor esperado as usa; manter a numeração 9.2 antes de 9.4/9.5 no PRD é só prioridade de negócio, não ordem de implementação dentro do Epic 1.)_

**Nota de dependência entre épicos:** Epic 3 (relatório consolidado) consome os eventos `cash_session_*` definidos no Epic 1 — precisa que o schema desses eventos já exista em `packages/shared-types` antes de a projeção Postgres de 3.1 fazer sentido. Isso não viola a independência de épicos (Epic 3 não precisa de nenhuma TELA do Epic 1, só do modelo de dados) — é o mesmo tipo de "Epic 3 constrói sobre Epic 1" já previsto nas regras de dependência.

## Epic 1: Sessão de Caixa

Caixa/dono controla o turno de caixa de ponta a ponta: abre com fundo de troco, registra sangria/suprimento durante o turno, fecha conferindo valor contado x esperado. 100% local, sem dependência de nuvem.

**FRs covered:** FR-9.1, FR-9.2, FR-9.4, FR-9.5
**NFRs relevantes:** NFR1 (offline), NFR3/NFR6 (append-only/auditoria), NFR7 (centavos)
**UX-DR4:** conflito de sessão de caixa entra na tela "Conflitos de Mesas", renomeada pra algo mais genérico (ex: "Conflitos de Sincronização"), que passa a listar os dois tipos de conflito.

### Story 1.1: Abrir sessão de caixa

Como caixa/dono,
Eu quero abrir uma sessão de caixa informando o valor inicial em dinheiro,
Para que o sistema saiba quanto deveria ter na gaveta antes de qualquer venda.

**Acceptance Criteria:**

**Given** nenhuma sessão de caixa aberta no estabelecimento
**When** o operador informa um valor de abertura em centavos e confirma
**Then** o sistema gera `cash_session_opened` (`aggregate_type: "cash_session"`, `aggregate_id` novo) com `openingAmountCents` e o operador, e a sessão aparece como aberta na tela de Caixa

**Given** já existe uma sessão de caixa aberta no estabelecimento (mesmo que aberta por outro terminal, já sincronizada)
**When** o operador tenta abrir uma nova
**Then** a ação é bloqueada com mensagem clara

**Given** o terminal está offline
**When** o operador abre uma sessão
**Then** funciona normalmente — evento gravado localmente, sincroniza depois (NFR1)

**Given** dois terminais offline abrem sessão quase ao mesmo tempo sem se enxergarem
**When** os logs sincronizam
**Then** a de menor HLC vira canônica e a outra é marcada `mergedInto`, aparecendo como aviso não bloqueante e na tela "Conflitos de Sincronização" (mesmo mecanismo do ARCH §4.2/§4.4) — não trava ninguém

**Given** o operador logado tem papel "waiter" (garçom)
**When** tenta acessar a abertura de caixa
**Then** acesso negado (mesmo padrão de permissão já usado no fechamento de comanda)

### Story 1.2: Registrar sangria

Como caixa/dono,
Eu quero registrar uma sangria durante o turno,
Para reduzir o volume em caixa por segurança sem perder o registro de onde foi o dinheiro.

**Acceptance Criteria:**

**Given** uma sessão de caixa aberta
**When** o operador informa valor e motivo (texto livre) e confirma
**Then** gera `cash_withdrawal_recorded` (`aggregate_id` = sessão aberta) com valor, motivo e operador

**Given** nenhuma sessão aberta
**When** o operador tenta registrar sangria
**Then** bloqueado com mensagem clara pra abrir uma sessão primeiro

**Given** valor informado zero ou negativo
**When** o operador tenta confirmar
**Then** a validação impede o envio

### Story 1.3: Registrar suprimento

Como caixa/dono,
Eu quero registrar um suprimento durante o turno,
Para repor troco sem que isso pareça uma venda a mais no fechamento.

**Acceptance Criteria:**

**Given** uma sessão de caixa aberta
**When** o operador informa valor e motivo e confirma
**Then** gera `cash_deposit_recorded` (`aggregate_id` = sessão aberta) com valor, motivo e operador

**Given** nenhuma sessão aberta
**When** o operador tenta registrar suprimento
**Then** bloqueado com a mesma mensagem de 1.2

**Given** valor informado zero ou negativo
**When** o operador tenta confirmar
**Then** a validação impede o envio

### Story 1.4: Fechar sessão de caixa com conferência

Como caixa/dono,
Eu quero fechar a sessão de caixa informando o valor contado fisicamente,
Para saber se o caixa bateu com o esperado.

**Acceptance Criteria:**

**Given** uma sessão de caixa aberta (canônica), com zero ou mais sangrias (1.2) e suprimentos (1.3) já registrados
**When** o operador inicia o fechamento
**Then** o sistema mostra o valor esperado calculado (abertura + vendas em dinheiro da sessão + suprimentos já registrados − sangrias já registradas) antes de pedir o valor contado

**Given** o valor esperado exibido
**When** o operador informa o valor contado e confirma
**Then** gera `cash_session_closed` com `countedAmountCents`, e a diferença (contado − esperado) é exibida — nunca ajusta o esperado pra "bater"

**Given** a diferença é ≠ 0 (sobra ou falta)
**When** o operador confirma mesmo assim
**Then** o fechamento é permitido normalmente — a diferença fica registrada, não bloqueia

**Given** a sessão já fechada
**When** uma comanda em dinheiro é fechada depois
**Then** ela não conta pra essa sessão — pertence à próxima sessão aberta

**Given** um pedido em dinheiro que deveria contar pra essa sessão sincroniza depois do fechamento
**When** o dono revisita essa sessão fechada
**Then** o valor esperado exibido reflete o novo total (é derivado — ARCH §3.4) e a tela sinaliza que o valor pode ter mudado desde o fechamento


## Epic 2: Relatórios Avançados de Caixa

Dono enxerga tendência de vendas além do dia atual (período, operador, produto/ABC) e exporta o resumo pra levar ao contador. Extensão pura de relatório sobre `orders` já existentes — não depende do Epic 1.

**FRs covered:** FR-9.3, FR-9.6, FR-9.7, FR-9.9
**NFRs relevantes:** NFR7 (centavos)
**Permissão:** owner-only em todas as 4 stories (mesmo padrão de Configurações/Cardápio, PRD §2).

### Story 2.1: Relatório por período

Como dono,
Eu quero ver o resumo de vendas agrupado por semana ou mês,
Para entender tendência do negócio sem somar dia a dia manualmente.

**Acceptance Criteria:**

**Given** um intervalo de datas (semana ou mês) selecionado
**When** o dono abre o relatório
**Then** o sistema mostra o resumo agregado desse intervalo via `computeCashRegisterSummaryForRange` (bounds inclusivos nas duas pontas — ARCH §3.5)

**Given** o relatório de um período
**When** exibido
**Then** mostra ao menos um comparativo direto com o período equivalente anterior (ex: esta semana vs. semana passada)

**Given** `pendingOrders` (comandas ainda abertas)
**When** exibidas
**Then** mostram todas as comandas abertas agora, sem filtrar pelo intervalo pedido (mesmo comportamento do relatório de um dia único já existente)

**Given** papel "waiter" ou "cashier"
**When** tenta acessar
**Then** acesso negado

### Story 2.2: Relatório por operador

Como dono,
Eu quero ver quanto cada operador vendeu e quantos itens cancelou num período,
Para ter visibilidade de desempenho e de perdas por pessoa.

**Acceptance Criteria:**

**Given** o evento `order_closed` já carrega `operatorId` desde sempre
**When** esta story é implementada
**Then** `ClosingState` (`reconciliation.ts`) passa a expor esse campo (retrofit aditivo — comandas fechadas antes dessa mudança de código ficam sem essa informação retroativamente, aceitável)

**Given** um intervalo de datas (mesmo do 2.1)
**When** o dono abre o relatório por operador
**Then** vê total vendido e total de itens cancelados agrupados por operador

**Given** o filtro por operador
**When** aplicado
**Then** acontece fora do helper compartilhado — pré-filtra `orders` por `closing.operatorId` antes de chamar `computeCashRegisterSummaryForRange` (ARCH §3.5); comandas ainda abertas não aparecem em nenhum agrupamento

**Given** papel "waiter" ou "cashier"
**When** tenta acessar
**Then** acesso negado

### Story 2.3: Relatório por produto / curva ABC

Como dono,
Eu quero ver quais produtos/categorias mais vendem num período,
Para entender o que impulsiona o cardápio.

**Acceptance Criteria:**

**Given** um intervalo de datas
**When** o dono abre o relatório de produtos
**Then** vê um ranking por quantidade vendida e por valor, baseado nos eventos `item_added` já existentes

**Given** um item cancelado (`item_canceled`)
**When** o ranking é calculado
**Then** esse item não conta na quantidade/valor vendido

**Given** esta história
**When** implementada
**Then** não adiciona nenhum evento novo ao modelo de dados — só leitura agregada do log já existente

**Given** papel "waiter" ou "cashier"
**When** tenta acessar
**Then** acesso negado

### Story 2.4: Exportação CSV

Como dono,
Eu quero exportar o resumo de caixa em CSV,
Para levar pro contador sem digitar os números de novo.

**Acceptance Criteria:**

**Given** um período já mostrado em tela (2.1)
**When** o dono clica em exportar
**Then** um CSV é gerado com os mesmos totais exibidos

**Given** a exportação
**When** implementada
**Then** é geração client-side, sem chamada nova ao backend/sidecar

**Given** papel "waiter" ou "cashier"
**When** tenta acessar
**Then** acesso negado


## Epic 3: Relatório Consolidado Multi-terminal

Dono com mais de um terminal vê o caixa de todos consolidado direto no app, sem abrir o backend manualmente. Isolado por exigir credencial de nuvem configurada e uma projeção Postgres nova no backend (única dependência de infraestrutura deste conjunto de épicos).

**FRs covered:** FR-9.8
**Permissão:** owner-only.

### Story 3.1: Relatório consolidado multi-terminal

Como dono,
Eu quero ver na própria tela do app o relatório consolidado de todos os terminais do estabelecimento,
Para não precisar consultar o backend manualmente.

**Acceptance Criteria:**

**Given** o backend (Postgres) precisa saber sobre sessão de caixa, sangria e suprimento pra consolidar de verdade
**When** esta story é implementada
**Then** o backend ganha uma projeção Postgres nova pros 4 eventos de `cash_session` (mesmo padrão da projeção de `orders` já existente desde M9/M11 — ARCH §5), e `GET /reports/cash-register` passa a incluir dados de sessão consolidados, não só vendas

**Given** um terminal com credencial de nuvem configurada (mesmo requisito de sincronização já existente)
**When** o dono abre o relatório consolidado
**Then** vê o resumo agregado de todos os terminais do estabelecimento (vendas + sessões de caixa) direto na tela do app

**Given** um terminal SEM credencial de nuvem configurada
**When** o dono tenta abrir o relatório consolidado
**Then** vê uma mensagem clara explicando que é preciso configurar a sincronização com a nuvem primeiro (não um erro genérico)

**Given** papel "waiter" ou "cashier"
**When** tenta acessar
**Then** acesso negado
