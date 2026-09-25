# Epic 1 Context: Sessão de Caixa

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

O Resumo de Caixa (funcionalidade já existente) mostra um retrato somativo sempre correto do dia, mas não cobre o controle financeiro real de um turno: saber quanto tinha na gaveta antes de vender, registrar movimentações de dinheiro que não são vendas, e conferir se o caixa bateu no fim. Este épico dá ao caixa/dono o controle do turno de ponta a ponta — abrir sessão com fundo de troco, registrar sangria (retirada) e suprimento (reforço) durante o turno, e fechar com conferência entre valor contado e valor esperado. É 100% local, sem nenhuma dependência de nuvem, e não substitui nem altera o Resumo de Caixa existente.

## Stories

- Story 1.1: Abrir sessão de caixa
- Story 1.2: Registrar sangria
- Story 1.3: Registrar suprimento
- Story 1.4: Fechar sessão de caixa com conferência

## Requirements & Constraints

- Só pode existir uma sessão de caixa aberta por vez, e esse invariante é do **estabelecimento inteiro**, não de um terminal — ver Technical Decisions.
- Abrir sessão exige valor inicial em centavos (fundo de troco) e registra o operador.
- Sangria e suprimento exigem valor (> 0, validado no envio) e motivo em texto livre, e só podem ocorrer com uma sessão aberta; sem sessão aberta, a ação é bloqueada com mensagem clara orientando a abrir uma primeiro.
- Fechar sessão exige o valor contado fisicamente; o sistema mostra o valor esperado e a diferença (contado − esperado) antes da confirmação. Diferença ≠ 0 (sobra ou falta) não bloqueia o fechamento — fica só registrada.
- Depois de fechada, a sessão não recebe mais movimentações; uma comanda em dinheiro fechada depois pertence à próxima sessão.
- Tudo funciona 100% offline (mesma garantia do resto do app).
- Todo valor monetário é inteiro em centavos.
- Todos os eventos novos são append-only — nunca editados ou apagados, inclusive quando o valor esperado muda por sincronização tardia (isso vira recálculo, não edição de evento).
- Acesso: mesmo padrão de permissão de caixa/dono já usado no fechamento de comanda — garçom não acessa nenhuma ação de sessão de caixa (abrir, sangria, suprimento, fechar).
- Ordem de implementação sugerida dentro do épico: abrir sessão → sangria → suprimento → fechar com conferência (o fechamento depende dos valores das duas movimentações já existirem).

## Technical Decisions

- Quatro eventos novos com `aggregate_type: "cash_session"` (novo valor no enum fechado `AggregateTypeSchema`, `packages/shared-types/src/common.ts`): `cash_session_opened`, `cash_session_closed`, `cash_withdrawal_recorded`, `cash_deposit_recorded`. `aggregate_id` é gerado na abertura e reaproveitado pelos demais eventos do mesmo ciclo de vida (mesmo padrão de `order_opened`→`item_added`). Sangria/suprimento não ganham `aggregate_type` próprio — são sub-eventos do ciclo de vida da sessão.
- Sessão de caixa é um recurso compartilhado do **estabelecimento**, não do terminal. Um terminal trocado no meio do turno gera um `terminal_id` novo e burlaria uma checagem só local — por isso o invariante "uma sessão aberta por vez" não pode depender de `terminal_id`.
- Conflito de abertura concorrente (dois terminais offline que não se enxergavam abrindo sessão quase ao mesmo tempo) usa a MESMA regra já usada para mesas: a sessão de menor HLC (Hybrid Logical Clock) vira canônica; a outra é marcada `mergedInto` e gera um aviso não bloqueante — nunca trava o operador.
- Novo estado materializado `CashSessionState` (formato igual a `orders`/`tables`) num `Map<string, CashSessionState>` chamado `cashSessions`, dentro de `packages/sync-engine/src/reconciliation.ts`. Contém status (`open`/`closed`), `openedByTerminalId` (só informativo/auditoria, nunca usado para decidir o invariante), `mergedInto` opcional, `openingAmountCents`, `openedAt`, `openedByOperatorId`, listas de `withdrawals`/`deposits` (cada uma um `CashMovementRecord` com id, amountCents, reason, recordedAt, operatorId), e um `closing` opcional só com `countedAmountCents`, `closedAt`, `closedByOperatorId`.
- `expectedAmountCents` e `differenceCents` NUNCA são gravados no payload de evento nem no `closing` — são valores derivados, recalculados pela projeção a partir do log a cada leitura. Isso evita que o "esperado" fique permanentemente errado quando um pedido em dinheiro sincroniza depois do fechamento; a próxima leitura do relatório já reflete o valor certo, sem evento de correção manual.
- Fórmula do valor esperado: `openingAmountCents` + pagamentos em dinheiro de orders fechadas com `closing.closedAt` dentro do intervalo `[openedAt, closedAt ?? agora]` da sessão canônica + suprimentos − sangrias. A correlação NÃO filtra por `terminal_id` (a sessão é do estabelecimento, qualquer terminal pode ter recebido o dinheiro).
- Quando uma sessão já fechada tem seu `expectedAmountCents` mudado por um evento tardio, a tela dessa sessão precisa sinalizar visivelmente que o valor pode ter mudado desde o fechamento — não é silencioso (não existe "retrato congelado" do esperado no momento do fechamento; isso seria extensão futura).
- A tela hoje chamada "Conflitos de Mesas" (`apps/desktop/src/routes/table-conflicts.tsx`) é renomeada para algo mais genérico (ex.: "Conflitos de Sincronização") e passa a listar tanto conflitos de mesa quanto conflitos de sessão de caixa, usando o mesmo mecanismo de resolução.
- Papéis do sistema: garçom não acessa nenhuma ação de caixa; caixa e dono compartilham o mesmo acesso às ações deste épico (abrir/fechar sessão, sangria, suprimento).

## UX & Interaction Patterns

- Telas novas (sessão de caixa, sangria/suprimento) seguem a hierarquia de heading já padronizada no app (`<h1>` de página, subseções com as classes já catalogadas).
- Formulários curtos de abertura de sessão, sangria e suprimento seguem o padrão de formulário inline já usado em outras partes do app — não um layout novo.
- Ações que alteram estado financeiro sensível (fechar sessão com diferença ≠ 0, registrar sangria) devem expor o valor calculado (diferença, valor esperado) de forma visível ANTES da confirmação — mesmo princípio já usado no fluxo de fechamento de comanda com split; nunca uma confirmação cega.

## Cross-Story Dependencies

- Story 1.4 (fechar com conferência) depende dos valores produzidos pelas Stories 1.2 (sangria) e 1.3 (suprimento) já existirem no cálculo do valor esperado — por isso vem por último dentro do épico, mesmo a numeração de PRD listar o fechamento (9.2) antes da sangria/suprimento (9.4/9.5).
- Stories 1.2 e 1.3 dependem de já existir uma sessão aberta (Story 1.1).
- O Épico 3 (relatório consolidado multi-terminal) consome os eventos `cash_session_*` definidos neste épico — precisa que o schema desses eventos já exista antes de fazer sentido a projeção Postgres nova do Épico 3. Isso não exige nenhuma tela deste épico, só o modelo de dados.
- O Épico 2 (relatórios avançados) não depende deste épico — é extensão pura sobre `orders` já existentes.
