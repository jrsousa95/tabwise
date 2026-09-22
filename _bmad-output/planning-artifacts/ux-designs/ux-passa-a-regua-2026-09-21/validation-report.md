# Validation Report — Passa a Régua

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-passa-a-regua-2026-09-21/EXPERIENCE.md`
- **Run at:** 2026-09-22T12:02:08Z

## Overall verdict

Mecanicamente o par de spines está limpo: frontmatters resolvem, fontes existem, ordem de seção canônica, todas as referências `{token}` resolvem por nome. Como *contrato de build*, incompleto — 3 das 7 superfícies de IA (Cadastro de operador, Cardápio, Caixa) sem Key Flow nem State Pattern, e as três histórias de renomear/remover (2.8/3.4/3.5), adicionadas ao PRD um dia depois do spine ser travado `final`, sem nenhuma representação em EXPERIENCE.md. DESIGN.md também não define os pares `-dark` de três tokens de container já usados em produção.

A auditoria visual sobre o app real (segunda lente) é o achado mais acionável desta rodada: os 3 pontos que o dono levantou (botões desproporcionais, seções desalinhadas, espaço em branco) têm causa raiz conectada — botões de texto completo usados em colunas de tabela/grids estreitos quebram linha, e essa quebra é o que gera o desalinhamento visual reportado. O achado de maior impacto prático é `.app-content { max-width: 1024px }`, que contradiz o próprio texto do DESIGN.md sobre usar a largura total da tela e limita quantas mesas cabem numa sexta-feira lotada.

## Category verdicts
- Flow coverage — thin
- Token completeness — thin
- Component coverage — thin
- State coverage — thin
- Visual reference coverage — strong
- Bloat & overspecification — adequate
- Inheritance discipline — adequate
- Shape fit — strong

## Findings by severity

### Critical (3)

**Flow coverage** — Épico 1 (Autenticação/Operadores) sem Key Flow — auditoria de cancelamento nunca vira tela (EXPERIENCE.md, ausente)
A história 1.3 ("ver quem cancelou um item, quando e por quê") não aparece em nenhuma superfície de IA, Component Pattern, State Pattern ou Flow.
Fix: adicionar superfície de IA + Key Flow/State Pattern pro dono revisando o log de auditoria.

**Token completeness** — Faltam os pares `-dark` de success/warning/danger-container (DESIGN.md linhas 22-47)
Esses três tokens alimentam `status-badge-*` e `merge-warning-banner`, presentes em toda tela.
Fix: adicionar `success-container-dark`, `warning-container-dark`, `danger-container-dark`.

**State coverage** — Cadastro de operador, Cardápio e Caixa sem nenhum State Pattern (EXPERIENCE.md — 3 das 7 superfícies)
Nenhum estado vazio/cold-load/erro/validação especificado, incluindo PIN único por estabelecimento (PRD 1.1) e "nenhuma comanda fechada ainda" (PRD 6.1).
Fix: adicionar ao menos um estado vazio/erro por superfície.

### High (7)

**Flow coverage** — Cardápio, Caixa e Cadastro de operador sem nenhum Key Flow (EXPERIENCE.md linhas 26, 29, 30)
Fix: adicionar ao menos um flow ancorado no dono.

**Flow coverage** — Limite de comandas do plano (freemium) só como State, nunca dramatizado como Flow (EXPERIENCE.md linha 72)
Fix: dobrar num flow existente ou adicionar um flow curto.

**Component coverage** — `inline-form` tem regra comportamental mas nenhuma especificação visual (EXPERIENCE.md linha 61)
Fix: adicionar linha `inline-form` em DESIGN.md.Components.

**State coverage** — Comanda (detalhe) sem nenhum State Pattern, apesar de ser uma das telas mais usadas (EXPERIENCE.md — ausente)
Fix: adicionar State Patterns pra comanda fechada/imutável, split divergente, comanda vazia.

**State coverage** — Estados de bloqueio de 2.8/3.4/3.5 sem nenhum State Pattern (EXPERIENCE.md — ausente)
Fix: mesma remediação do gap de atualidade em Flow coverage.

**Auditoria visual** — Três botões de texto completo empilhados por linha de produto — pior caso de desproporção (catalog.tsx:334-344 · app.css:538-561)
`.button-secondary` herda padding 12px/24px + min-height 48px; três empilhados numa célula estreita levam a linha do produto a ~170px de altura.
Fix: variante compacta 48×48 com ícone (SVG/glifo, sem lib nova) + `aria-label`.

**Auditoria visual** — "Abrir comanda" quebra em duas linhas dentro do table-tile (table-map.tsx:180-182 · app.css:587-591, 647-651)
Grid de 170px + padding do botão não cabem o texto numa linha; quase dobra a altura do botão.
Fix: grid `minmax(200px, 1fr)` + padding reduzido do botão primário nesse contexto.

**Auditoria visual** — Desalinhamento vertical de linha inteira na tabela de produtos (app.css:549)
Consequência direta do achado de botões — "Nome" quebra em 3 linhas enquanto as demais colunas ficam em 1.
Fix: mesmo fix do achado de botões de linha de tabela — resolve os dois juntos.

**Auditoria visual** — `.app-content { max-width: 1024px }` contradiz o DESIGN.md e limita quantas mesas cabem na tela (app.css:379-385)
272px de vazio de cada lado numa tela de 1568px; contradiz "layout em largura total... uma tela de PDV se beneficia de mostrar mais mesas de uma vez".
Fix: aumentar/remover `max-width` de `.app-content` nas telas de grid/lista densa.

### Medium (9)

**Flow coverage** — Histórias novas 2.8/3.4/3.5 sem nenhuma menção — gap de atualidade (EXPERIENCE.md `updated: 2026-09-21` vs. PRD 2026-09-22)
Fix: ressincronizar o spine contra o PRD atual.

**Component coverage** — `button-primary`/`button-secondary` sem nenhuma regra comportamental (DESIGN.md linhas 96-108, 194-195)
Fix: adicionar linha de Component Patterns pra botões.

**Component coverage** — `table-tile`: EXPERIENCE.md afirma "mínimo 96×96px", DESIGN.md só define altura (EXPERIENCE.md linha 57; DESIGN.md linha 119)
Fix: adicionar `minWidth: '96px'` ao token, ou suavizar a afirmação.

**Auditoria visual** — Ação principal e ações administrativas com o mesmo peso visual no table-tile (app.css:647-651)
Fix: variante compacta/ícone em "Renomear"/"Remover" dentro do tile.

**Auditoria visual** — Cadastrar operador: título à esquerda, formulário centralizado numa caixa mais estreita (operator-registration.tsx:84-88 · app.css:390-398, 465-472)
Fix: remover `max-width` próprio de `.operator-form`, ou aplicá-lo também ao `h1`.

**Auditoria visual** — Pareamento: parágrafos centralizados por herança, headings à esquerda (app.css — `.container` + `h1,h2`)
Fix: mover `text-align: center` só pra tela de Login; demais rotas com `.container` ficam à esquerda por padrão.

**Auditoria visual** — Botão desabilitado perde contraste em dark mode (app.css:232-235)
Só `opacity: 0.5`; no tema escuro o botão ainda lê como clicável.
Fix: regra própria pra `.button-primary:disabled` trocando cor de fundo nos dois temas.

**Auditoria visual** — Nav do header sem regra responsiva abaixo de 768px (app.css:300-308, 783-792)
Achado por leitura de CSS, não confirmado por screenshot nesta sessão. Já antecipado no próprio EXPERIENCE.md.
Fix: confirmar com screenshot; colapsar em menu compacto se confirmado.

### Low (7)

**Token completeness** — `spacing.2/6/7` definidos mas nunca referenciados (DESIGN.md linhas 87, 91, 92)
Fix: referenciar ou remover.

**Component coverage** — `catalog-table`/`pin-pad` citados mas nunca formalmente spec'ados (DESIGN.md linha 180 / EXPERIENCE.md linha 90)
Fix: dar linhas próprias ou declarar explicitamente retrofit-only.

**Flow coverage** — Protagonista do Flow 3 sem nome, diferente dos Flows 1 e 2 (EXPERIENCE.md linha 135)
Fix: nomear a persona do dono, ou anotar omissão intencional.

**Inheritance discipline** — "Dono/Gerente" encurtado pra "Dono", não-verbatim (EXPERIENCE.md — tabela de IA, Key Flow 3)
Fix: normalizar se herança verbatim estrita importar downstream.

**Auditoria visual** — Mapa de Mesas com poucas mesas: grid não preenche, resto da tela vazio (table-map.tsx:226)
Fix: bloco tracejado "+ Cadastrar mais mesas" quando há poucas mesas.

**Auditoria visual** — Login/pin-pad: ~90% da tela vazio mesmo no uso real (app.css:421-430; login.tsx:72)
Não é necessariamente errado (minimalismo válido); não é prioridade alta.
Fix (se endereçado): reduzir padding vertical do container no login; considerar aumentar levemente pin-key/gap.

**Auditoria visual** — Placeholder cortado no formulário "Cadastrar mesa" (app.css:488-494)
Fix: `.inline-form input { flex: 1; min-width: 200px; }`

**Auditoria visual** — Coluna fantasma no cabeçalho da tabela de itens da Comanda (order.tsx:109-153)
Invisível hoje (comanda de teste vazia); mesmo padrão do achado de `catalog-table` vai se repetir com itens reais.
Fix: preventivo — mesma variante compacta de botão de linha de tabela.

## Reviewer files
- `review-rubric.md`
- `review-visual-audit.md`
