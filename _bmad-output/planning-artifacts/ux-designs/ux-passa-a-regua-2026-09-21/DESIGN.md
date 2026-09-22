---
name: Passa a Régua
description: Sistema de PDV desktop para bares e restaurantes — mesas, comandas, cardápio e fechamento de caixa. Visual robusto/industrial, pensado pra ser tocado com pressa, em pé, muitas vezes com uma mão só.
status: final
updated: 2026-09-21
colors:
  # Claro
  surface: '#F6F6F6'
  surface-container-lowest: '#FFFFFF'
  surface-container: '#FFFFFF'
  surface-container-high: '#ECECEC'
  on-surface: '#1A1A1A'
  on-surface-variant: '#4A4A4A'
  outline: 'rgba(0, 0, 0, 0.16)'
  outline-variant: 'rgba(0, 0, 0, 0.08)'
  primary: '#C2410C'
  on-primary: '#FFFFFF'
  primary-container: '#FDE4D4'
  on-primary-container: '#7A290A'
  success: '#1F7A46'
  on-success: '#FFFFFF'
  success-container: '#E1F3E8'
  warning: '#946200'
  on-warning: '#FFFFFF'
  warning-container: '#FDF2E3'
  danger: '#B3261E'
  on-danger: '#FFFFFF'
  danger-container: '#FCE4E2'
  # Escuro (sufixo -dark)
  surface-dark: '#1B1B1B'
  surface-container-lowest-dark: '#141414'
  surface-container-dark: '#262626'
  surface-container-high-dark: '#323232'
  on-surface-dark: '#F2F2F2'
  on-surface-variant-dark: '#C7C7C7'
  outline-dark: 'rgba(255, 255, 255, 0.18)'
  outline-variant-dark: 'rgba(255, 255, 255, 0.09)'
  primary-dark: '#F0793D'
  on-primary-dark: '#3D1200'
  primary-container-dark: '#7A290A'
  on-primary-container-dark: '#FDE4D4'
  success-dark: '#6FCF97'
  on-success-dark: '#0C3B1F'
  warning-dark: '#F0B23D'
  on-warning-dark: '#3D2900'
  danger-dark: '#F2857D'
  on-danger-dark: '#4A0E0A'
typography:
  display:
    fontFamily: 'Inter'
    fontSize: 40px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: '-0.01em'
  heading:
    fontFamily: 'Inter'
    fontSize: 22px
    fontWeight: '700'
    lineHeight: '1.2'
  body:
    fontFamily: 'Inter'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-strong:
    fontFamily: 'Inter'
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.5'
  label:
    fontFamily: 'Inter'
    fontSize: 13px
    fontWeight: '600'
    lineHeight: '1.3'
    letterSpacing: '0.02em'
  mono:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
    fontSize: 13px
    fontWeight: '500'
rounded:
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  '7': 48px
  '8': 64px
  touch-target-min: 48px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.on-primary}'
    radius: '{rounded.md}'
    minHeight: '{spacing.touch-target-min}'
    padding: '{spacing.3} {spacing.5}'
    fontWeight: '{typography.body-strong.fontWeight}'
  button-secondary:
    background: 'transparent'
    foreground: '{colors.on-surface}'
    border: '1px solid {colors.outline}'
    radius: '{rounded.md}'
    minHeight: '{spacing.touch-target-min}'
  pin-key:
    background: '{colors.surface-container-lowest}'
    foreground: '{colors.on-surface}'
    radius: '{rounded.md}'
    minHeight: '72px'
    minWidth: '72px'
    fontFamily: '{typography.display.fontFamily}'
    fontSize: '28px'
  table-tile:
    radius: '{rounded.lg}'
    minHeight: '96px'
    padding: '{spacing.4}'
  table-tile-free:
    background: '{colors.surface-container-lowest}'
    border: '1px solid {colors.outline}'
  table-tile-occupied:
    background: '{colors.primary-container}'
    foreground: '{colors.on-primary-container}'
    border: '1px solid {colors.primary}'
  status-badge:
    radius: '{rounded.full}'
    padding: '{spacing.1} {spacing.3}'
    fontFamily: '{typography.label.fontFamily}'
  status-badge-success:
    background: '{colors.success-container}'
    foreground: '{colors.success}'
  status-badge-warning:
    background: '{colors.warning-container}'
    foreground: '{colors.warning}'
  status-badge-danger:
    background: '{colors.danger-container}'
    foreground: '{colors.danger}'
  merge-warning-banner:
    background: '{colors.warning-container}'
    foreground: '{colors.warning}'
    padding: '{spacing.3} {spacing.5}'
---

# Passa a Régua — Sistema de Design

> [ASSUMPTION] Valores exatos de cor/tipografia abaixo são uma proposta inicial de Sally, com base na direção "robusto/industrial pra PDV" escolhida e em continuidade com as poucas cores que já existiam no app antes deste sistema (`#2e8b57`/`#c0392b`/`#b8860b` do indicador de status do sidecar, a paleta do banner de merge, e a família Inter já usada). Ajuste livremente — nada aqui está travado.

## Brand & Style

Passa a Régua é uma ferramenta de trabalho, não um produto de vitrine. Quem olha pra tela está de pé, com uma bandeja numa mão, num salão barulhento, numa sexta-feira lotada — não navegando com calma num sofá. A postura visual é **industrial e direta**: contraste alto, alvos de toque generosos (mínimo 48px, `{spacing.touch-target-min}`), hierarquia visual óbvia à distância de um braço, zero decoração que não carregue informação.

A cor é usada como sinal, não como enfeite. Laranja-queimado (`{colors.primary}`) significa "isto é uma ação" — nunca aparece decorativamente. Verde/âmbar/vermelho seguem o vocabulário de semáforo que qualquer garçom já entende sem treinamento: mesa livre é neutra, mesa ocupada é a cor de marca, aviso é âmbar, erro é vermelho. Não há gradientes, sombras dramáticas ou tipografia decorativa — a única "personalidade" do produto é a confiança de que ele nunca engana o operador sobre o que está acontecendo.

## Colors

- **`{colors.primary}` (laranja-queimado)** — a única cor de marca. Usada em botões primários, item de navegação ativo, e no preenchimento de `table-tile-occupied` (mesa com comanda aberta — o estado mais importante do mapa de mesas, precisa saltar aos olhos). Nunca usada decorativamente.
- **`{colors.success}` / `{colors.warning}` / `{colors.danger}`** — vocabulário de status, reaproveitando as cores que já existiam no indicador "sidecar ok/offline" e no banner de merge antes deste sistema existir (continuidade deliberada, não reinvenção). Danger é reservado pra erro de verdade (`.form-error`, sidecar offline) — nunca usado pra cancelar item: essa ação já tem sua própria fricção (motivo obrigatório), não precisa também de vermelho.
- **`{colors.surface}` / `{colors.surface-container-*}`** — três níveis de elevação (fundo da página, cartão, cartão realçado) em vez de sombra — o app já não usava sombra nenhuma, e "robusto" pede superfícies planas e bem demarcadas por cor/borda, não por blur.
- **Modo escuro** — cada token de cor tem seu par `-dark`. Nenhum token é reaproveitado 1:1 entre os dois modos (nem mesmo `primary`): o laranja do modo escuro é mais claro (`#F0793D`) pra manter contraste AA sobre o fundo escuro, não é o mesmo laranja com opacidade reduzida. Essa é exatamente a armadilha que o bloco `@media (prefers-color-scheme: dark)` de antes deste sistema nunca resolveu — aqui cada token de cada modo é uma decisão própria, não uma variação automática da outra.

Evitar: mais de uma cor de marca; gradiente em qualquer superfície; laranja usado fora de "isto é uma ação/isto está ocupado"; texto cinza-sobre-cinza com contraste abaixo de AA (o app é usado sob luz de salão variável, nunca condição ideal de tela).

## Typography

Inter em todo o sistema (já era a fonte do app antes deste sistema — continuidade, sem custo de nova fonte). A escala é curta de propósito — cinco papéis, não uma escala editorial completa:

- **`{typography.display}`** — números que precisam ser lidos à distância ou com pressa: dígitos do PIN, número da mesa/comanda no mapa, o total da comanda na tela de fechamento. Peso 700, sem itálico, sem ornamento.
- **`{typography.heading}`** — título de cada tela ("Mapa de Mesas", "Cardápio").
- **`{typography.body}` / `{typography.body-strong}`** — texto corrido e ênfase (nome de produto, rótulo de campo preenchido).
- **`{typography.label}`** — rótulos pequenos, letter-spacing levemente aberto: nome de operador no cabeçalho, rótulo de formulário, texto de badge de status.
- **`{typography.mono}`** — só pro indicador técnico "sidecar ok/offline" (já era monoespaçado antes) — nunca aparece em conteúdo voltado ao operador.

Números monetários usam tabular figures (Inter já suporta) em qualquer lugar que uma coluna de valores apareça (fechamento de caixa, split de conta) — colunas de dígitos que não dançam ao trocar de valor.

## Layout & Spacing

Escala de `{spacing.1}` (4px) a `{spacing.8}` (64px), base 8, generosa nas margens entre alvos tocáveis — o objetivo declarado é errar o toque com menos frequência, não caber mais coisa na tela. `{spacing.touch-target-min}` (48px) é o piso de altura/largura de qualquer elemento clicável em qualquer tela, inclusive num teclado numérico ou linha de tabela com botão de ação — hoje várias telas (ex: `catalog-table`, `pin-pad`) não garantem isso explicitamente.

Layout de conteúdo em largura total até 1024px, sem coluna central estreita artificial — o app roda tanto em desktop quanto em tablet apoiado numa bancada, e uma tela de PDV se beneficia de mostrar mais mesas/itens de uma vez, não de "ler como um artigo".

## Elevation & Depth

Sem sombra como recurso visual. Hierarquia por cor de superfície (`surface` → `surface-container` → `surface-container-high`) e por borda (`{colors.outline}`), nunca por `box-shadow` — decisão consciente pra "robusto", não uma omissão: sombra sugere "isto flutua", e nada nesta interface deveria parecer flutuante ou temporário.

## Shapes

Cantos moderados (`{rounded.md}` = 10px na maioria dos componentes tocáveis, `{rounded.sm}` = 6px em inputs) — nem o quadrado cortante de um painel industrial de verdade (ficaria hostil ao toque), nem o arredondamento pesado de um app de consumo. `{rounded.full}` só em badges de status (pílula), nunca em botão de ação — botão de ação é retangular, para não ser confundido visualmente com um indicador passivo.

## Components

- **`button-primary`** — laranja de marca, altura mínima 48px, usado uma vez por tela como a ação principal óbvia (ex: "Fechar comanda", "Adicionar", "Entrar").
- **`button-secondary`** — contorno, sem preenchimento; ações secundárias/de cancelamento não-destrutivo.
- **`pin-key`** — tecla do teclado numérico de login: 72×72px mínimo (bem acima do piso de toque — é literalmente a primeira interação de cada turno, não pode falhar), dígito grande em `{typography.display}`.
- **`table-tile`** — substitui a lista/tabela atual de mesas por um grid de blocos tocáveis (ver Component Patterns no EXPERIENCE.md): `table-tile-free` (superfície neutra, borda fina) vs. `table-tile-occupied` (preenchido em `{colors.primary-container}`, borda `{colors.primary}`) — o estado "esta mesa tem comanda aberta" precisa ser reconhecível num relance do salão, não lido letra por letra.
- **`status-badge`** — pílula pequena, três variantes semânticas (success/warning/danger); usado pro indicador de sidecar, status de produto (ativo/inativo), e status de comanda.
- **`merge-warning-banner`** — já existia; herda a paleta `warning` deste sistema em vez da cor solta que tinha antes.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Usar `{colors.primary}` só pra "ação principal" e "mesa ocupada" | Usar laranja em chrome, ícone decorativo ou texto comum |
| Alvo de toque ≥ `{spacing.touch-target-min}` em toda superfície tocável | Botões/linhas de tabela com hitbox menor que 48px |
| Hierarquia por cor de superfície + borda | Sombra (`box-shadow`) como recurso de hierarquia |
| Tabular figures em toda coluna monetária | Números de valor em fonte proporcional numa tabela |
| Um único acento de marca | Segunda cor de marca "pra variar" |
| Dark mode com tokens próprios por papel | Dark mode por opacidade/filtro sobre as cores do modo claro |
