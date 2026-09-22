---
title: 'Renomear/remover mesa, categoria e produto (PRD 2.8/3.4/3.5)'
type: 'feature'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'db7381779445d58c2124a635cfd8f83ad5833a88'
context:
  - '{project-root}/docs/prd.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** mesas, categorias e produtos só podem ser cadastrados — nenhum dos três pode ser renomeado ou removido depois (produto já tem ativar/desativar, mas não remover). Achado em uso real (2026-09-22), documentado em `docs/prd.md` (histórias 2.8, 3.4, 3.5, commit `f48cf7b`).

**Approach:** um evento de renomear e um de remover por entidade, mesmo padrão append-only já usado em `product_status_changed` (nunca reescreve o cadastro original). Remover é sempre lógico — a entidade some das listas ativas, nunca apaga histórico. Cada entidade tem sua própria trava de remoção, refletindo o que quebraria se ela sumisse com algo ainda dependendo dela.

## Boundaries & Constraints

**Always:** rotas de renomear/remover exigem `requireOwner` (mesmo guard das rotas de cadastro dessas 3 entidades). Remover mesa bloqueia com 409 se ela tiver comanda aberta agora. Remover categoria bloqueia com 409 se algum produto (ativo ou inativo) ainda tiver essa `categoryId`. Remover produto não tem trava (itens de comanda já guardam sua própria cópia de nome/preço no momento da venda — `item_added` — então o produto pode sumir da lista sem quebrar histórico). Renomear produto não muda `item_added` já gravados.

**Never:** exclusão física de linha nenhuma. Adicionar campo de "motivo" na remoção (a emenda do PRD não pediu isso, diferente do cancelamento de item que já tem motivo obrigatório por natureza mais sensível). Mudar o comportamento de ativar/desativar produto (`product_status_changed` continua como está, remover é uma camada além, não uma substituição).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Renomear mesa | `POST /tables/:id/rename` com identifier novo | 200, mesa atualizada | N/A |
| Remover mesa livre | `DELETE /tables/:id`, mesa sem comanda aberta | 200/204, some do mapa | N/A |
| Remover mesa ocupada | `DELETE /tables/:id`, mesa com comanda aberta agora | 409 | Mensagem clara pedindo fechar a comanda primeiro |
| Renomear categoria | `POST /categories/:id/rename` com name novo | 200, categoria atualizada | N/A |
| Remover categoria vazia | `DELETE /categories/:id`, nenhum produto referencia | 200/204, some da lista | N/A |
| Remover categoria em uso | `DELETE /categories/:id`, algum produto (ativo ou inativo) referencia | 409 | Mensagem clara pedindo mover/remover os produtos primeiro |
| Renomear produto | `POST /products/:id/rename` com name novo | 200, produto atualizado; itens de comandas antigas mantêm o nome antigo | N/A |
| Remover produto (com ou sem histórico) | `DELETE /products/:id` | 200/204, some da lista de cadastro; comandas antigas continuam mostrando o item vendido normalmente | N/A |
| Releitura de log com evento de remoção antigo | `GET /state` após qualquer remoção | Entidade não aparece nas listas ativas; nenhum erro | N/A |

</frozen-after-approval>

## Code Map

- `packages/shared-types/src/events.ts` -- adicionar 6 schemas novos (padrão de `ProductStatusChangedSchema`, linha ~64): `TableRenamedSchema`/`TableRemovedSchema` (`aggregateType: "table"`), `CategoryRenamedSchema`/`CategoryRemovedSchema` (`aggregateType: "category"`), `ProductRenamedSchema`/`ProductRemovedSchema` (`aggregateType: "product"`). Payloads: renomear leva o(s) campo(s) que muda(m) (`identifier`+`capacity` opcional pra mesa; `name` pra categoria/produto); remover é `z.object({})`. Incluir todos em `DomainEventSchema` (~linha 197), logo após o schema de cada entidade correspondente.
- `packages/sync-engine/src/reconciliation.ts` -- 6 novos `case` (perto de `case "product_status_changed"`, ~linha 201, e de `case "table_registered"`/`case "category_registered"`): renomear faz `.set(id, {...existing, ...novosCampos})`; remover faz `.delete(id)` no Map correspondente (`tables`/`categories`/`products`) — mesmo padrão de `tableGroups.delete()` já usado pra `table_group_dissolved`.
- `apps/desktop/sidecar/src/index.ts` -- 6 rotas novas, todas com `requireOwner` (mesmo guard de `POST /tables`, `/categories`, `/products`): `POST /tables/:id/rename`, `DELETE /tables/:id` (checa `currentState().orders` por comanda aberta com `currentTableId` igual, 409 se achar), `POST /categories/:id/rename`, `DELETE /categories/:id` (checa `currentState().products` por `categoryId` igual, 409 se achar), `POST /products/:id/rename`, `DELETE /products/:id` (sem checagem extra). 404 se a entidade não existir.
- `apps/desktop/src/lib/tables.ts` -- `renameTable(id, {identifier, capacity?})`, `removeTable(id)` — seguir o padrão `postJson`/`ApiResult` já usado no arquivo.
- `apps/desktop/src/lib/catalog.ts` -- `renameCategory(id, name)`, `removeCategory(id)`, `renameProduct(id, name)`, `removeProduct(id)` — seguir o padrão de `createCategory`/`setProductActive` já usado no arquivo.
- `apps/desktop/src/routes/table-map.tsx` -- em cada `table-tile` (grid de mesas, ~linha 120-140), adicionar "Renomear" (prompt inline ou input, o que for mais consistente com o resto da tela) e "Remover" (com erro exibido se 409); `refresh()` após sucesso.
- `apps/desktop/src/routes/catalog.tsx` -- lista de categorias (`<li>{c.name}</li>`, ~linha 137): adicionar botões "Renomear"/"Remover" por item, com erro exibido se 409. Tabela de produtos (coluna de ações, ~linha 197-200): adicionar "Renomear"/"Remover" ao lado de "Ativar/Desativar".

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared-types/src/events.ts` -- 6 novos schemas + inclusão em `DomainEventSchema` -- fundação de tudo que segue
- [x] `packages/sync-engine/src/reconciliation.ts` -- projeção dos 6 eventos -- sem isso nada muda de estado
- [x] `apps/desktop/sidecar/src/index.ts` -- 6 rotas novas com as travas de remoção -- causa raiz: capacidade que faltava
- [x] `apps/desktop/src/lib/tables.ts` -- `renameTable`/`removeTable` -- cliente pras rotas de mesa
- [x] `apps/desktop/src/lib/catalog.ts` -- `renameCategory`/`removeCategory`/`renameProduct`/`removeProduct` -- cliente pras rotas de categoria/produto
- [x] `apps/desktop/src/routes/table-map.tsx` -- UI de renomear/remover mesa -- fecha o ciclo pra mesas
- [x] `apps/desktop/src/routes/catalog.tsx` -- UI de renomear/remover categoria e produto -- fecha o ciclo pro cardápio

**Acceptance Criteria:**
- Given uma mesa sem comanda aberta, when o dono remove ela, then ela some do mapa de mesas e uma tentativa de reabri-la (id antigo) não é mais possível
- Given uma mesa com comanda aberta agora, when o dono tenta remover ela, then a API responde 409 com mensagem clara
- Given uma categoria com pelo menos um produto vinculado (ativo ou inativo), when o dono tenta remover ela, then a API responde 409 com mensagem clara
- Given um produto com histórico de vendas, when o dono remove ele, then ele some do cadastro mas os itens das comandas antigas continuam mostrando nome/preço normalmente
- Given qualquer renomear (mesa/categoria/produto), when a operação é confirmada, then o novo nome aparece imediatamente na tela após `refresh()`, sem afetar registros históricos já gravados

## Implementation Notes

- O subagente de implementação **travou** (sem progresso por 600s) no meio de `routes/catalog.tsx`, logo após importar as funções novas e criar os estados de renomear/remover, mas antes de escrever os handlers e o JSX. Todos os outros 6 arquivos (`events.ts`, `reconciliation.ts`, `index.ts`, `lib/tables.ts`, `lib/catalog.ts`, `table-map.tsx`) já estavam completos e corretos quando conferi — terminei só `catalog.tsx` eu mesmo, seguindo exatamente o padrão de UI já usado em `table-map.tsx` (rename inline com input+Salvar/Cancelar, erro exibido abaixo da lista/tabela).
- **Achado de processo (não do subagente):** editar só o `.ts` de `packages/shared-types`/`packages/sync-engine` não é suficiente pro bundle do sidecar enxergar os tipos novos — essas duas packages publicam via `main: "./dist/index.js"` (`package.json`), então é preciso `npm run build --workspace packages/shared-types --workspace packages/sync-engine` (não só `--noEmit`/testes, que usam o TS direto via vitest) antes de reconstruir o bundle/binário do sidecar. Descobri isso na primeira tentativa de verificação manual: o sidecar rodando ainda com o `dist/` antigo derrubava (`ZodError: Invalid discriminator value`) em qualquer chamada às rotas novas. Corrigido rebuildando as duas packages antes do bundle; nenhuma mudança de código foi necessária.
- Testes unitários novos: 2 em `packages/sync-engine/test/tables.test.ts` (`table_renamed`, `table_removed`) e 4 em `packages/sync-engine/test/catalog.test.ts` (`category_renamed`, `category_removed`, `product_renamed`, `product_removed`) — segui a convenção existente (arquivos por domínio, não `other-events.test.ts`). Mais 6 casos em `packages/shared-types/test/events.test.ts` (schema válido de cada tipo novo).
- Adicionado um cenário novo em `apps/desktop/sidecar/test/packaged-binary-smoke.mjs` (renomear/remover das 3 entidades + as duas travas 409) — os testes unitários só cobrem schema/projeção, não a lógica de trava nas rotas HTTP; sem isso, uma regressão nas travas de 409 passaria despercebida (mesmo tipo de lacuna encontrado na revisão do spec anterior).
- Verificação manual completa rodada duas vezes contra uma instância isolada (a primeira encontrou o problema de build acima; a segunda, após corrigi-lo, confirmou os 9 cenários da matriz — incluindo as duas travas 409).

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: sem erros
- `cd apps/desktop/sidecar && npx tsc -p tsconfig.json --noEmit` -- expected: sem erros
- `npm run build --workspace packages/shared-types --workspace packages/sync-engine` -- expected: build limpo (necessário antes do bundle do sidecar pegar os tipos novos)
- `npm run test --workspace packages/shared-types --workspace packages/sync-engine` -- expected: testes existentes continuam passando; adicionar casos novos pros 6 eventos (schema + projeção, incluindo as travas de remoção via `currentState`/rotas)
- `cd apps/desktop/sidecar && npm run build && node test/packaged-binary-smoke.mjs <binário>` -- expected: passa de ponta a ponta, incluindo o cenário novo de renomear/remover

**Manual checks (if no CLI):**
- Contra uma instância isolada do sidecar: renomear e remover uma mesa livre; tentar remover uma mesa com comanda aberta (esperar 409); renomear/remover categoria e produto; tentar remover categoria com produto vinculado (esperar 409); confirmar que um produto removido não quebra a exibição de uma comanda antiga que já o vendeu.

## Review Triage Log

Três camadas rodaram em paralelo sobre o diff (`blind-hunter`, `edge-case-hunter`, `verification-gap`). Achados verificados um a um contra o código real:

- **low — patch** — a mensagem 409 de categoria em uso dizia "mova ou remova os produtos primeiro", mas não existe nenhuma capacidade de mover um produto pra outra categoria (só renomear nome, nunca `categoryId`) — a mensagem prometia algo que o app não faz (`blind-hunter`, verificado: `renameProduct`/`ProductRenamedSchema` só tocam `name`). Corrigido: mensagem reescrita pra "remova os produtos primeiro".
- **low — patch** — botões "Renomear"/"Remover" de categoria e produto em `catalog.tsx` ficavam clicáveis durante a requisição (sem guarda de "enviando"), quebrando a convenção que o próprio arquivo já usa em todo outro botão de ação (`categorySubmitting`, `productSubmitting`, `serviceFeeSubmitting`) — inconsistente com o padrão estabelecido no mesmo arquivo (`blind-hunter`/`edge-case-hunter`, verificado). Corrigido: `categoryActionSubmitting`/`productActionSubmitting` adicionados, desabilitando os botões durante o envio.
- **low — patch** — os inputs de renomear (mesa, categoria, produto) eram `<input>` soltos fora de `<form>`, sem submissão por Enter, diferente de todo outro formulário da tela (`blind-hunter`, verificado: `handleAddTable`/`handleAddCategory`/`handleAddProduct` usam `<form onSubmit>`). Corrigido: os três agora usam `<form onSubmit>`.
- **low — patch** — o rótulo do describe em `events.test.ts` ("dos 20 tipos") era só texto livre, sem nenhuma asserção real contra `DomainEventSchema.options.length` — é exatamente assim que ele já tinha ficado desatualizado antes (`blind-hunter`, verificado). Corrigido: assert real adicionado — e ele **imediatamente pegou um bug de verdade** na minha própria implementação do patch (a lista `validEvents` tinha uma contagem que não batia, por causa da entrada duplicada intencional de `table_registered` com/sem capacidade — corrigido comparando tipos distintos, não a contagem bruta).
- **false** — indicador de grupo/junção de mesas em `table-map.tsx` só protegido por `operator?.role === "owner"`, enquanto os novos botões de categoria/produto em `catalog.tsx` não têm checagem de papel nenhuma (`blind-hunter`). Verificado: `catalog.tsx` nunca teve NENHUMA checagem de papel client-side pra nada (nem "Adicionar categoria", nem "Ativar/Desativar", que já existiam antes desta spec) — a tela inteira sempre dependeu só do link do nav ser owner-only (`layout.tsx`) + `requireOwner` no servidor. Os novos botões seguem exatamente o padrão pré-existente do próprio arquivo; não é uma regressão.
- **low — rejeitado** — nenhuma confirmação antes de remover mesa/categoria/produto (`blind-hunter`). Real, mas remoção é sempre lógica e barata de desfazer na prática (recriar um cadastro leva segundos; nenhum dado histórico se perde — itens de comanda já guardam sua própria cópia de nome/preço). A emenda do PRD só pediu a capacidade de remover, não fricção extra — mesmo raciocínio já usado pro botão "Desfazer" de junção de mesas na spec anterior. Corrigir exigiria um novo estado de confirmação — mais que correção direta. Rejeitado.
- **low — rejeitado** — capacidade de mesa não pode ser "limpa" via renomear: deixar o campo em branco mantém o valor antigo silenciosamente, porque `JSON.stringify` descarta a chave `capacity: undefined` (`blind-hunter`, verificado — reproduzido). Real, mas corrigir de verdade exige decidir a semântica de "não mudar" vs. "limpar explicitamente" (schema/payload novo), o que a emenda do PRD não pediu — é um caso de borda raro (poucas mesas têm capacidade cadastrada, e ninguém precisa removê-la depois). Rejeitado (correção maior que direta, uso cotidiano improvável).
- **false** — `removeCategory`/`removeProduct`/`removeTable` duplicam a mesma lógica de fetch+erro em vez de um helper `deleteJson` compartilhado (`blind-hunter`). Verificado: cada arquivo `lib/*.ts` deste projeto já mantém seu próprio `postJson` local (não compartilhado entre arquivos) — é o padrão já estabelecido em todo o código, não algo introduzido por este diff.
- **low — rejeitado** — botão "Remover" de mesa em `table-map.tsx` sem guarda de "enviando", dois cliques rápidos disparam duas chamadas (`edge-case-hunter`). Verificado: `table-map.tsx` nunca usa guarda de "enviando" em NENHUM botão (Adicionar mesa, Transferir, Abrir comanda) — ao contrário de `catalog.tsx`, este arquivo nunca teve essa convenção. Mesmo raciocínio já usado pro botão "Desfazer" na spec anterior neste mesmo arquivo. Rejeitado.
- **medium — deferido** — as 6 rotas novas têm ramos de validação (400 nome/identificador vazio, capacidade inválida, 404 id desconhecido) sem nenhuma cobertura automatizada que rode num caminho de teste normal — só o `packaged-binary-smoke.mjs`, que só roda via `workflow_dispatch` manual (`blind-hunter` + `verification-gap`, verificado: não existe workflow `push`/`pull_request` no repo pra nenhum pacote). Mesmo achado, mesma causa raiz das duas travas 409 que o `verification-gap` já tinha encontrado independentemente. Não é algo que este diff deveria resolver sozinho — é uma decisão de infraestrutura de CI do repo inteiro (hoje zero automação em push/PR pra qualquer pacote), fora do escopo desta spec pontual.
- **medium — deferido** — `table_removed` não trata a corrida entre terminais offline: terminal A remove uma mesa, terminal B (offline) abre uma comanda pra ela antes de sincronizar; depois do sync, a comanda referencia um `tableId` ausente de `tables`, sem nenhum comentário reconhecendo o caso (`edge-case-hunter`). Verificado: não quebra nem lança erro (nenhum código depende de `tables.get()` não-undefined nesse caminho; fallbacks `?? "—"`/`?? "mesa"` já cobrem o label), mas degrada silenciosamente. Mesma classe de trade-off arquitetural já registrada como deferida na spec de remoção de junção de mesas (`mergeWarnings`-style ainda não existe pra esse tipo de conflito) — resolver de verdade é trabalho de arquitetura novo, fora do escopo desta spec.
- **[3 achados — false, TOCTOU renomear-após-deletar-concorrente]** `edge-case-hunter` achou que as rotas de renomear (categoria/produto/mesa) checam existência, depois fazem `await readJsonBody(req)`, e só então gravam o evento sem reconferir — uma remoção concorrente na janela do `await` faria o rename "ter sucesso" (200) mas na verdade não fazer nada (a projeção ignora rename de entidade já removida). Verificado: esse exato formato (checar → `await` corpo → gravar, sem reconferir) já é o padrão em TODAS as rotas pré-existentes do arquivo que leem corpo (ex: `POST /products/:id/status`, já existia antes desta spec) — não é uma regressão introduzida aqui, é uma característica sistêmica do arquivo inteiro. Corrigir só as 6 rotas novas seria inconsistente com o resto; corrigir todas é auditoria fora do escopo desta spec.

Dois achados (medium, cobertura de CI e corrida multi-terminal) registrados em `deferred-work.md`.
