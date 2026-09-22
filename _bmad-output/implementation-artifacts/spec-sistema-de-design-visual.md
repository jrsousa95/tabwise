---
title: 'Aplicar o sistema de design visual (DESIGN.md/EXPERIENCE.md) no frontend'
type: 'refactor'
created: '2026-09-21'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ec862a359da57a4ca27027d69cb450974ce8c881'
context:
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/desktop/src/app.css` ainda é o CSS padrão do template inicial do Tauri, estendido ad-hoc a cada tela (M2-M12) — sem paleta, escala tipográfica ou componentes coerentes; ainda carrega sobras nunca limpas (`.logo.vite:hover`, `.logo.react:hover`, `#greet-input`).

**Approach:** reescrever `app.css` como a implementação literal dos tokens de `DESIGN.md` (cores, tipografia, `rounded`, `spacing`, `components`), e atualizar cada tela/componente pra usar as novas classes — com destaque pro grid `table-tile` substituindo a lista de mesas, conforme `EXPERIENCE.md`.

## Boundaries & Constraints

**Always:** manter toda a lógica de negócio, chamadas de API, rotas e nomes de função intactos — é só repaginação visual. Todo elemento clicável com altura/largura mínima 48px (`--spacing-touch-target-min`). Dark mode via tokens próprios (`prefers-color-scheme` + seletor `data-theme` se já existir um toggle — não há um hoje, então só `@media`). Reaproveitar as cores de status já existentes (`sidecar-status-ok/down`, `merge-warning-banner`) migradas pros novos tokens semânticos (`--color-success`/`--color-warning`/`--color-danger`), não recriadas do zero.

**Never:** mudar comportamento, validação, ou payload de nenhuma chamada à API do sidecar. Adicionar dependência nova (sem framework de UI, sem biblioteca de ícone) — CSS puro, como já é. Remover nenhuma classe sem antes achar todos os usos (`grep`) e migrá-los.

</frozen-after-approval>

## Code Map

- `apps/desktop/src/app.css` -- reescrever por completo como as variáveis CSS (`:root`) dos tokens do DESIGN.md + classes de componente; remover `.logo.*`, `#greet-input`.
- `apps/desktop/src/layout.tsx` -- nav do header; usar `nav-link`/`button-secondary` atualizados; `merge-warning-banner` herda paleta `warning`.
- `apps/desktop/src/routes/login.tsx` -- `pin-pad`/`pin-key` (72px mínimo), `pin-display`.
- `apps/desktop/src/routes/operator-registration.tsx` -- `operator-form` com novo espaçamento/inputs.
- `apps/desktop/src/routes/table-map.tsx` -- **maior mudança**: substituir a `<table className="catalog-table">` de mesas (linhas ~136-193) por um grid de `table-tile` (`table-tile-free`/`table-tile-occupied`); manter toda a lógica (`orderForTable`, `TransferControl`, seleção de grupo) — só a marcação/CSS mudam. Demais seções (junção, avulsas) usam os componentes já existentes com novas classes.
- `apps/desktop/src/routes/order.tsx` -- tabela de itens com novas classes; `subtotal`/total em `typography.display`/tabular figures.
- `apps/desktop/src/order-closing.tsx` -- indicador falta/sobra (linha ~194) ganha `body-strong` + cor semântica (danger se falta, warning se sobra, success se bate).
- `apps/desktop/src/routes/cash-register.tsx` -- valores monetários com tabular figures; `status-badge` pra comandas pendentes.
- `apps/desktop/src/routes/catalog.tsx` -- `catalog-table`/formulários com novas classes; `status-badge` pra produto ativo/inativo.
- `apps/desktop/src/routes/pairing.tsx` -- `status-badge` pro status de nuvem (conectado/bloqueado).
- `apps/desktop/src/product-search.tsx` -- lista de resultado com novo espaçamento/alvo de toque.

## Tasks & Acceptance

**Execution:**
- [x] `apps/desktop/src/app.css` -- reescrever com `:root` (tokens claros) + bloco `@media (prefers-color-scheme: dark)` (tokens escuros) + classes de componente (`.button-primary`, `.button-secondary`, `.pin-key`, `.table-tile*`, `.status-badge*`), remover sobras do template Tauri -- fundação de tudo que segue
- [x] `apps/desktop/src/routes/table-map.tsx` -- grid `table-tile` no lugar da tabela de mesas -- é o componente mais citado no EXPERIENCE.md, maior ganho visual
- [x] `apps/desktop/src/layout.tsx`, `login.tsx`, `operator-registration.tsx` -- aplicar novas classes -- telas de entrada, primeira impressão do novo visual
- [x] `apps/desktop/src/routes/order.tsx`, `order-closing.tsx`, `product-search.tsx` -- aplicar novas classes + destaque no indicador falta/sobra -- fluxo de maior pressão de tempo (Marina, EXPERIENCE.md Fluxo 2)
- [x] `apps/desktop/src/routes/cash-register.tsx`, `catalog.tsx`, `pairing.tsx` -- aplicar novas classes -- telas restantes

**Acceptance Criteria:**
- Given o app rodando, when qualquer tela carrega, then nenhuma classe CSS órfã aparece no console e nenhum elemento visual quebra (sem `border: none` acidental, sem texto sobreposto)
- Given o mapa de mesas, when uma mesa tem comanda aberta, then o `table-tile` correspondente usa `--color-primary-container`/`--color-primary` (não neutro)
- Given o modo escuro do SO ativado, when qualquer tela é aberta, then todo texto mantém contraste legível (nada de texto escuro sobre fundo escuro)
- Given qualquer botão/linha clicável, when medido, then altura ou largura ≥ 48px

## Verification

**Commands:**
- `cd apps/desktop && npx tsc --noEmit` -- expected: sem erros
- `cd apps/desktop && npm run build` -- expected: build limpo (confirma que nenhuma classe/import quebrou)

**Manual checks (if no CLI):**
- Abrir cada uma das 7 telas via `claude-in-chrome` contra o Vite local (claro e escuro), conferir visualmente contraste, alvo de toque e o grid de mesas.

## Implementation Notes

- DESIGN.md não define tokens `-container` de dark mode pra success/warning/danger (só pra `primary`) — derivados seguindo o mesmo padrão do par `primary-container-dark`/`on-primary-container-dark` fornecido, contraste conferido ≥5.9:1 (AA) contra o foreground pareado. Marcado `[ASSUMPTION]` em comentário CSS.
- Verificação visual feita contra a sessão `tauri dev` já em execução do usuário (porta 4550/1420) — só leitura de dados de teste já existentes (comandas abertas criadas anteriormente pelo próprio usuário), nenhuma ação mutante (fechar comanda, criar operador) foi disparada. Confirmado depois: mesmo PID/`startedAt` do sidecar, nenhuma comanda fechada nova, nenhum operador novo.
- Nav do header em `<768px` só empilha `inline-form`s verticalmente (já coberto por CSS); o menu compacto/hambúrguer citado como "avaliar" em EXPERIENCE.md não foi construído (seria adição de comportamento, fora do escopo "só visual" desta spec).
- Achado fora de escopo, não corrigido: `cash-register.tsx`'s `orderLabel` gera "Mesa Mesa 7" (palavra duplicada) pra comandas de mesa — bug de dado/label pré-existente, não uma regressão desta spec.

## Review Triage Log

Três camadas rodaram em paralelo sobre o diff (`blind-hunter`, `edge-case-hunter`, `verification-gap`). `verification-gap`: zero achados (frontend nunca teve infra de teste — pré-existente, não causado por este diff). Achados de `blind-hunter`/`edge-case-hunter`, verificados um a um contra o código real:

- **false** — Nenhuma variante `.button-danger` pra "Confirmar cancelamento"/"Remover". Refutado: `DESIGN.md`.Colors já diz explicitamente que cancelar item não deve usar vermelho ("essa ação já tem sua própria fricção — motivo obrigatório — não precisa também de vermelho"). Decisão de design deliberada, não lacuna.
- **false** — `--color-success/warning/danger` não têm par `on-*-container` (assimetria com `primary`). Refutado: conferi o par fg/bg real de cada badge nos dois temas (ex: claro `#1f7a46` sobre `#e1f3e8`; escuro `#6fcf97` sobre `#14432a`) — contraste alto em todos, sem problema de leitura. É só inconsistência de nomenclatura, sem dano funcional.
- **false** — `h1`/`h2` com estilo idêntico, sem hierarquia. Refutado: `h1` só aparece no login (nome do produto) e `h2` só como título de cada rota — nunca coexistem na mesma tela nesta aplicação, então a "falta de hierarquia" nunca é observável na prática.
- **defer** — conversão da tabela de mesas pra `table-tile-grid` (`&lt;div&gt;`s) perde semântica de tabela pra leitor de tela. Real, mas a correção exige escolher um padrão ARIA (grid? lista? landmark por tile?) — decisão de UX própria, não uma correção direta. Registrado em `deferred-work.md`.
- **patch** — `catalog.tsx` (produto inativo) e `pairing.tsx` ("conectando...") usam `status-badge-warning` pra um estado neutro/em progresso, não um aviso de verdade — mina o princípio de "cor como sinal" do `DESIGN.md`. Corrigido: nova variante `status-badge-neutral`.
- **patch** — comentário de `table-tile` em `table-map.tsx` diz "blocos tocáveis" mas só o botão/checkbox interno reage a toque, não o bloco inteiro. Adicionar toque no bloco inteiro mudaria comportamento (fora do "Never" desta spec) — corrigido só o texto do comentário pra não prometer mais do que existe.
- **patch** — `.table-tile-occupied .button-secondary:hover` usa `rgba(0,0,0,0.06)` sem variante pro modo escuro — quase invisível sobre o container escuro (`#7a290a`). Corrigido com um overlay claro (`rgba(255,255,255,0.08)`) sob `@media (prefers-color-scheme: dark)`.
- **patch** — `.catalog-list li` tem `min-height: 48px`, mas o `&lt;a&gt;` interno (o alvo de toque de verdade) só ocupa a altura do texto — toque na área vazia da linha não ativa o link. Afeta os links de comanda em `cash-register.tsx`/`table-map.tsx`. Corrigido esticando o `&lt;a&gt;` pra preencher a linha.
- **patch** — `.button-secondary` não tem estado `:active` (só `.button-primary` tem) — botão secundário não dá feedback visual de "pressionado". Corrigido com uma regra `:active` própria.
- **patch** — `a:focus-visible` não existe (só `input`/`select`/`button`) — links caem no anel de foco padrão do navegador, inconsistente com o resto do sistema. Corrigido incluindo `a` no seletor existente.
- **patch** — texto de status dinâmico em `pairing.tsx` ("conectando..."/"conectado"/"bloqueado") sem `aria-live`/`role="status"` — leitor de tela não anuncia a mudança. Corrigido com `role="status"` no parágrafo.
- **patch** — `.tap-area` em `table-map.tsx` tem `title` e `aria-label` redundantes (mesmo texto); `title` não é alcançável em toque (só hover). Removido o `title` — o `aria-label` já cobre acessibilidade.
