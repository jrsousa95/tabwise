---
title: 'Corrigir junção de mesas (PRD 2.6 — trava de sobreposição, desfazer, visibilidade)'
type: 'bugfix'
created: '2026-09-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1c873697690c471a41bcae46625718eb9dc19cd5'
context:
  - '{project-root}/docs/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** a junção de mesas (PRD 2.6) hoje permite agrupar uma mesa já agrupada, criando grupos sobrepostos sem aviso; não existe forma de desfazer um agrupamento feito por engano (evento append-only sem contrapartida); e o agrupamento de uma comanda só aparece como checkbox surpresa no fechamento — nunca antes, no mapa de mesas ou na própria comanda. Achado em uso real (2026-09-21), documentado na emenda da história 2.6 (`docs/prd.md`, commit `1c87369`).

**Approach:** validar sobreposição no `POST /table-groups` do sidecar antes de criar o grupo; adicionar um novo evento `table_group_dissolved` (mesmo padrão append-only de `tables_grouped`) com endpoint e botão "Desfazer"; e surfacear a associação de grupo tanto no `table-tile` do mapa de mesas quanto num aviso na tela da comanda, usando a lógica `tableGroup`/`groupOrderIds` que já existe em `order.tsx` mas nunca foi renderizada.

## Boundaries & Constraints

**Always:** manter o padrão de evento append-only já usado por `tables_grouped` (nunca reescrever/apagar eventos). `table_group_dissolved` usa `aggregateType: "table_group"` e `aggregateId` = id do grupo dissolvido — mesma convenção. A validação de sobreposição roda no sidecar (fonte de verdade), não só no cliente. Mensagem de erro nomeia o grupo existente pelos identificadores de mesa (ex: "Mesa 2 já está no grupo Mesa 2 + Mesa 5"), não pelo id interno do grupo. `POST /table-groups` e o novo endpoint de desfazer seguem a mesma exigência de sessão (`requireSession`) já usada pelas rotas de mesa/comanda existentes — sem restrição de papel adicional (hoje qualquer operador autenticado pode agrupar; desfazer segue a mesma regra, por simetria). O indicador visual de grupo no `table-tile` e o aviso em `order.tsx` reaproveitam classes/tokens já existentes em `app.css` (`status-badge-neutral` ou variante equivalente) — sem nova paleta de cor.

**Never:** mudar o comportamento de `POST /orders/:id/close-group` além do efeito natural de um grupo dissolvido não aparecer mais em `tableGroups` (a validação `sameGroup` em `apps/desktop/sidecar/src/index.ts` já lê de `state.tableGroups`, então passa a rejeitar automaticamente fechamento conjunto de um grupo desfeito — nenhuma mudança nessa rota é necessária). Adicionar biblioteca de ícones ou dependência nova. Renomear "Fechamento de Caixa"/"Fechar comanda" (fora de escopo desta correção).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agrupar mesas livres | `POST /table-groups` com 2+ mesas sem grupo ativo | 201, grupo criado | N/A |
| Agrupar mesa já agrupada | `POST /table-groups` incluindo um `tableId` que já está em outro grupo ativo | 400, sem criar grupo | Mensagem nomeia o grupo existente pelos identificadores de mesa |
| Desfazer grupo existente | `DELETE /table-groups/:id` com id de grupo ativo | 204, evento `table_group_dissolved` gravado, grupo some de `state.tableGroups` | N/A |
| Desfazer grupo inexistente/já desfeito | `DELETE /table-groups/:id` com id que não está em `state.tableGroups` | 404 | Mensagem clara de grupo não encontrado |
| Comanda em mesa agrupada | Abrir `order.tsx` de uma comanda cuja mesa está em `tableGroups` | Aviso visível mostra com quais mesas está agrupada, antes do fechamento | N/A |
| Fechamento conjunto após desfazer | Tentar `POST /orders/:id/close-group` depois do grupo ter sido desfeito | 400 (comportamento já existente de `sameGroup`, sem mudança de código) | Mensagem já existente: "as mesas dessas comandas não estão marcadas como agrupadas" |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/events.ts` -- adicionar `TableGroupDissolvedSchema` (linha ~128, logo após `TablesGroupedSchema`): `type: "table_group_dissolved"`, `aggregateType: "table_group"`, `aggregateId` = id do grupo, `payload: z.object({})`. Incluir no array de `DomainEventSchema` (linha ~206, logo após `TablesGroupedSchema`).
- `packages/sync-engine/src/reconciliation.ts` -- em `case "tables_grouped"` (linha ~263), adicionar `case "table_group_dissolved": { tableGroups.delete(event.aggregateId); break; }` logo depois.
- `apps/desktop/sidecar/src/index.ts` -- em `POST /table-groups` (linha ~879-915): antes de criar `groupId`, checar `currentState().tableGroups` por sobreposição com `uniqueTableIds`; se houver, montar mensagem com os identificadores de mesa do grupo conflitante (via `tables`) e responder 400. Adicionar nova rota `DELETE /table-groups/:id` (perto de `/pairing/manual-host`, linha ~558, como referência de padrão DELETE): `requireSession`, verificar que o grupo existe em `currentState().tableGroups` (404 se não), gravar evento `table_group_dissolved` com `aggregateId` = id da URL, responder 204.
- `apps/desktop/src/lib/tables.ts` -- adicionar `export function dissolveTableGroup(groupId: string)` chamando `DELETE /table-groups/${groupId}` (seguir o padrão de `postJson`, mas sem corpo/resposta JSON — usar uma variante que trata 204).
- `apps/desktop/src/routes/table-map.tsx` -- lista "Junção de mesas" (linha ~188-193): adicionar botão "Desfazer" por grupo, chamando `dissolveTableGroup(g.id)` seguido de `refresh()`. No grid de `table-tile` (linha ~140-174): quando a mesa pertence a algum grupo, mostrar um indicador (ex: `status-badge status-badge-neutral` com o rótulo das mesas do grupo) junto ao `table-tile-status`.
- `apps/desktop/src/routes/order.tsx` -- já calcula `tableGroup`/`groupOrderIds` (linhas 58-61); adicionar um aviso visível logo após o `<h2>{title}</h2>` (linha ~113) quando `tableGroup` existe, mostrando com quais mesas a comanda está agrupada.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/events.ts` -- adicionar `TableGroupDissolvedSchema` e incluir em `DomainEventSchema` -- fundação do novo evento
- [x] `packages/sync-engine/src/reconciliation.ts` -- projetar `table_group_dissolved` removendo o grupo de `tableGroups` -- sem isso o grupo nunca some do estado
- [x] `apps/desktop/sidecar/src/index.ts` -- validação de sobreposição em `POST /table-groups` + nova rota `DELETE /table-groups/:id` -- trava a causa raiz do bug real
- [x] `apps/desktop/src/lib/tables.ts` -- `dissolveTableGroup` -- cliente pro novo endpoint
- [x] `apps/desktop/src/routes/table-map.tsx` -- botão "Desfazer" + indicador de grupo no `table-tile` -- fecha o ciclo de UI de desfazer + visibilidade no mapa
- [x] `apps/desktop/src/routes/order.tsx` -- aviso de agrupamento antes do fechamento -- visibilidade na comanda, onde a confusão foi observada

**Acceptance Criteria:**
- Given uma mesa já pertence a um grupo ativo, when o operador tenta incluí-la em outro `POST /table-groups`, then a API responde 400 nomeando o grupo existente pelos identificadores de mesa, e nenhum grupo novo é criado
- Given um grupo ativo de mesas, when o operador aciona "Desfazer" no mapa de mesas, then o grupo some da lista e das mesas afetadas, e uma tentativa posterior de fechamento conjunto dessas mesas falha com a mensagem já existente de "mesas não agrupadas"
- Given uma comanda cuja mesa está em um grupo ativo, when a tela da comanda carrega (antes de clicar em "Fechar comanda"), then um aviso mostra com qual(is) mesa(s) ela está agrupada
- Given o mapa de mesas, when uma mesa pertence a um grupo ativo, then o `table-tile` correspondente mostra um indicador do grupo

## Implementation Notes

- Diff verificado contra o baseline (`1c873697690c471a41bcae46625718eb9dc19cd5`) linha a linha: as 6 tarefas batem exatamente com o Code Map, sem escopo extra.
- Testes automatizados adicionados nos dois pacotes que já tinham suíte (`packages/shared-types`, `packages/sync-engine`) cobrindo o schema do novo evento e a projeção que remove o grupo de `tableGroups`. O sidecar (`apps/desktop/sidecar`) não tem suíte de teste HTTP nenhuma no repo (só `test/concurrency-scenario.mjs` e `test/packaged-binary-smoke.mjs`, nenhum dos dois toca `/table-groups`) — por isso a própria seção `## Verification` deste spec já previa apenas "Manual checks" pra essa camada. A verificação manual (registrada no relatório da implementação) contra uma instância isolada cobriu as 4 linhas da matriz que dependiam do sidecar: sobreposição rejeitada nomeando o grupo, desfazer com 204, desfazer inexistente com 404, e fechamento conjunto falhando após desfazer. Não considero isso uma lacuna do spec — é a mesma lacuna pré-existente de toda a camada HTTP do sidecar, fora do escopo desta correção.
- Todos os comandos da seção Verification rodaram e passaram: `tsc --noEmit` (apps/desktop e sidecar), build de `shared-types`/`sync-engine`, e as suítes de teste (8 + 42 passando, incluindo os 2 novos testes).

## Review Triage Log

Três camadas rodaram em paralelo sobre o diff (`blind-hunter`, `edge-case-hunter`, `verification-gap`). Achados verificados um a um contra o código real (`apps/desktop/sidecar/src/index.ts`, `apps/desktop/src/routes/table-map.tsx`, `apps/desktop/sidecar/test/*.mjs`):

- **medium — patch** — nenhum teste cobre a rejeição de sobreposição em `POST /table-groups` (achado por `blind-hunter` e, de forma pré-verificada, por `verification-gap`: busca em todo o repo por `table-groups`/`conflictingGroup` em arquivos de teste não retorna nada; o sidecar não usa vitest por convenção do próprio projeto — `test/concurrency-scenario.mjs` e `test/packaged-binary-smoke.mjs` são os smoke tests roteirizados oficiais, e nenhum dos dois toca `/table-groups`). Uma regressão que reintroduzisse grupos sobrepostos — o bug real que esta história existe pra corrigir — passaria despercebida. Corrigido: cenário adicionado ao `packaged-binary-smoke.mjs` (mesmo padrão já usado ali).
- **medium — patch** — mesma lacuna pra `DELETE /table-groups/:id` (achado por `blind-hunter` e `verification-gap`, pré-verificado): nenhum teste verifica o 404 de grupo inexistente, o 204 de sucesso, nem que o grupo some de `/state` depois. Corrigido no mesmo cenário do `packaged-binary-smoke.mjs`.
- **low — patch** — `conflictingGroup` usa `.find()` e só reporta o primeiro grupo conflitante; se a seleção sobrepõe dois grupos diferentes, a mensagem de erro nomeia só um, e o operador só descobre o segundo depois de reenviar (`blind-hunter`, verificado em `apps/desktop/sidecar/src/index.ts`). Correção trivial (`.filter()` + listar todos), sem novo estado — corrigido.
- **low — patch** — `DELETE /table-groups/:id` não está dentro de um `try/catch`; se `DomainEventSchema.parse` ou `insertEvent` lançar, a resposta nunca é enviada e o cliente fica pendurado até o timeout (`edge-case-hunter`, verificado: o handler realmente não tem `try/catch`). Comparável à rota irmã sem corpo (`DELETE /pairing/manual-host`), que também não tem — não é uma regressão exclusiva deste diff, mas o custo de corrigir aqui é trivial (envolver em `try/catch` + 500) e a rota é nova, então corrigido.
- **low — rejeitado** — `TableGroupDissolvedSchema.payload` vazio, sem motivo/nota (diferente de `ItemCanceledSchema`, que exige `reason`), então não há trilha de auditoria de por que um grupo foi desfeito (`blind-hunter`). Real, mas a emenda do PRD só pediu que o agrupamento pudesse ser desfeito, não que a razão fosse capturada — a correção exigiria novo campo de schema + UI de captura, não é uma correção trivial. Rejeitado por regra (`low` + correção maior que uma correção direta).
- **low — rejeitado** — botão "Desfazer" dispara direto no clique, sem confirmação, diferente do fluxo de cancelar item que exige motivo (`blind-hunter`). Real, mas desfazer um agrupamento é uma ação de baixo risco e reversível em segundos (basta reagrupar) — a emenda do PRD só pedia que fosse possível desfazer, não que tivesse fricção extra. Corrigir exigiria um novo estado de confirmação na UI — mais que correção direta. Rejeitado.
- **low — rejeitado** — nenhum indicador de quem/quando um grupo foi criado na lista de "Junção de mesas", embora o evento carregue `operatorId`/`createdAt` (`blind-hunter`). Real, mas não foi pedido pela emenda do PRD, e a correção tocaria `TableGroupState`/projeção/UI — mais que correção direta. Rejeitado.
- **low — rejeitado** — botão "Desfazer" sem estado de carregando/desabilitado durante o `DELETE`; um duplo-clique rápido dispara duas requisições (`blind-hunter`). Verificado: a segunda simplesmente recebe 404 sem efeito nenhum — inofensivo — e nenhum outro botão desta tela (`handleGroupTables`, transferência) tem essa proteção, então não é uma regressão introduzida por este diff. Rejeitado (uso cotidiano improvável + não é regressão desta história).
- **medium — deferido** — a validação de sobreposição só enxerga o estado local de cada sidecar; dois terminais diferentes podem, cada um, passar na validação antes de sincronizar entre si e produzir grupos sobrepostos mesmo assim (`blind-hunter`). Verificado que não existe corrida dentro de um único processo (`currentState()`/`insertEvent` são síncronos, sem `await` entre a checagem e a gravação — Node não intercala código síncrono), então o risco é só entre terminais, não dentro de uma requisição. É uma característica pré-existente de toda a arquitetura de sync multi-terminal (eventual consistency via HLC), não algo causado por este diff — resolver de verdade pediria um mecanismo tipo `mergeWarnings` (já existe pra conflito de mesa, ARCH §4.2) aplicado a grupos, o que é trabalho de arquitetura novo, fora do escopo desta correção pontual. Registrado em `deferred-work.md`.

Os 4 `patch` foram aplicados (não pelo mesmo subagente que implementou — lançamento novo por engano, mas com instruções autocontidas: arquivo, linha, defeito e correção exatos, então sem perda de contexto na prática). Verificado depois, de forma independente: `tsc --noEmit` (desktop e sidecar) limpo; `shared-types`/`sync-engine` — 8 + 42 testes passando; rebuild do binário SEA do sidecar e execução de `test/packaged-binary-smoke.mjs` contra o binário real — passou de ponta a ponta, incluindo o novo cenário "junção de mesas: rejeição de sobreposição + desfazer".

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: sem erros
- `npm run build --workspace packages/shared-types --workspace packages/sync-engine` (ou equivalente do monorepo) -- expected: build limpo, schema/projeção compilam

**Manual checks (if no CLI):**
- Contra uma instância isolada do sidecar (porta/dir de dados dedicados desta sessão, nunca a sessão live do usuário): agrupar 2 mesas, tentar agrupar uma delas de novo (deve falhar nomeando o grupo), desfazer o grupo, confirmar que a comanda de uma dessas mesas não mostra mais o aviso de agrupamento e que fechamento conjunto falha.
