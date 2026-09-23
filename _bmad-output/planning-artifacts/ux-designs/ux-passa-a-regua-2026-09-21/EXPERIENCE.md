---
name: Passa a Régua
status: final
sources:
  - docs/project-brief.md
  - docs/prd.md
  - docs/architecture.md
updated: 2026-09-23
---

# Passa a Régua — Experience Spine

> Repaginação visual de um MVP já funcional (M0-M12 fechados) — a estrutura de rotas, os fluxos de negócio e a lógica de permissões por papel **não mudam**. Este documento descreve como o mesmo comportamento deveria *parecer* e *se sentir*, não uma reformulação de produto.

## Foundation

Desktop nativo (Tauri + React), multi-superfície: o mesmo bundle roda tanto num PC de caixa (mouse/teclado, tela grande, uso sentado) quanto num tablet apoiado ou carregado pelo garçom (toque, tela menor, uso em pé e em movimento). Não há CSS framework/sistema de UI herdado — CSS puro, sistema de design próprio (ver `DESIGN.md`). Single-tenant por terminal: cada terminal tem sua própria réplica local de dados (ARCH §3), mas a mesma pessoa pode logar em terminais diferentes com o mesmo PIN.

`DESIGN.md` é a referência de identidade visual; este documento é a experiência — a estrutura de navegação, os estados, e o comportamento de cada padrão de componente.

## Information Architecture

| Superfície | Alcançada de | Papel que acessa | Propósito |
|---|---|---|---|
| Login (PIN) | Abertura do app / logout | Todos | Autenticar o operador do turno |
| Cadastro de operador | Link no login (bootstrap) / nav (dono) | Ninguém logado (1º operador) / Dono | Criar operador com PIN |
| Mapa de Mesas | Nav principal, destino pós-login | Todos | Ver mesas livres/ocupadas, abrir/transferir mesa, abrir comanda avulsa |
| Comanda (detalhe) | Tocar numa mesa ocupada / comanda avulsa | Todos (fechar é caixa/dono) | Lançar item, cancelar item, fechar comanda com split |
| Caixa | Nav | Caixa, Dono | Resumo do dia: total vendido, por forma de pagamento, comandas pendentes |
| Cardápio | Nav | Dono | Categorias e produtos (cadastrar, renomear, remover/ativar-desativar) |
| Configurações | Nav (dono) | Dono | Taxa de serviço padrão do estabelecimento; ponto de entrada pra Pareamento |
| Pareamento | Link "Configurar pareamento" em Configurações (dono) / link no login (terminal novo sem operador) | Dono / Ninguém logado ainda (bootstrap) | Ver/copiar token LAN deste terminal, adotar token de outro, host manual, status de nuvem. Rota própria, fora do shell autenticado — precisa funcionar pra um terminal que ainda não tem nenhum operador cadastrado (ARCH §9) |
| Conflitos de Mesas **[2026-09-23]** | Nav (dono) | Dono | Histórico completo de conflitos de mesa (duas comandas abertas pra mesma mesa, mescladas automaticamente — ARCH §4.2); marcar conflito como resolvido |

Não há navegação em profundidade além de dois níveis (nav principal → detalhe de comanda). Nenhuma tela tem paginação hoje (volume de um bar pequeno cabe inteiro na tela) — característica do domínio pra mesas/produtos/operadores (conjunto limitado, estável). **Exceção registrada 2026-09-23:** Conflitos de Mesas é um log de auditoria que só cresce (nunca encolhe) — essa premissa não vale pra ele; ver State Patterns.

→ Referência de composição: nenhum mock feito até agora (caminho rápido, sem ferramentas criativas) — histórico completo em `.memlog.md` e nos relatórios de validação (`review-*.md`, `validation-report.md`) desta mesma pasta. A espinha vence em caso de conflito com qualquer mock futuro.

## Voice and Tone

Direto, sem tom de "produto de consumo". O operador está trabalhando, não sendo entretido.

| Faça | Evite |
|---|---|
| "Mesa já tem uma comanda aberta" | "Ops! Essa mesa já está ocupada 😅" |
| "Limite de 10 comandas simultâneas atingido — faça upgrade pra aumentar" | "Você atingiu seu limite! Considere fazer upgrade 🚀" |
| "Comanda mais nova foi mesclada na comanda existente" | "Tudo certo! Resolvemos um probleminha de sincronização pra você" |
| Mensagem de erro nomeia a regra de negócio que foi violada, não um código genérico | "Erro ao processar solicitação" |
| Mesmo tom pra dono, caixa e garçom — nenhuma superfície fala "de forma mais simples" pro garçom | Tom infantilizado ou emojis decorativos em mensagem de sistema |

O app já segue essa disciplina hoje (mensagens de erro do backend citam a regra exata violada) — este documento formaliza o padrão pra não se perder conforme novas telas chegarem.

## Component Patterns

Comportamental — a especificação visual de cada componente vive em `DESIGN.md.components`.

| Componente | Onde | Regra de comportamento |
|---|---|---|
| `table-tile` | Mapa de Mesas | Substitui a linha de tabela atual por um bloco tocável (mínimo 96×96px). Toque abre a comanda daquela mesa (se ocupada) ou o formulário de abrir comanda (se livre). |
| `pin-key` | Login | Teclado numérico de 12 teclas (`1`-`9`, `⌫`, `0`, `OK`), já existe — este sistema só aumenta a área de toque e o tamanho do dígito (ver `DESIGN.md.components.pin-key`). Nenhuma mudança de fluxo. |
| `status-badge` | Header (sidecar ok/offline), Cardápio (produto ativo/inativo), Caixa (comanda pendente) | Cor semântica fixa (success/warning/danger) — nunca cor arbitrária por contexto. Texto sempre acompanha a cor (nunca só cor, ver Accessibility Floor). |
| `merge-warning-banner` | Global (abaixo do header, qualquer tela) | Já existe (ARCH §4.2) — só herda a paleta `warning` deste sistema. Continua não-bloqueante: nunca modal, nunca impede a ação em andamento. |
| Formulário inline (`inline-form`) | Cardápio, Pareamento, Configurações | Campo + botão na mesma linha em telas largas; empilha em telas estreitas (tablet retrato). Erro de validação aparece abaixo do campo, nunca só como cor de borda. |
| Split de conta **[corrigido 2026-09-23]** | Fechamento de comanda | Indicador "falta/sobra" ao vivo a partir de 1 parte (antes só com 2+, o que travava "Confirmar fechamento" sem explicação numa parte única editada manualmente), com destaque visual (`{typography.body-strong}` + cor de aviso) por ser a tela de maior pressão do fluxo (fila no caixa). |
| Ação de linha (`row-action-button`) **[2026-09-23]** | Cardápio (categoria/produto), Mapa de Mesas (mesa), Comanda (editar/cancelar item) | Ícone só, nunca texto completo, pra caber em colunas/grids estreitos sem quebrar linha — mesma ação semântica sempre com o mesmo componente visual. `aria-label` obrigatório. |

## State Patterns

| Estado | Onde | Tratamento |
|---|---|---|
| Sidecar offline | Global (header) | `status-badge` danger + texto "sidecar offline" — já existe. O app continua usável pra leitura do que já carregou; ações de escrita falham com mensagem clara, não silenciosamente. |
| Nenhum operador cadastrado (bootstrap) | Login | Estado já tratado: link pra cadastro do primeiro operador OU pareamento com terminal existente. Mantém as duas opções lado a lado, sem uma parecer "secundária" — são igualmente prováveis pro segundo terminal de um bar. |
| Mesa livre vs. ocupada | Mapa de Mesas | `table-tile-free` vs. `table-tile-occupied` (ver Components) — o estado mais consultado do app, precisa ser reconhecível em visão periférica, não só ao focar o olhar. |
| Merge automático pendente | Global | Banner não-bloqueante com contagem + "ver detalhes" expansível — já existe, mantém-se. |
| Limite de plano atingido (comandas ou terminais) | Mapa de Mesas (abrir comanda) / Pareamento (conectar terminal) | Mensagem nomeia o limite exato e sugere upgrade, em destaque (não um texto pequeno de erro) — é o gatilho de conversão do freemium. Ver Key Flows. |
| Carregando (primeira renderização de uma tela) | Qualquer tela com fetch inicial | Hoje é "Carregando..." em texto puro. Mantém-se simples (sem skeleton) — o volume de dados de um bar pequeno carrega rápido o bastante pra um skeleton ser over-engineering aqui. |
| Remoção bloqueada por dependência **[2026-09-23]** | Cardápio (categoria com produto vinculado), Mapa de Mesas (mesa com comanda aberta) | Erro 409 inline nomeando a dependência exata ("remova os produtos primeiro" / "feche a comanda antes de remover a mesa"); só bloqueia a ação de remover, nunca a linha inteira. |
| Vazio (sem dados ainda) **[2026-09-23]** | Conflitos de Mesas, Caixa, Cardápio | Texto direto no lugar da lista ("Nenhum conflito de mesa registrado ainda.", "Nenhuma comanda pendente.", "cadastre uma categoria antes"), nunca decorativo. |
| Permissão negada **[2026-09-23]** | Rota `owner`/`owner+cashier` acessada por URL por quem não tem o papel | Link já não aparece no nav; se a rota for digitada mesmo assim, `RequireRole` redireciona pro Mapa de Mesas sem explicação — aceito, a rota nem deveria ser conhecida por esse papel. |
| Foco de teclado | Qualquer input/select/button/link, todas as telas | Já existe: `outline: 2px solid {colors.primary}` (`outline-offset: 1px`) via `:focus-visible` — só aparece pra navegação por teclado, nunca por clique/toque (evita o "anel" indesejado que atrapalha o visual em uso normal). |

## Interaction Primitives

**Toque é o modo primário**, mouse é aceito igualmente (não é "fallback" como seria num app mobile-first — desktop com mouse é uso real e comum, ex: dono no computador do escritório). Sem gestos exclusivos de toque (sem swipe-to-delete, sem long-press escondendo a única forma de acessar uma ação) — tudo alcançável por toque simples ou clique.

- Nenhum atalho de teclado dedicado hoje (diferente de um app de produtividade) — o teclado físico não é garantido no tablet do garçom, então nenhuma ação crítica pode depender só dele.
- Regra registrada pra quando um modal for introduzido (nenhum existe hoje): `Esc` fecha o nível de modal aberto.
- Confirmação de ação destrutiva (cancelar item, fechar comanda) é o próprio fluxo existente (motivo obrigatório, split que precisa bater exato) — já funciona como uma confirmação implícita por fricção, não precisa de um diálogo "tem certeza?" adicional.

**Banido:** hover como única forma de revelar uma ação (não existe em toque); qualquer ação crítica que só funcione com teclado físico; loading infinito sem texto de status.

## Accessibility Floor

Comportamental — contraste visual vive em `DESIGN.md`.

- Toda cor de status (`status-badge`, mesa ocupada) vem acompanhada de texto ou ícone — nunca só a cor, porque o ambiente de bar tem iluminação variável e nem todo operador tem visão de cor típica.
- Alvo de toque mínimo 48px (`{spacing.touch-target-min}` em `DESIGN.md`) em qualquer elemento acionável, sem exceção — garantido via `row-action-button` em toda ação de linha (Cardápio, Mapa de Mesas, Comanda) desde 2026-09-22.
- Ordem de tabulação (`Tab`) segue a ordem visual em todo formulário — relevante pro dono usando mouse+teclado no escritório.
- Mensagem de erro sempre em texto lido por leitor de tela (nunca só um ícone ou mudança de cor de borda).
- Contraste AA mantido nos dois modos (claro/escuro) — ver nota em `DESIGN.md.Colors` sobre por que os tokens de dark mode não são uma versão "escurecida" dos tokens claros.

**Gaps reais achados na validação de acessibilidade 2026-09-23 (código não cumpre o piso acima ainda — registrados aqui pra não se perder, não removidos até serem corrigidos):**
- **Mapa de mesas sem semântica de lista/tabela pra leitor de tela** — o grid de `table-tile` é só `<div>`s, sem `role`/landmark. Gap conhecido desde a repaginação visual (`_bmad-output/implementation-artifacts/deferred-work.md`), ainda sem solução — não é correção pontual, é decisão de arquitetura ARIA a fazer.
- **Nenhuma tela autenticada tem `<h1>`** — toda rota começa em `<h2>`, sem heading de nível 1 em nenhum ancestral (o wordmark do header é `<span>`). Quebra navegação por heading de leitor de tela.
- **`.form-error` (23 ocorrências) nunca usa `role="alert"`/`aria-live`/`aria-describedby`** — o texto nomeia a regra certa (ver regra acima), mas não tem garantia de ser anunciado nem de ficar associado ao campo que falhou.
- **`.catalog-empty`/`.catalog-row-inactive` (opacity 0.6) caem a ~4.45:1 no modo claro**, abaixo do piso AA de 4.5:1 pra texto normal — único ponto onde a regra de contraste AA acima ainda não é cumprida de fato (modo escuro passa, ~6.28:1).

## Responsive & Platform

| Largura | Comportamento |
|---|---|
| ≥ 1024px (PC de caixa/dono) | Layout completo, tabelas/grids em múltiplas colunas, nav horizontal completa no header. |
| 768–1023px (tablet paisagem) | Mesmo layout, `table-tile`s do mapa de mesas reduzem de 4-5 por linha pra 3; formulários inline continuam lado a lado. |
| < 768px (tablet retrato) | Formulários inline empilham verticalmente; nav do header já chegou a 6 itens pro dono (Mapa de Mesas, Caixa, Cardápio, Configurações, Conflitos de Mesas, Cadastrar operador) — `flex-wrap` evita quebra de layout, mas o cabeçalho passa a ocupar 2-3 linhas em tela estreita. **[2026-09-23]** Cruzou o teto que este documento já sinalizava como risco; colapsar em menu compacto deixou de ser "avaliar" e virou prioridade real da próxima rodada. |

Passa a Régua é desktop nativo, não um app mobile — mas "desktop" aqui inclui tablets Windows/iPad rodando o mesmo binário Tauri em pé de igualdade, não como modo degradado.

## Inspiration & Anti-patterns

- **Lifted from Toast/Square POS:** grid de mesas como blocos de cor tocáveis em vez de lista/tabela — é o vocabulário que qualquer garçom que já usou um PDV reconhece sem treinamento.
- **Lifted from semáforo de trânsito:** vocabulário de três cores (neutro/marca/aviso/erro) sem variação por contexto — reduz carga cognitiva pra quem está olhando rápido.
- **Rejeitado — modo escuro como filtro/overlay:** dark mode com tokens próprios por papel (ver `DESIGN.md`), não uma versão "escurecida" das cores claras — evita os problemas de contraste que o bloco `@media` anterior do app nunca resolveu de verdade.
- **Rejeitado — confirmação modal extra em toda ação:** o app já usa fricção estrutural (motivo obrigatório de cancelamento, soma exata do split) como confirmação implícita; empilhar um "tem certeza?" por cima disso só atrasa quem já está sob pressão de tempo.
- **Rejeitado — onboarding/tour guiado na primeira tela:** o público (garçom, caixa) aprende o fluxo observando um colega no primeiro turno, não lendo um tutorial na tela; investir nisso seria design pra um usuário que não existe aqui.

## Key Flows

### Fluxo 1 — Abrir e lançar numa mesa (Jonas, garçom, sexta à noite lotada)

1. Jonas pega o tablet, toca `pin-key` "4", "2", "1", "7" — teclas grandes o bastante pra acertar de primeira mesmo andando.
2. Mapa de Mesas abre. Ele vê de relance quais `table-tile`s estão em borgonha (ocupadas) e qual mesa 12 (que acabou de vagar) está neutra.
3. Toca na Mesa 12 vazia → formulário rápido de abrir comanda → toca "Abrir".
4. Comanda abre. Ele busca "Cerveja" no campo de produto, toca no resultado — item lançado, subtotal atualiza na hora.
5. **Clímax:** ele sai da tela da comanda e volta pro mapa de mesas sem nenhum passo de "salvar" explícito. A Mesa 12 já aparece borgonha pros outros garçons verem que está ocupada, mesmo antes de qualquer sincronização de rede acontecer (é local-first) — ele nunca precisa se perguntar "isso já foi salvo?".

Falha: sidecar offline no meio do lançamento → `status-badge` danger no header já avisa antes dele tentar; se cair no meio de uma ação, a mensagem de erro nomeia exatamente o que não foi salvo, ele tenta de novo.

### Fluxo 2 — Fechar comanda sob fila (Marina, caixa, sábado às 23h)

1. Cliente entrega a comanda impressa (papel) da Mesa 7. Marina toca a Mesa 7 no mapa — borgonha, óbvia entre as 20 mesas do salão.
2. Comanda abre com a lista de itens e o subtotal já calculado. Ela toca "Fechar".
3. Cliente quer dividir em 3 e pagar 2 partes no cartão, 1 em dinheiro. Marina digita os 3 valores; o indicador "falta/sobra" mostra R$ 0,00 assim que bate — ela vê isso em `{typography.body-strong}`, não precisa procurar.
4. Pra parte em dinheiro, digita o valor recebido; o troco calcula sozinho.
5. **Clímax:** ela toca "Confirmar fechamento" uma única vez — a mesa 7 já volta a ficar neutra no mapa de mesas antes mesmo dela levantar os olhos da tela, e o próximo cliente da fila já pode ser atendido. Nenhuma tela de confirmação extra atravessa o caminho dela numa noite em que cada segundo de fila importa.

Falha: soma das partes não bate com o total → botão "Confirmar fechamento" permanece desabilitado (já existe hoje), com o valor exato de quanto falta/sobra sempre visível — ela nunca precisa calcular de cabeça.

### Fluxo 3 — Segundo terminal chega no bar (Renato, dono, uma tarde de segunda, bar vazio)

1. Renato compra um segundo tablet pro garçom novo. Abre o app pela primeira vez nesse tablet — tela de login mostra "Nenhum operador cadastrado" com duas opções lado a lado: cadastrar do zero, ou parear com um terminal existente.
2. Ele escolhe parear. Pega o terminal antigo (o do caixa), vai em Configurações → Pareamento, copia o código exibido.
3. Cola o código no tablet novo. Em poucos segundos (ciclo de sync LAN), o cardápio inteiro, as mesas e os operadores já existentes aparecem no tablet novo — sem ele cadastrar nada de novo.
4. **Clímax:** ele testa abrindo uma comanda de teste no tablet novo enquanto olha o mapa de mesas no terminal antigo — a mesma mesa aparece ocupada nos dois, quase ao mesmo tempo. Ele apaga a comanda de teste (cancela os itens) e confirma que os dois terminais realmente compartilham o mesmo salão, sem precisar confiar cegamente.

Falha: se o plano free já estiver no limite de 1 terminal, a tela de Pareamento mostra a mensagem de bloqueio com o motivo exato (limite de terminais do plano) em vez de deixar ele tentando entender por que o pareamento "não funcionou".

### Fluxo 4 **[2026-09-23]** — Revisando um conflito de mesa (Renato, dono, segunda de manhã, antes de abrir)

1. Renato abre o app na segunda de manhã, antes do bar abrir pro movimento. Vê no header um aviso: "⚠️ 1 comanda foi mesclada automaticamente por conflito de sincronização."
2. Expande "Ver detalhes" no próprio banner — mostra que foi a Mesa 8, durante o rush de sábado (dois garçons devem ter aberto a mesma mesa enquanto um tablet ficou sem sinal por um instante).
3. Clica "Ver histórico completo", chega em Conflitos de Mesas — a mesma ocorrência aparece com data/hora exata e um link direto pra comanda que ficou aberta.
4. Confere na comanda que os itens fazem sentido juntos (nada duplicado, nada estranho) — a comanda já fechou há dias, não precisa perguntar pro garçom nem ligar pro cliente.
5. **Clímax:** clica "Marcar como resolvido". O registro continua existindo pra sempre (auditoria), mas some da lista do que ainda precisa de atenção — na próxima vez que ele abrir a tela, só o que é realmente novo salta aos olhos.

Falha: se ele achar algo estranho nos itens (algo que não devia estar ali), o link pra comanda deixa ele investigar antes de decidir — "marcar como resolvido" nunca é automático nem obrigatório, só fica disponível.

### Fluxo 5 **[2026-09-23, gatilho de conversão do freemium]** — Batendo no teto do plano free (Jonas, garçom, sábado lotado)

1. Bar lotado, já são 10 comandas abertas simultâneas — o teto do plano free. Jonas tenta abrir a 11ª mesa que acabou de sentar gente.
2. O app recusa na hora, em destaque (não um texto pequeno de erro que passa despercebido no meio da tela): "Limite de 10 comandas simultâneas atingido — faça upgrade de plano pra aumentar."
3. Jonas não decide sobre plano — avisa Renato. Quando Renato confere o app depois, vê a mesma mensagem e sabe exatamente qual é a causa: mais movimento simultâneo do que o plano free suporta, não um bug.
4. **Clímax:** Renato decide fazer upgrade (ou não) com informação completa — a mensagem nunca deixou dúvida sobre o motivo real de ter travado.

Falha: nenhuma no comportamento (a mensagem já nomeia a regra exata, ver Voice and Tone) — o risco é só de destaque visual: se a mensagem aparecer como erro pequeno de formulário, perde a força de ser o gatilho de conversão mais importante do produto.
