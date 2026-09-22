---
title: 'Corrigir achados de alto/médio impacto da auditoria visual (2026-09-22)'
type: 'bugfix'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0c02cf73e634196696b0d27e58ad78c158d926ff'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/validation-report.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** uma auditoria visual sobre o app real (`validation-report.md`, 2026-09-22) achou que botões de texto completo usados em colunas de tabela estreitas e no grid de mesas quebram linha, inflando a altura de linhas/cards e causando o desalinhamento visual relatado pelo dono; `.app-content { max-width: 1024px }` deixa ~35% da tela ociosa em monitores largos, contradizendo o texto do próprio DESIGN.md sobre usar a largura total; e há desalinhamento de título/formulário em duas telas, contraste insuficiente de botão desabilitado no modo escuro, e um placeholder cortado.

**Approach:** são todas correções de CSS/markup que trazem a implementação de volta ao que o DESIGN.md já especifica — nenhuma mudança de tokens/paleta, nenhuma mudança de lógica de negócio. Ação de linha de tabela ganha uma variante compacta com ícone; grid de mesas e largura de conteúdo ganham mais espaço; duas telas ganham alinhamento consistente entre título e corpo.

## Boundaries & Constraints

**Always:** ícones novos são SVG inline (`stroke="currentColor"`, sem preenchimento, 20×20) ou glifo Unicode — nunca uma biblioteca de ícone nova. Toda ação de linha de tabela mantém `aria-label` com o nome da ação (perde o texto visível, não a acessibilidade). `.row-action-button` nunca fica menor que `--spacing-touch-target-min` (48px) em nenhuma dimensão.

**Never:** mudar qualquer valor de cor/token em DESIGN.md. Mudar comportamento de clique/desabilitado das ações (só a aparência). Tocar nos achados fora de escopo desta spec (nav responsiva abaixo de 768px, estados de tela vazia com poucos dados).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Linha de produto no cardápio | Tela carrega com produtos | 3 ícones de ação (Desativar/Ativar, Renomear, Remover) cabem numa linha, célula não quebra "Nome" mais | N/A |
| Lista de categorias | Tela carrega com categorias | 2 ícones de ação (Renomear, Remover) por item, sem quebra de linha | N/A |
| Table-tile no mapa de mesas | Mesa livre ou ocupada | "Abrir comanda" cabe numa linha; "Renomear"/"Remover" (dono) viram ícones compactos | N/A |
| Tela de Mapa de Mesas/Cardápio em monitor largo (>1024px) | Viewport ≥1440px | Grid usa a largura extra disponível, mais colunas visíveis sem scroll | N/A |
| Cadastrar operador | Tela carrega | Título e campos do formulário compartilham a mesma margem esquerda | N/A |
| Pareamento | Tela carrega | Títulos de seção e parágrafos de instrução compartilham a mesma margem esquerda | N/A |
| Login | Tela carrega | Continua centralizado (não afetado pela mudança de alinhamento das outras 2 telas) | N/A |
| Botão primário desabilitado, modo escuro | `prefers-color-scheme: dark`, botão com `disabled` | Cor de fundo neutra, visivelmente diferente do estado habilitado | N/A |
| Formulário "Cadastrar mesa" | Tela carrega | Placeholder "Identificador (ex: Mesa 1)" aparece completo, sem cortar | N/A |

</frozen-after-approval>

## Code Map

- `apps/desktop/src/app.css` — várias mudanças pontuais:
  - Nova classe `.row-action-button` (perto de `.button-secondary`, ~linha 258): `width`/`height: var(--spacing-touch-target-min)`, `padding: 0`, `display: inline-flex; align-items: center; justify-content: center`. Herda cor/borda de `.button-secondary` (aplicar como modificador, ex. `.button-secondary.row-action-button`, não uma cor nova).
  - `.table-tile-grid` (~linha 589): `minmax(170px, 1fr)` → `minmax(200px, 1fr)`.
  - `.table-tile-actions .button-primary` (~linha 647-651): reduzir padding horizontal só dentro desse contexto pra `var(--spacing-2) var(--spacing-4)` (seletor mais específico, não mudar `.button-primary` global).
  - `.app-content` (~linha 379-385): aumentar `max-width` (ex. `1440px`) ou remover, mantendo `padding` lateral. Único wrapper das telas autenticadas (Mapa de Mesas/Comanda/Caixa/Cardápio, ver `layout.tsx` linha 93) — mudança aqui não afeta `.container` (login/pareamento/cadastro, classe separada).
  - `.container` (~linha 390-398): remover `text-align: center` (herda `left` do body, sem regra — já é o padrão de `h1,h2`). Nova classe `.container-center` só com `text-align: center`, aplicada apenas em `login.tsx`.
  - `button:disabled`/`.button-primary` (~linha 232-235): adicionar regra própria pra `.button-primary:disabled` trocando `background`/`color` pra tokens neutros (`--color-surface-container-high`/`--color-on-surface-variant`) nos dois temas, mantendo `opacity` removida ou irrelevante nessa combinação.
  - `.inline-form` (~linha 488-494): adicionar `input { flex: 1; min-width: 200px; }` dentro da regra (afeta todo uso de `.inline-form`, não só "Cadastrar mesa" — intencional, mesma classe compartilhada).
- `apps/desktop/src/routes/catalog.tsx` — trocar os 3 botões de ação por linha de produto (~linha 316-326, "Desativar/Ativar"/"Renomear"/"Remover") e os 2 botões por categoria (~linha 229-236, "Renomear"/"Remover") pra `.button-secondary.row-action-button` com ícone (SVG inline ou glifo) + `aria-label` mantendo o texto da ação; remover o texto visível.
- `apps/desktop/src/routes/table-map.tsx` — trocar "Renomear"/"Remover" dentro do `table-tile` (~linha 187-195) pro mesmo padrão de ícone compacto; "Abrir comanda" (ação primária) mantém texto — só o padding do botão primário muda (via CSS acima), não vira ícone.
- `apps/desktop/src/routes/login.tsx` — trocar `className="container"` pra `className="container container-center"` nos 3 `<main>` (linhas 19, 27, 68).

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src/app.css` — `.row-action-button`, ajustes de `.table-tile-grid`/`.table-tile-actions`, `.app-content`, `.container`/`.container-center`, `.button-primary:disabled`, `.inline-form input` — fundação de todas as mudanças visuais
- [x] `apps/desktop/src/routes/catalog.tsx` — ícones compactos nas ações de categoria e produto -- resolve o pior caso de desproporção (achado de maior severidade da auditoria)
- [x] `apps/desktop/src/routes/table-map.tsx` — ícones compactos em Renomear/Remover do table-tile, botão "Abrir comanda" cabendo numa linha -- resolve o segundo pior caso
- [x] `apps/desktop/src/routes/login.tsx` — `container-center` -- mantém o login centralizado depois da mudança em `.container`

**Acceptance Criteria:**
- Given a tela de Cardápio com produtos cadastrados, when a lista carrega, then nenhuma linha de produto quebra o nome em múltiplas linhas por causa da coluna de ações
- Given o Mapa de Mesas, when um tile de mesa livre é renderizado, then o texto "Abrir comanda" aparece numa única linha
- Given qualquer tela autenticada (Mapa de Mesas, Comanda, Caixa, Cardápio), when a viewport é mais larga que 1024px, then o conteúdo usa mais do que 1024px de largura (não fica travado numa coluna central estreita)
- Given a tela de Cadastrar operador ou Pareamento, when a tela carrega, then o título e o conteúdo abaixo dele compartilham a mesma margem esquerda
- Given a tela de Login, when a tela carrega, then o conteúdo continua centralizado como antes
- Given um botão primário desabilitado, when o tema é escuro, then a cor de fundo é visivelmente diferente da versão habilitada (não só mais transparente)

## Implementation Notes

- Ícones (`PencilIcon`/`TrashIcon`/`PowerIcon`) implementados como SVG inline literal (`stroke="currentColor"`, sem `fill`, 20×20, `aria-hidden="true"`), duplicados em `catalog.tsx` e `table-map.tsx` em vez de extraídos pra um arquivo compartilhado — o Code Map só lista esses dois arquivos de rota pra editar, e nenhum arquivo de ícones/componentes novo estava previsto; a duplicação (dois componentes pequenos por arquivo) evita ampliar o escopo de arquivos tocados.
- Cada `.row-action-button` mantém `aria-label` igual ao texto da ação que existia antes (`"Renomear"`, `"Remover"`, `"Ativar"`/`"Desativar"`, conforme o estado), como o boundary pede literalmente ("aria-label com o nome da ação") — também adicionei `title` igual, pra um tooltip nativo no hover como pista visual extra (não pedido pela spec, mas não conflita com nenhum boundary).
- **Desvio pontual do Code Map, necessário pra bater a Acceptance Criteria:** além das mudanças de CSS listadas no Code Map, troquei `.operator-form { margin: 0 auto; }` por `margin: 0;` (mesma regra, ~linha 465 de `app.css`). Sem isso, remover só `text-align: center` de `.container` não alinha "Cadastrar operador": o `h1` (sem `max-width`) já ficava à esquerda, mas `.operator-form` (com `max-width: 360px` e `margin: 0 auto`) continuava se autocentralizando dentro do `.container` mais largo (480px), criando um offset de ~36px entre o título e o formulário — exatamente o achado descrito na Intent e cobrado pela Acceptance Criteria ("título e conteúdo abaixo dele compartilham a mesma margem esquerda"). `Pairing.tsx` não usa `.operator-form` (só `<p>`/`<div>` soltos), então pra essa tela a remoção do `text-align: center` do `.container` já foi suficiente. Nenhum token/cor mudou, é só a direção do `margin`.
- `.app-content` foi pra `1440px` (a spec sugeria "ex. 1440px") em vez de removido de vez — mantém uma trava superior sensata pra monitores ultrawide sem recriar a coluna estreita de 1024px.
- Não toquei em `TransferControl` ("Ver comanda"/"Transferir", dentro do tile de mesa ocupada) — fora do Code Map (que só cobre as ações "Renomear"/"Remover" do bloco administrativo do tile) e fora do escopo da spec.
- **Reverificado por mim (coordenador), não só o relatório do subagente:** conferi o diff completo contra o baseline, rodei `tsc --noEmit` de novo, e abri o app de verdade no navegador pra confirmar visualmente cada critério de aceite — Cardápio (o próprio "Coca-Cola Lata" citado pela auditoria agora cabe numa linha com 3 ícones), Mapa de Mesas ("Abrir comanda" numa linha, ícones compactos), Cadastrar operador e Pareamento (título/corpo com a mesma margem esquerda, confirmado visualmente), Login (continua centralizado). Todos batem.
- **Investiguei o "bug" que o subagente relatou** (`DELETE /products/:id` devolvendo 404 pra um produto real, criado durante o teste manual dele): reproduzi contra a sessão viva (porta 4550) e a mensagem de erro veio como `"not found"` genérico — não a mensagem específica da rota (`"produto não encontrado"`) — sinal de que a requisição nem bateu na rota nova. Confirmado via `GET /health`: o sidecar vivo estava rodando desde `2026-09-22T02:57:13Z` (mesmo PID de sempre), ou seja, antes de TODAS as mudanças de sidecar de hoje (junção removida, renomear/remover, aviso de mesclagem) — não era um bug de código, era a limitação já conhecida de hot-reload do sidecar.
- **Achado real após o usuário restaurar `tauri dev` e o problema persistir:** o restart não bastou — o sidecar antigo (PID 15239) tinha ficado **órfão** ao encerrar a sessão anterior, continuou de pé e segurou a porta 4550, então o app seguiu falando com o processo velho mesmo depois do restart. Encerrado o PID órfão (confirmado com o usuário antes) e pedido um segundo restart — aí sim o sidecar novo subiu e tudo (incluindo `DELETE /products/:id`) passou a funcionar.
- **Achado real de layout, via screenshots do usuário pós-restart:** no formulário de renomear mesa (dentro do `table-tile`), "Salvar"/"Cancelar" tinham larguras diferentes (cada botão do tamanho do próprio texto) — lia como desalinhado/tamanhos inconsistentes, mesmo já com os ícones compactos no lugar certo. Corrigido: `form.table-tile-actions input, form.table-tile-actions button { width: 100%; }` — como o tile já quebra cada item pra sua própria linha (estreito demais pra ficarem lado a lado), esticar todos pra largura total do tile alinha input/Salvar/Cancelar com "Abrir comanda" acima. Confirmado visualmente no navegador depois do fix.
- **Achado real de layout, via screenshot do usuário — mesa ocupada:** o `TransferControl` ("Ver comanda" + `<select>` "Transferir para..." + "Transferir") nunca tinha sido tocado por esta spec (documentado acima como fora do Code Map) — mas é a mesma classe de problema: `.transfer-control` era `inline-flex` sem largura própria pros filhos, então o `<select>` ficava minúsculo (largura intrínseca do conteúdo) ao lado dos botões, que também não tinham largura consistente entre si. Corrigido com o mesmo padrão já usado no formulário de renomear: `.transfer-control` vira `flex-direction: column; width: 100%` e `.transfer-control > * { width: 100%; }` — os 3 itens (botão, select, botão) ficam com a mesma largura, empilhados. Não pude reverificar no navegador desta vez (extensão do Chrome desconectada no momento) — pedido ao usuário confirmar visualmente.

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: sem erros

**Manual checks (if no CLI):**
- Abrir o app (`localhost:1420`, sessão dev já rodando) e visualmente conferir: Cardápio (produtos com 3 ações não quebram mais linha), Mapa de Mesas (tile "Abrir comanda" numa linha, ações administrativas como ícone), Cadastrar operador e Pareamento (título/corpo alinhados), Login (continua centralizado), um botão desabilitado em modo claro e escuro lado a lado.
