# Auditoria visual — Passa a Régua (2026-09-22)

Feita sobre o app real rodando em `http://localhost:1420` (Vite dev server), logado como dono via PIN `1234`. Telas visitadas com screenshot: **Login (pin-pad)**, **Mapa de Mesas** (estado com 1 mesa livre), **Comanda** (`/orders/:id`, comanda avulsa criada só pra visualizar a tela, não fechada/mutada), **Caixa** (`/cash-register`), **Cardápio** (`/catalog`, topo + lista de produtos), **Cadastrar operador** (`/operators/new`), **Pareamento** (`/pairing`). Mapa de Mesas e Cardápio também capturados em **modo escuro** (dark mode simulado injetando os tokens `-dark` exatos de `app.css` como `:root` override — os mesmos valores que `@media (prefers-color-scheme: dark)` aplicaria, então visualmente idêntico ao dark mode real). Não consegui redimensionar a janela do browser abaixo de ~1470px de viewport real (a API de resize não afetou `window.innerWidth` na sessão), então os achados de responsivo abaixo de 1024px vêm da leitura direta do CSS (`@media (max-width: 767px)` em `app.css`), não de screenshot — sinalizado onde relevante.

Todos os achados abaixo citam a classe CSS exata (`apps/desktop/src/app.css`) e o componente React exato (`apps/desktop/src/routes/*.tsx` ou `layout.tsx`) por trás do que foi visto.

---

## 1. Botões grandes/desproporcionais (ponto 1 do dono)

### 1.1 `catalog-table` — três botões empilhados por linha de produto é o pior caso do app

Tela: **Cardápio** → lista de produtos (`catalog.tsx` linhas 334-344, `.catalog-table` em `app.css` linhas 538-561).

Cada linha de produto termina numa célula com três `<button className="button-secondary">` ("Desativar", "Renomear", "Remover") separados só por `{" "}` no JSX. `.button-secondary` não define largura própria — herda do seletor `button` genérico (`app.css` 215-226): `padding: var(--spacing-3) var(--spacing-5)` (12px/24px), `font-size: 16px`, `font-weight: 600`, `min-height: 48px`. Como são `<button>` (inline-block por padrão) numa célula de largura limitada pelas outras 4 colunas da tabela, eles não cabem lado a lado e quebram linha como texto — três botões de 48px+ de altura cada, empilhados, fazem a linha do produto passar de ~170px de altura só pela coluna de ações, enquanto o conteúdo real (nome, categoria, preço, badge) ocupa uma única linha de 16-20px. Vi isso na screenshot: "Coca-Cola Lata" — uma linha de tabela — ocupa quase 1/6 da altura visível da tela inteira.

Pior: isso empurra a coluna "Nome" a também quebrar em 3 linhas ("Coca-", "Cola", "Lata") porque a largura disponível pra ela encolheu pra dar espaço à coluna de ações — ou seja, o mesmo bug de botão gera o problema de alinhamento do ponto 2 (ver 2.1).

Isso é exatamente o caso que `DESIGN.md` linha 180 já citava como problema a resolver ("hoje várias telas (ex: `catalog-table`, `pin-pad`) não garantem [o piso de 48px] explicitamente") — mas a implementação resolveu isso aplicando o **botão de texto completo** (o mesmo `button-secondary` usado em qualquer outro lugar do app) em vez de um botão compacto que só *atinja* o piso de 48px sem exceder o necessário.

**Fix concreto**: criar uma variante compacta pra ações de linha de tabela — um botão quadrado 48×48 (exatamente `--spacing-touch-target-min`, nem mais nem menos) com ícone (inline SVG de 20px ou glifo Unicode) no lugar do rótulo de texto, com `aria-label` pro nome da ação:

```css
.row-action-button {
  width: var(--spacing-touch-target-min);   /* 48px, não auto */
  height: var(--spacing-touch-target-min);
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
```

Ícones sem lib (nenhuma dependência nova): ✎ (renomear), 🗑 ou ✕ (remover), ⏻ ou um SVG de "olho fechado" (desativar/ativar) — ou, mais alinhado ao tom "industrial, sem decoração" do `DESIGN.md`, um SVG de traço único (stroke, sem preenchimento, `currentColor`) de 20×20 em vez de emoji colorido. Três desses lado a lado ficam em ~160px de largura total, cabendo numa única linha, e a altura da linha da tabela volta a ser ditada pelo texto (24-32px), não pelos botões.

### 1.2 `table-tile` — "Abrir comanda" quebra em duas linhas dentro do card

Tela: **Mapa de Mesas** (`table-map.tsx` linha 180-182, `.table-tile-grid` em `app.css` linha 587-591, `.table-tile-actions .button-primary` linha 647-651).

`.table-tile-grid` usa `grid-template-columns: repeat(auto-fill, minmax(170px, 1fr))` — cada tile pode ter só 170px de largura. Dentro dele, `.table-tile` tem `padding: var(--spacing-4)` (16px cada lado), sobrando ~138px de largura útil pro botão. O botão primário herda o padding genérico `var(--spacing-3) var(--spacing-5)` (12px/24px horizontal) com `font-size: 16px; font-weight: 600` — o texto "Abrir comanda" (13 caracteres, Inter 600) não cabe numa linha nesse espaço e quebra pra duas ("Abrir" / "comanda"), visto diretamente na screenshot. Isso quase dobra a altura do botão (de ~48px pra ~80px) e o deixa visualmente mais pesado que o próprio card ao redor — o card tem `min-height: 96px` mas com o botão de duas linhas + "Renomear"/"Remover" abaixo, o card real passa de 300px de altura, a maior parte disso sendo texto de botão quebrado, não informação.

**Fix concreto**: aumentar `.table-tile-grid` de `minmax(170px, 1fr)` pra `minmax(200px, 1fr)` E reduzir o padding horizontal do botão primário só nesse contexto:
```css
.table-tile-actions .button-primary {
  padding: var(--spacing-2) var(--spacing-4); /* 8px/16px em vez de 12px/24px */
}
```
Com 200px de tile e padding reduzido, "Abrir comanda" cabe numa linha (~150px necessários vs. ~168px disponíveis), o botão volta a ~48px de altura, e o card real fica muito mais próximo do `min-height: 96px` pretendido pelo `DESIGN.md.components.table-tile`.

### 1.3 Peso visual idêntico entre ação primária e ações secundárias no mesmo tile

Tela: **Mapa de Mesas**. `.table-tile-actions .button-primary` e `.table-tile-actions .button-secondary` (`app.css` 647-651) compartilham o mesmo `min-height: 48px` e o mesmo padding generoso — a única diferença visual é a cor de fundo. "Abrir comanda" (ação principal, única por tile) e "Renomear"/"Remover" (ações administrativas raras, só visíveis pro dono) ocupam a mesma altura e quase a mesma largura. Isso contraria o próprio `DESIGN.md` ("`button-primary` ... usado uma vez por tela como a ação principal óbvia") — aqui a hierarquia entre a ação principal e as administrativas fica achatada dentro do card porque ambas competem pelo mesmo tamanho.

**Fix**: aplicar a mesma variante compacta/ícone do item 1.1 em "Renomear" e "Remover" dentro do tile (são ações de dono, infrequentes, e já têm um rótulo textual redundante com o contexto — "editar mesa" e "excluir mesa" viram dois ícones pequenos no canto do card em vez de dois botões de largura total).

---

## 2. Seções desalinhadas (ponto 2 do dono)

### 2.1 `catalog-table`: quebra de "Nome" força desalinhamento vertical da linha inteira

Consequência direta do item 1.1: como a coluna de ações consome largura, "Coca-Cola Lata" quebra em 3 linhas enquanto "Categoria"/"Preço"/"Status" da mesma linha continuam em 1 linha só. `vertical-align: middle` (`app.css` linha 549) centraliza cada célula dentro da altura de linha resultante, então as células de uma coluna acabam com baselines diferentes das de outra — a badge "Ativo" e o preço "R$ 4,00" ficam visualmente "flutuando" no meio de uma linha muito mais alta que o necessário, descolados do texto do produto ao lado. Resolver 1.1 (compactar a coluna de ações) resolve este item junto, porque a coluna "Nome" para de precisar quebrar.

### 2.2 `Cadastrar operador`: título alinhado à esquerda, formulário centralizado num box mais estreito

Tela: **Cadastrar operador** (`/operators/new`). `operator-registration.tsx` linha 84-88: `<main className="container"><h1>...</h1> ... <form className="operator-form">`.

- `.container` (`app.css` 390-398): `max-width: 480px; padding: var(--spacing-7) var(--spacing-5)` (48px/24px) — vira uma caixa de 480px centralizada na viewport inteira (essa rota roda fora do `app-shell`/nav, então o `<body>` é a viewport toda). A área de conteúdo útil (descontando padding lateral de 24px cada lado) tem 432px.
- `h1, h2` (`app.css` 128-137) força `text-align: left` — então "Cadastrar operador" fica colado na borda esquerda dessa área de 432px.
- `.operator-form` (`app.css` 465-472) define seu **próprio** `max-width: 360px; margin: 0 auto` — uma caixa mais estreita, centralizada dentro dos 432px do pai.

Resultado: o título "Cadastrar operador" começa ~36px mais à esquerda do que os campos "Nome"/"Papel"/"PIN" abaixo dele (360px centralizado em 432px = ~36px de recuo de cada lado). Visualmente, o rótulo do formulário e o próprio formulário não compartilham a mesma margem esquerda — o olho espera que título e conteúdo comecem na mesma linha vertical, e aqui não começam. Confirmado na screenshot: o campo "Nome" (borda do input) começa visivelmente mais à direita que a letra "C" de "Cadastrar operador".

**Fix concreto**: tirar o `max-width`/`margin:auto` próprio de `.operator-form` e deixar que ele herde a largura total do `.container` (que já limita a leitura a 480px) — ou, se a intenção é uma coluna de formulário mais estreita que o título, aplicar esse mesmo `max-width: 360px` também ao `h1` e aos parágrafos irmãos dentro do `.container` nessa rota, não só ao `<form>`, pra manter uma margem esquerda comum.

### 2.3 `Pareamento`: parágrafos centralizados por herança, headings alinhados à esquerda — dois comportamentos de alinhamento na mesma tela

Tela: **Pareamento** (`/pairing`). Mesma estrutura `.container` do item 2.2, então o mesmo `text-align: center` do `.container` se aplica a tudo que não seja `h1`/`h2` (que forçam `left`). Os parágrafos de instrução ("Leia este código em um terminal novo...", "Os terminais se acham sozinhos na rede automaticamente...") ficam centralizados — confirmado na screenshot, onde o parágrafo de 2 linhas sobre mDNS tem bordas irregulares dos dois lados, um padrão ruim de legibilidade pra texto corrido (o olho perde a margem esquerda fixa que normalmente usa como âncora pra pular de linha em linha). Enquanto isso, os `h2` "Adotar código de outro terminal" / "Código deste terminal" / "Host manual (fallback)" ficam alinhados à esquerda, porque a regra `h1, h2 { text-align: left }` os tira do centro herdado. O resultado é uma tela em que os títulos de seção têm uma margem esquerda e os parágrafos abaixo deles têm outra (ou nenhuma, por estarem centralizados) — a mesma seção "desalinha" entre heading e corpo de texto.

**Fix concreto**: mover `text-align: center` de `.container` pra um elemento mais específico (ex.: só a tela de Login, que já é curta e majoritariamente números/botões centralizados por natureza) e dar às demais rotas que usam `.container` (Pareamento, Cadastro de operador) um `text-align: left` padrão — ou adicionar explicitamente `p { text-align: left }` dentro de `.container` como as regras de `h1`/`h2` já fazem, pra parar de depender de herança de centralização + exceções pontuais.

---

## 3. Espaço em branco excessivo (ponto 3 do dono)

### 3.1 Mapa de Mesas com poucas mesas: o grid não preenche, o resto da tela fica vazio

Tela: **Mapa de Mesas**, estado real do ambiente de dev (1 mesa cadastrada, "Mesa 1", livre). Confirmado por screenshot: o card de 170-200px de largura fica sozinho no canto superior esquerdo de uma viewport de 1568×759 — mais de 80% da área abaixo e à direita do card é `--color-surface` (#F6F6F6) liso, sem nada. Isso é esperado em parte (é um estado vazio, mesa única), mas a causa estrutural que agrava é dupla:
- `.table-tile-grid` usa `grid-template-columns: repeat(auto-fill, minmax(170px, 1fr))` — com 1 item, o grid só materializa 1 coluna de 170-200px; ele não tenta redistribuir o espaço sobrando de forma alguma (isso é o comportamento esperado de `auto-fill`, mas o efeito colateral é card minúsculo perdido num mar de cinza).
- Não há nenhum placeholder/texto orientando o "resto" da tela vazia (ex.: um hint discreto tipo "cadastre mais mesas pra ver o salão completo aqui") — o app só teria esse texto se `tables.length === 0` (`table-map.tsx` linha 226, `.catalog-empty`), não no caso "só uma mesa".

Isso é diretamente relevante à observação do dono: quem abre essa tela num bar pequeno recém-configurado (exatamente o estado real do ambiente de dev) vê uma tela quase inteiramente vazia, sem pista visual de que ali é onde 10-20 mesas vão aparecer conforme forem cadastradas.

**Fix concreto**: não é sobre encolher o card (ele já está no tamanho do design system) — é sobre não deixar a página tão vazia estruturalmente. Duas opções combináveis: (a) limitar a largura efetiva do `.table-tile-grid` a algo como `max-width: calc(var(--tile-count) * 220px)` não é prático em CSS puro sem JS, então a alternativa realista é (b) adicionar um estado intermediário — quando `tables.length > 0 && tables.length < 4` (ex.), mostrar um bloco discreto de mesma altura do tile mas tracejado ("+ Cadastrar mais mesas") ao lado do(s) tile(s) reais, ocupando visualmente o grid em vez de deixá-lo colapsar num canto.

### 3.2 Login/pin-pad: ~90% da tela é vazio mesmo no caso de uso real (tablet do garçom)

Tela: **Login**. `.container` (padding `var(--spacing-7) var(--spacing-5)` = 48px/24px) width 480px centralizado numa viewport de 1568×759 — o pin-pad inteiro (grid de `repeat(3, 72px)` + gaps de `--spacing-3` = 12px, total ~234px de largura, ~310px de altura com os labels acima) ocupa uma fração pequena do centro da tela, com toda a área ao redor (inclusive as laterais inteiras, ~640px de cada lado numa tela 1568px) em `--color-surface` liso. Isso é esperado pra uma tela de autenticação minimalista — mas o `EXPERIENCE.md` (Foundation) descreve o uso real como "tablet apoiado ou carregado pelo garçom... em pé e em movimento", ou seja, closer a uma tela 768-1024px, não 1568px — ainda assim, mesmo num tablet de 1024px, o pin-pad de 234px de largura deixa ~790px de vazio horizontal.

Isso por si não é necessariamente errado pra uma tela de PIN (foco/simplicidade é uma escolha de design válida), mas combinado com o vazio vertical adicional — `.pin-display` (linha 421-430) tem `min-height: 1.2em` e `margin: var(--spacing-4) 0 var(--spacing-5)` (16px/24px), ficando como uma faixa de ~88px de "nada" antes do primeiro dígito ser digitado, já que quando `pin.length === 0` ele renderiza um espaço em branco (`login.tsx` linha 72: `{"•".repeat(pin.length) || " "}`) — o efeito somado é uma tela que parece incompleta/quebrada num primeiro olhar, não deliberadamente minimalista.

**Fix concreto**: não é prioridade alta (tela de PIN minimalista é aceitável), mas se for endereçar: reduzir `.container` padding vertical de `--spacing-7` (48px) pra `--spacing-5` (24px) no login especificamente, e considerar aumentar o `pin-key` (hoje 72×72, já acima do piso) ou o gap entre teclas pra que o teclado ocupe proporcionalmente mais da área central, em vez de crescer o vazio ao redor.

### 3.3 `.app-content { max-width: 1024px }` deixa margens laterais fixas e simétricas em telas widescreen — na contramão do próprio `DESIGN.md`

Tela: qualquer tela autenticada (Mapa de Mesas, Caixa, Cardápio) em desktop widescreen. `.app-content` (`app.css` 379-385): `max-width: 1024px; margin: 0 auto`. Numa viewport de 1568px (comum em monitor de caixa/dono), isso deixa **272px de vazio de cada lado**, simétrico — quase 35% da largura da tela permanentemente ociosa. Isso contradiz o texto do próprio `DESIGN.md` (`## Layout & Spacing`): *"Layout de conteúdo em largura total até 1024px, sem coluna central estreita artificial — o app roda tanto em desktop quanto em tablet... e uma tela de PDV se beneficia de mostrar mais mesas/itens de uma vez, não de 'ler como um artigo'."* Um teto fixo de 1024px com `margin:auto` é exatamente uma "coluna central estreita" em qualquer tela mais larga que isso — o efeito prático é que no Mapa de Mesas, `table-tile-grid` (`minmax(170px,1fr)`, `auto-fill`) só consegue calcular colunas dentro desses 1024px (⁓5 colunas de 186px), quando a tela real (1568px) caberia ~8 colunas — ou seja, numa sexta-feira lotada com 20 mesas (cenário do Fluxo 1 do `EXPERIENCE.md`), o garçom vê 4 linhas de mesas com scroll, quando caberiam menos linhas sem scroll se o grid usasse a tela inteira.

**Fix concreto**: aumentar (ou remover) o `max-width` de `.app-content` especificamente pras telas de grid/lista densa (Mapa de Mesas, Cardápio) — por exemplo `max-width: 1440px` ou `max-width: none` com um `padding` lateral generoso em vez de um teto fixo — mantendo os 1024px só nas telas de formulário único onde uma coluna mais estreita ajuda a leitura (ex. não se aplica hoje porque essas já usam `.container`, não `.app-content`).

---

## 4. Outros achados (crítica geral de layout)

### 4.1 Placeholder cortado no formulário "Cadastrar mesa" — inputs sem largura mínima definida

Tela: **Mapa de Mesas**, `.inline-form` (`table-map.tsx` linha 140-149; `.inline-form` em `app.css` 488-494: `display:flex; gap; align-items:center; flex-wrap:wrap`, sem `flex` nos filhos). Visto na screenshot: o placeholder do primeiro input aparece cortado como "Identificador (ex: Mesa" (falta " 1)"). O input não tem `width`/`flex` definido, então usa a largura intrínseca padrão do browser (~20 caracteres), curta demais pro placeholder real. **Fix**: `.inline-form input { flex: 1; min-width: 200px; }`.

### 4.2 Estado "desabilitado" perde contraste em dark mode

Comparando a screenshot clara vs. a escura do mesmo botão "Adicionar" desabilitado (Mapa de Mesas / Cardápio): o app usa só `button:disabled { opacity: 0.5 }` (`app.css` 232-235) pra sinalizar desabilitado, sem trocar de cor base. Em modo claro, 50% de opacidade sobre `--color-primary` (#C2410C) sobre fundo claro produz um rosa-acastanhado claramente "apagado". Em modo escuro, a mesma opacidade de 50% sobre `--color-primary-dark` (#F0793D, mais claro/saturado por design, ver `DESIGN.md` §Colors) sobre fundo quase preto ainda lê como um botão laranja sólido e convidativo ao toque — o sinal de "não clicável" é bem mais fraco no tema escuro. **Fix**: pra estados desabilitados de `.button-primary`, usar uma regra própria em vez de só opacidade — ex. trocar pra `background: var(--color-surface-container-high); color: var(--color-on-surface-variant);` (cinza neutro) nos dois temas, que comunica "inativo" sem depender de o usuário perceber uma sutil diferença de saturação.

### 4.3 Cabeçalho da tabela de itens da Comanda não reserva espaço pra badge/coluna vazia

Tela: **Comanda** (`order.tsx` linha 109-153). A `<table className="catalog-table">` tem uma 5ª coluna sem `<th>` de texto (só pro botão "Cancelar" por item) — como a comanda de teste está vazia ("Nenhum item lançado ainda", célula `colSpan={5}` centralizada), essa coluna fantasma não é visível agora, mas o cabeçalho "Item / Qtd / Preço un. / Subtotal" com uma 5ª célula vazia ao lado do "Subtotal" deixa a última coluna do cabeçalho desalinhada com qualquer conteúdo futuro — o mesmo padrão do `catalog-table` (item 1.1/2.1) se repetirá aqui assim que a comanda tiver itens e algum operador com permissão de cancelar, porque o botão "Cancelar" é outro `button-secondary` de largura total dentro de uma célula de tabela.

### 4.4 Responsivo abaixo de 768px — achado só por leitura de CSS (não pude reproduzir viewport estreito no browser desta sessão)

`app.css` linhas 783-792, único bloco `@media (max-width: 767px)` do arquivo: só trata `.inline-form` (empilha) e `.container` (reduz padding). Não há nenhuma regra pra `.app-nav` (a nav com 5 links + marca + operador + status do sidecar, tudo num único `flex-wrap: wrap`, `app.css` 300-308) — o próprio `EXPERIENCE.md` (`## Responsive & Platform`) já sinaliza essa lacuna: *"nav do header pode precisar de um menu compacto... avaliar colapsar em menu na implementação"* — e a implementação atual não fez isso: com 5 links de dono + marca + nome do operador + botão Sair + status do sidecar todos competindo pelo mesmo `flex-wrap` numa tela de 375-767px, a nav provavelmente quebra em 3-4 linhas empilhadas, consumindo uma fatia desproporcional da tela vertical num tablet em retrato antes mesmo do conteúdo começar. Recomendo confirmar isso com uma screenshot real assim que for possível redimensionar a janela do browser (não foi possível nesta sessão), mas o gap no CSS é concreto e verificável só de leitura.
