---
name: Passa a Régua
status: final
sources:
  - docs/project-brief.md
  - docs/prd.md
  - docs/architecture.md
updated: 2026-09-21
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
| Cardápio | Nav | Dono | Categorias, produtos, taxa de serviço padrão do estabelecimento |
| Pareamento | Nav (dono) / link no login (terminal novo) | Dono | Ver/copiar token LAN deste terminal, adotar token de outro, host manual, status de nuvem |

Não há navegação em profundidade além de dois níveis (nav principal → detalhe de comanda). Nenhuma tela tem paginação hoje (volume de um bar pequeno cabe inteiro na tela); isso é uma característica do domínio, não uma omissão a corrigir.

→ Referência de composição: nenhum mock ainda nesta rodada (caminho rápido, sem ferramentas criativas) — ver Mock coverage na finalização. A espinha vence em caso de conflito com qualquer mock futuro.

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
| Formulário inline (`inline-form`) | Cardápio, Pareamento | Campo + botão na mesma linha em telas largas; empilha em telas estreitas (tablet retrato). Erro de validação aparece abaixo do campo, nunca só como cor de borda. |
| Split de conta | Fechamento de comanda | Indicador "falta/sobra" ao vivo enquanto o caixa digita os valores — já existe, mantém-se; ganha destaque visual maior (`{typography.body-strong}` + cor de aviso quando não bate) porque é a tela de maior pressão de tempo do fluxo (fila no caixa). |

## State Patterns

| Estado | Onde | Tratamento |
|---|---|---|
| Sidecar offline | Global (header) | `status-badge` danger + texto "sidecar offline" — já existe. O app continua usável pra leitura do que já carregou; ações de escrita falham com mensagem clara, não silenciosamente. |
| Nenhum operador cadastrado (bootstrap) | Login | Estado já tratado: link pra cadastro do primeiro operador OU pareamento com terminal existente. Mantém as duas opções lado a lado, sem uma parecer "secundária" — são igualmente prováveis pro segundo terminal de um bar. |
| Mesa livre vs. ocupada | Mapa de Mesas | `table-tile-free` vs. `table-tile-occupied` (ver Components) — o estado mais consultado do app, precisa ser reconhecível em visão periférica, não só ao focar o olhar. |
| Merge automático pendente | Global | Banner não-bloqueante com contagem + "ver detalhes" expansível — já existe, mantém-se. |
| Limite de plano atingido (comandas ou terminais) | Mapa de Mesas (abrir comanda) / Pareamento (conectar terminal) | Mensagem nomeia o limite exato e sugere upgrade — já existe no backend; a UI precisa garantir que essa mensagem chega ao operador em destaque (não só um texto pequeno de erro), já que é o gatilho de conversão do freemium. |
| Carregando (primeira renderização de uma tela) | Qualquer tela com fetch inicial | Hoje é "Carregando..." em texto puro. Mantém-se simples (sem skeleton) — o volume de dados de um bar pequeno carrega rápido o bastante pra um skeleton ser over-engineering aqui. |

## Interaction Primitives

**Toque é o modo primário**, mouse é aceito igualmente (não é "fallback" como seria num app mobile-first — desktop com mouse é uso real e comum, ex: dono no computador do escritório). Sem gestos exclusivos de toque (sem swipe-to-delete, sem long-press escondendo a única forma de acessar uma ação) — tudo alcançável por toque simples ou clique.

- Nenhum atalho de teclado dedicado hoje (diferente de um app de produtividade) — o teclado físico não é garantido no tablet do garçom, então nenhuma ação crítica pode depender só dele.
- `Esc` fecha o único nível de modal que existe hoje (nenhum) — não aplicável ainda; registrar como regra pra quando um modal for introduzido.
- Confirmação de ação destrutiva (cancelar item, fechar comanda) é o próprio fluxo existente (motivo obrigatório, split que precisa bater exato) — já funciona como uma confirmação implícita por fricção, não precisa de um diálogo "tem certeza?" adicional.

**Banido:** hover como única forma de revelar uma ação (não existe em toque); qualquer ação crítica que só funcione com teclado físico; loading infinito sem texto de status.

## Accessibility Floor

Comportamental — contraste visual vive em `DESIGN.md`.

- Toda cor de status (`status-badge`, mesa ocupada) vem acompanhada de texto ou ícone — nunca só a cor, porque o ambiente de bar tem iluminação variável e nem todo operador tem visão de cor típica.
- Alvo de toque mínimo 48px (`{spacing.touch-target-min}` em `DESIGN.md`) em qualquer elemento acionável, sem exceção — inclusive botões de ação dentro de linha de tabela (`catalog-table`, hoje abaixo desse piso).
- Ordem de tabulação (`Tab`) segue a ordem visual em todo formulário — relevante pro dono usando mouse+teclado no escritório.
- Mensagem de erro sempre em texto lido por leitor de tela (nunca só um ícone ou mudança de cor de borda).
- Contraste AA mantido nos dois modos (claro/escuro) — ver nota em `DESIGN.md.Colors` sobre por que os tokens de dark mode não são uma versão "escurecida" dos tokens claros.

## Responsive & Platform

| Largura | Comportamento |
|---|---|
| ≥ 1024px (PC de caixa/dono) | Layout completo, tabelas/grids em múltiplas colunas, nav horizontal completa no header. |
| 768–1023px (tablet paisagem) | Mesmo layout, `table-tile`s do mapa de mesas reduzem de 4-5 por linha pra 3; formulários inline continuam lado a lado. |
| < 768px (tablet retrato) | Formulários inline empilham verticalmente; nav do header pode precisar de um menu compacto (hoje é uma lista de links simples — com 5-6 itens pro dono, cabe apertado numa tela retrato estreita; avaliar colapsar em menu na implementação). |

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
5. **Clímax:** ele fecha a comanda (nem precisa — o app já salvou) e volta pro mapa de mesas sem nenhum passo de "salvar" explícito. A Mesa 12 já aparece borgonha pros outros garçons verem que está ocupada, mesmo antes de qualquer sincronização de rede acontecer (é local-first) — ele nunca precisa se perguntar "isso já foi salvo?".

Falha: sidecar offline no meio do lançamento → `status-badge` danger no header já avisa antes dele tentar; se cair no meio de uma ação, a mensagem de erro nomeia exatamente o que não foi salvo, ele tenta de novo.

### Fluxo 2 — Fechar comanda sob fila (Marina, caixa, sábado às 23h)

1. Cliente entrega a comanda impressa (papel) da Mesa 7. Marina toca a Mesa 7 no mapa — borgonha, óbvia entre as 20 mesas do salão.
2. Comanda abre com a lista de itens e o subtotal já calculado. Ela toca "Fechar".
3. Cliente quer dividir em 3 e pagar 2 partes no cartão, 1 em dinheiro. Marina digita os 3 valores; o indicador "falta/sobra" mostra R$ 0,00 assim que bate — ela vê isso em `{typography.body-strong}`, não precisa procurar.
4. Pra parte em dinheiro, digita o valor recebido; o troco calcula sozinho.
5. **Clímax:** ela toca "Confirmar fechamento" uma única vez — a mesa 7 já volta a ficar neutra no mapa de mesas antes mesmo dela levantar os olhos da tela, e o próximo cliente da fila já pode ser atendido. Nenhuma tela de confirmação extra atravessa o caminho dela numa noite em que cada segundo de fila importa.

Falha: soma das partes não bate com o total → botão "Confirmar fechamento" permanece desabilitado (já existe hoje), com o valor exato de quanto falta/sobra sempre visível — ela nunca precisa calcular de cabeça.

### Fluxo 3 — Segundo terminal chega no bar (Dono, uma tarde de segunda, bar vazio)

1. O dono compra um segundo tablet pro garçom novo. Abre o app pela primeira vez nesse tablet — tela de login mostra "Nenhum operador cadastrado" com duas opções lado a lado: cadastrar do zero, ou parear com um terminal existente.
2. Ele escolhe parear. Pega o terminal antigo (o do caixa), vai em Pareamento, copia o código exibido.
3. Cola o código no tablet novo. Em poucos segundos (ciclo de sync LAN), o cardápio inteiro, as mesas e os operadores já existentes aparecem no tablet novo — sem ele cadastrar nada de novo.
4. **Clímax:** ele testa abrindo uma comanda de teste no tablet novo enquanto olha o mapa de mesas no terminal antigo — a mesma mesa aparece ocupada nos dois, quase ao mesmo tempo. Ele apaga a comanda de teste (cancela os itens) e confirma, sem precisar confiar cegamente, que os dois terminais realmente compartilham o mesmo salão.

Falha: se o plano free já estiver no limite de 1 terminal, a tela de Pareamento mostra a mensagem de bloqueio com o motivo exato (limite de terminais do plano) em vez de deixar ele tentando entender por que o pareamento "não funcionou".
