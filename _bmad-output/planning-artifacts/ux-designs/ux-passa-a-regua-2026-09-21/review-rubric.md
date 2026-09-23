# Spine Pair Review — Passa a Régua

## Overall verdict

O par não está pronto pra carregar o selo `status: final`. A forma está sólida — ordem canônica correta, sem inchaço, sem referência de token quebrada — mas o conteúdo ficou pra trás do produto real em dois pontos que um consumidor a jusante (arquitetura ou dev) bateria de frente imediatamente: a tela "Conflitos de Mesas" (ARCH §4.2, já implementada em `apps/desktop/src/routes/table-conflicts.tsx`) não existe em nenhuma das duas spines, e o DESIGN.md se contradiz sobre a própria cor de marca (ainda chama `{colors.primary}` de "laranja-queimado" na seção mais lida do documento, um parágrafo depois da Colors section documentar a troca pra borgonha). As histórias novas 2.8/3.4/3.5 (renomear/remover mesa/categoria/produto) também não deixaram rastro em nenhuma das duas spines, apesar de já implementadas com um padrão de componente repetido (ícones de editar/remover em linha) e regras de erro reais (409 de conflito de negócio).

## 1. Flow coverage — raso

Checado: os 3 Key Flows do EXPERIENCE.md contra os 8 épicos do PRD e a tela nova do ARCH §4.2. Cada flow existente tem protagonista nomeado, passos numerados, um beat de clímax em negrito e um caminho de falha — mecanicamente bem formado.

### Findings
- **critical** Nenhum Key Flow, Component Pattern ou linha de IA cobre "Conflitos de Mesas" (ARCH §4.2 — ação real do dono "marcar conflito como resolvido", já em produção em `apps/desktop/src/routes/table-conflicts.tsx` e linkada em `apps/desktop/src/layout.tsx:51-55,106`). Um consumidor construindo só a partir da espinha nunca saberia que essa tela existe. *Fix:* adicionar linha na Information Architecture, e um 4º Key Flow (ou uma expansão do Fluxo 3) com o dono revisando/resolvendo um conflito.
- **high** As histórias 2.8/3.4/3.5 (renomear/remover mesa, categoria, produto — `docs/prd.md:87-91,107-111,113-116`) não aparecem em nenhum Key Flow, Component Pattern ou State Pattern, apesar de já implementadas (`apps/desktop/src/routes/table-map.tsx:151,197`, `apps/desktop/src/routes/catalog.tsx`) com um padrão de UI repetido e regras de bloqueio (mesa com comanda aberta, categoria com produto vinculado). *Fix:* pelo menos uma entrada de Component Pattern pro padrão de ícones editar/remover + linhas de State Pattern pros dois erros 409.
- **medium** Épico 1 (cadastro do primeiro operador / bootstrap), Épico 6 (Resumo de Caixa) e o momento de conversão do Épico 8 (limite de comandas atingido) só aparecem como linha de State Pattern, nunca como Key Flow com protagonista e clímax — inconsistente com o tratamento dado aos Épicos 2/4/5/7, que ganharam flow completo. O limite de plano é citado no próprio EXPERIENCE.md como "o gatilho de conversão do freemium" (linha 72), o que pede mais que uma linha de tabela. *Fix:* promover ao menos o limite de comandas a um 4º/5º Key Flow, já que é o momento de negócio mais crítico do freemium.
- **low** O protagonista do Fluxo 3 é só "Dono", sem nome, enquanto os Fluxos 1 e 2 usam personas nomeadas (Jonas, Marina) — inconsistência de padrão, sem impacto funcional. *Fix:* nomear ou justificar a exceção.

## 2. Token completeness — forte

Checado: todo token do frontmatter YAML do DESIGN.md e toda referência `{path.to.token}` na prosa de ambos os arquivos. Todo token de cor tem hex e par `-dark`; toda referência `{}` resolve (confirmado via grep — `{colors.*}`, `{typography.*}`, `{spacing.*}`, `{rounded.*}` todos definidos no frontmatter). Nenhum CRÍTICO de token faltando hex.

### Findings
- **medium** Nenhuma combinação declara uma meta de contraste numérica (ex: "4.5:1") — só a afirmação categórica "Contraste AA mantido nos dois modos" (EXPERIENCE.md:93) e "abaixo de AA" no Do's/Don'ts (DESIGN.md:164). Isso importa porque o par borgonha claro→escuro não é uma variação automática (DESIGN.md é explícito sobre isso, linha 162) — exatamente o caso onde declarar o número validado (não só a categoria) evita que a implementação re-derive errado. *Fix:* anotar a razão de contraste calculada para os pares que carregam texto (`on-primary`/`primary`, `on-primary-container-dark`/`primary-container-dark`, etc.), não só a meta.

## 3. Component coverage — raso

Checado: todo nome de componente usado em DESIGN.md.Components e em EXPERIENCE.md.Component Patterns, nas duas direções.

### Findings
- **high** `inline-form` tem uma linha comportamental em EXPERIENCE.md (linha 61: "Campo + botão na mesma linha... erro de validação aparece abaixo do campo") mas nenhuma entrada correspondente em `DESIGN.md.components` nem na seção Components do DESIGN.md — falta a especificação visual (espaçamento, borda de erro, breakpoint de empilhamento). *Fix:* adicionar `inline-form` ao frontmatter `components` e à seção Components do DESIGN.md.
- **high** O padrão de ícones editar/remover em linha (`PencilIcon`/`TrashIcon`, usado identicamente em `table-map.tsx` e `catalog.tsx` pras histórias 2.8/3.4/3.5) é um componente real e repetido sem nenhuma especificação visual ou comportamental em nenhuma das duas spines — nem nome, nem token, nem linha de tabela. *Fix:* nomear o componente (ex: `row-action-icon`), dar spec visual em DESIGN.md e comportamental em EXPERIENCE.md (incluindo o hitbox mínimo de 48px, que hoje falha nessas linhas — ver Accessibility Floor).
- **medium** `catalog-table` é citado duas vezes em prosa (DESIGN.md:180, EXPERIENCE.md:90) só como exemplo de superfície que **não** cumpre o piso de toque hoje — nunca é promovido a uma entrada de Component com a spec corrigida. Fica registrado como problema, não como solução. *Fix:* dar a `catalog-table` uma entrada de Components (ou substituí-la explicitamente por outro padrão, como já foi feito pra `table-tile`).

## 4. State coverage — raso

Checado: as 7 superfícies da Information Architecture (as 5 documentadas + as 2 que faltam, ver Mechanical notes) contra os estados esperados (vazio, carregamento frio, foco, erro, offline, permissão negada).

### Findings
- **high** Nenhum State Pattern cobre os dois erros de negócio 409 introduzidos por 2.8/3.4/3.5: "mesa com comanda aberta não pode ser removida" (`docs/prd.md:91`) e "categoria com produto vinculado não pode ser removida" (`docs/prd.md:111`) — ambos já implementados como mensagens inline reais. *Fix:* duas linhas novas na tabela State Patterns.
- **medium** Nenhum estado vazio documentado pra Conflitos de Mesas ("Nenhum conflito de mesa registrado ainda." — já implementado em `table-conflicts.tsx`), nem pro primeiro uso de Cardápio/Caixa sem dados ainda. *Fix:* adicionar linhas de estado vazio pra essas superfícies.
- **medium** "Permissão negada" não tem tratamento documentado, apesar do app já ter guards reais por papel (`apps/desktop/src/app.tsx:22-32`, `RequireRole`) que bloqueiam navegação direta a rotas como `/catalog` ou `/table-conflicts` pra quem não é dono. O exemplo de referência do próprio skill (`experience-example-shadcn.md`) trata esse estado explicitamente ("Surface hidden from sidebar. No blocked screen.") — aqui ele simplesmente não existe na tabela. *Fix:* uma linha de State Pattern documentando o comportamento (esconder do nav vs. redirecionar vs. tela de bloqueio).
- **low** Nenhum estado de foco (teclado) documentado, apesar do Accessibility Floor citar explicitamente a ordem de tabulação como relevante pro dono usando mouse+teclado (EXPERIENCE.md:91) — falta o estado visual correspondente (focus ring) tanto em DESIGN.md quanto em EXPERIENCE.md.

## 5. Visual reference coverage — forte

Confirmado: não há `mockups/`, `wireframes/` nem conteúdo em `imports/` (pasta existe, vazia) nesta rodada — caminho rápido sem ferramentas criativas, coerente com o `.memlog.md` da pasta. Tratado como esperado, não como lacuna.

### Findings
- **low** EXPERIENCE.md linha 35 diz "ver Mock coverage na finalização", mas não existe nenhuma seção "Mock coverage" em nenhum dos dois documentos — referência cruzada interna quebrada (aponta pra um artefato de processo que não sobreviveu na versão final do arquivo). *Fix:* remover a referência ou apontar pro `review-rubric.md`/`.memlog.md` corretamente.

## 6. Bloat and over-specification — forte

Nenhuma spec de pixel onde token já bastaria, nenhum restatement literal de personas/FRs do PRD (a prosa parafraseia em contexto de cenário, não copia definição), tabelas usadas onde uma tabela é mais clara que prosa (Do's/Don'ts, IA, Voice and Tone, State/Component Patterns). Nenhuma seção parece existir só por hábito de template.

## 7. Inheritance discipline — raso

Checado: resolução do frontmatter `sources`, nomes de jornada/requisito batendo com o PRD, glossário entre as spines, e resolução de referência de token do EXPERIENCE.md no DESIGN.md.

### Findings
- **critical** DESIGN.md se contradiz sobre a própria cor de marca: a seção Brand & Style (linha 155) ainda diz *"Laranja-queimado (`{colors.primary}`) significa 'isto é uma ação'"*, mas a seção Colors, oito linhas depois, documenta corretamente a troca pra borgonha em 2026-09-22 ("**Trocada de laranja-queimado (`#C2410C`) pra borgonha (`#9F1239`)**"). É a frase mais provável de ser lida isolada (abre a seção mais importante do documento) e está errada. *Fix:* trocar "Laranja-queimado" por "Borgonha" na linha 155.
- Fora esse ponto, a disciplina de herança é limpa: `sources` resolve (`docs/project-brief.md`, `docs/prd.md`, `docs/architecture.md` existem), nomes de tela batem literalmente com o PRD (Mapa de Mesas, Cardápio, Caixa, Pareamento), e as duas referências de token do EXPERIENCE.md (`{spacing.touch-target-min}`, `{typography.body-strong}`) resolvem no DESIGN.md. Nenhuma referência sobrevivente à feature removida 2.6 (junção de mesas) foi encontrada em nenhuma das duas spines — a remoção foi bem limpa.

## 8. Shape fit — forte

DESIGN.md segue a ordem canônica completa (Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts). EXPERIENCE.md tem todos os padrões obrigatórios presentes e na mesma ordem dos exemplos de referência (Foundation → IA → Voice and Tone → Component Patterns → State Patterns → Interaction Primitives → Accessibility Floor → Responsive & Platform → Inspiration & Anti-patterns → Key Flows).

## Mechanical notes

- **IA incompleta:** a tabela Information Architecture do EXPERIENCE.md (linhas 23-32) lista 7 superfícies, mas o app real (`apps/desktop/src/app.tsx:19-34`) tem 9 rotas de nível superior. Faltam **"Conflitos de Mesas"** (`/table-conflicts`, ver Flow coverage #1) e **"Configurações"** (`/settings`, `EstablishmentSettings` — já separada de Cardápio "achado em uso real, 2026-09-22" segundo o próprio comentário do código). A linha de Cardápio na IA ainda lista "taxa de serviço padrão do estabelecimento" como propósito (linha 30), mas essa configuração já não vive mais na tela de Cardápio no app real.
- **Datas de `updated` dessincronizadas:** DESIGN.md declara `updated: 2026-09-22` (mesmo dia da troca de cor); EXPERIENCE.md declara `updated: 2026-09-21` — um dia antes das mudanças de escopo (remoção de 2.6, adição de 2.8/3.4/3.5, tela de Conflitos de Mesas) que deveriam ter disparado uma atualização do documento. A data confere com o conteúdo estar defasado, não é só um detalhe cosmético.
- **`status: final` em ambos os arquivos** é otimista dado o volume de achados critical/high acima — nenhum dos dois deveria carregar esse selo até a IA e os Component/State Patterns serem atualizados.
- Nenhuma referência a `tables_grouped`/`table_group_dissolved` ou a qualquer vocabulário de "juntar mesas" (feature 2.6 removida) sobrevive em nenhuma das duas spines — checado via grep, limpo.
- Nomenclatura de tela/persona confere literalmente com `docs/prd.md` e `docs/project-brief.md` em todos os pontos verificados (Garçom/Caixa/Dono, Mapa de Mesas, Cardápio, Caixa, Pareamento).
