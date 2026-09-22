# PRD — Passa a Régua

**Fase:** Definição de Produto (BMAD — PM)
**Data:** 2026-09-19
**Baseado em:** `docs/project-brief.md`
**Status:** Rascunho para revisão antes do handoff ao Architect

---

## 1. Objetivo do produto

Entregar um PDV desktop offline-first para bares e restaurantes que resolve o ciclo operacional essencial — mesas, comandas, pedidos, pagamento e fechamento de caixa — sem depender de internet estável, competindo com SAIPOS/Consumer/Goomer por meio de um MVP mais enxuto (sem nota fiscal) e um modelo freemium onde o multi-terminal é o principal gancho de upgrade.

## 2. Personas e permissões (referência: brief §2)

| Persona | Acessa | Não acessa |
|---|---|---|
| Garçom | Mapa de mesas, abrir/consultar comanda, lançar itens | Preço de custo, configurações do estabelecimento, resumo de caixa |
| Caixa | Tudo do garçom + fechar comanda, split, troco, cancelamento de item (com auditoria) | Configurações de plano/assinatura |
| Dono/Gerente | Tudo do caixa + cadastro de produtos/categorias, configuração de taxa de serviço, resumo de caixa, gestão de operadores | — |

**Suposição do PM (validar):** Dono e Caixa podem ser a mesma pessoa fisicamente logada (ex: dono que também opera o caixa) — o sistema não deve forçar contas separadas por papel, apenas permissões por papel atribuído ao operador.

## 3. Épicos

---

### Épico 1 — Autenticação e Operadores

**Objetivo:** garantir que toda ação relevante (especialmente cancelamento) seja atribuível a um operador identificado, em qualquer terminal, mesmo offline.

**Histórias:**

1.1. Como dono, quero cadastrar operadores com nome, papel (garçom/caixa/dono) e PIN, para controlar quem acessa o quê.
- **Critérios de aceite:**
  - PIN é único por estabelecimento (não precisa ser globalmente único).
  - Cadastro de operador funciona offline (grava local, sincroniza depois).
  - Papel determina as permissões da seção 2.

1.2. Como operador, quero logar no terminal com meu PIN, para que minhas ações fiquem registradas em meu nome.
- **Critérios de aceite:**
  - Login funciona 100% offline (PIN validado contra a réplica local).
  - Sessão persiste até logout explícito ou troca de operador (não expira por timeout no MVP — confirmado como aceitável, terminal fixo de bar costuma ficar logado o expediente todo).
  - **Risco de segurança conhecido, aceito para o MVP:** a sessão do terminal não expirar automaticamente significa que qualquer pessoa no terminal logado poderia agir "como" o operador logado. Isso é mitigado, mas não eliminado, pelo fato de que ações sensíveis (lançamento, cancelamento) continuam sendo atribuídas por evento ao operador da sessão ativa no momento — não é um controle de acesso forte, é rastreabilidade. Revisitar se o produto crescer para estabelecimentos maiores com mais rotatividade de terminal.

1.3. Como dono, quero ver quem cancelou um item, quando e por quê, para controlar perdas.
- **Critérios de aceite:**
  - Todo cancelamento exige um motivo, escolhido de uma lista pré-definida (ex: "erro de lançamento", "cliente desistiu", "item indisponível") com opção "outro" + texto livre.
  - Log de auditoria é append-only, nunca editável ou removível pela UI.

---

### Épico 2 — Gerenciamento de Mesas e Comandas

**Objetivo:** suportar tanto o fluxo de restaurante com mapa de mesas quanto o de bar com comanda avulsa/balcão (brief §3, §4.3).

**Histórias:**

2.1. Como dono, quero cadastrar as mesas do meu estabelecimento (número/identificador, capacidade opcional), para montar meu mapa de mesas.

2.2. Como garçom, quero abrir uma comanda vinculada a uma mesa, para começar a atender aquela mesa.
- **Critérios de aceite:**
  - Uma mesa só pode ter **uma comanda aberta por vez** (não pode abrir segunda comanda em mesa já ocupada).
  - Abrir comanda funciona offline.

2.3. Como garçom/caixa, quero abrir uma comanda avulsa (sem mesa), para atender balcão ou cliente que não está sentado.
- **Critérios de aceite:**
  - Comanda avulsa recebe um número sequencial visível, sem vínculo a `mesa_id`.

2.4. Como caixa, quero ver a lista de comandas abertas (por mesa e avulsas), para saber o que está em aberto no momento.
- **Critérios de aceite:**
  - Lista reflete apenas dados da réplica local do terminal (não espera sync para exibir).

2.5. Como garçom/caixa, quero transferir uma comanda inteira de uma mesa para outra, para atender o caso de cliente que muda de lugar.
- **Critérios de aceite:**
  - A comanda mantém todos os itens e histórico; apenas o `mesa_id` vinculado muda.
  - A mesa de origem volta a ficar livre para nova comanda; a mesa de destino precisa estar livre (não é possível transferir para mesa já ocupada).

2.6. ~~Como garçom/caixa, quero marcar duas ou mais mesas como "juntas" visualmente...~~ — **removido (2026-09-22)**: mesmo depois da emenda de 2026-09-21 (trava de sobreposição, desfazer, visibilidade), o dono avaliou em uso real que a feature seguia confusa e não agregava valor suficiente pro ganho de complexidade — decisão de descontinuar, não de corrigir de novo. UI e API de criar/desfazer/fechar grupos foram removidas. **Nota técnica:** os tipos de evento `tables_grouped`/`table_group_dissolved` e sua projeção continuam existindo no código (não removidos do schema) só pra manter a leitura do log de eventos válida em instalações que já tinham grupos gravados (log é append-only; remover o tipo quebraria a releitura desses eventos) — não são mais alcançáveis por nenhuma UI ou rota nova.

2.7. Como sistema, ao atingir o limite de comandas simultâneas do plano (10 no free), devo impedir a abertura de novas comandas e avisar o operador.
- **Critérios de aceite:**
  - Mensagem clara indicando o limite do plano e caminho de upgrade.
  - Contagem inclui comandas de mesa + avulsas (brief §5).
  - Comportamento em downgrade: **confirmado** — comandas já abertas **não são bloqueadas retroativamente**; apenas novas aberturas são impedidas até a contagem cair abaixo do limite (bloquear uma comanda em andamento seria uma péssima experiência no meio do serviço).

---

### Épico 3 — Cadastro de Produtos e Cardápio

**Histórias:**

3.1. Como dono, quero cadastrar categorias de produtos (ex: Bebidas, Petiscos, Pratos), para organizar o cardápio.

3.2. Como dono, quero cadastrar produtos com nome, preço, categoria e status (ativo/inativo), para controlar o que pode ser vendido.
- **Critérios de aceite:**
  - Produto inativo não aparece na tela de lançamento do garçom, mas permanece em comandas históricas já fechadas.

3.3. Como garçom, quero buscar produtos por categoria ou nome ao lançar um pedido, para lançar rápido mesmo com cardápio grande.

---

### Épico 4 — Lançamento de Pedidos

**Objetivo:** permitir que o garçom adicione itens a uma comanda de forma rápida, com histórico auditável (decorrência do modelo append-only, brief §4.2).

**Histórias:**

4.1. Como garçom, quero adicionar um item (produto + quantidade) a uma comanda aberta, para registrar o pedido do cliente.
- **Critérios de aceite:**
  - Cada adição gera um evento append-only (não sobrescreve estado anterior).
  - Funciona offline; se em terminal não-host, sincroniza quando possível.

4.2. Como garçom, quero adicionar uma observação a um item (ex: "sem cebola"), para informar preferências do cliente.

4.3. Como caixa (ou operador autorizado), quero cancelar um item já lançado antes do fechamento, informando motivo, para corrigir erros de lançamento.
- **Critérios de aceite:**
  - Gera evento de cancelamento no log append-only (não apaga o evento de adição original — ver Épico 1.3).
  - Reflete imediatamente no total da comanda no terminal local.

---

### Épico 5 — Fechamento de Comanda

**Histórias:**

5.1. Como caixa, quero ver o resumo da comanda (itens, subtotal, taxa de serviço) antes de fechar, para conferir com o cliente.
- **Critérios de aceite:**
  - Taxa de serviço aplicada usa o percentual configurado no estabelecimento (default 10%, brief §3).
  - Caixa pode ajustar ou isentar a taxa de serviço nesta comanda específica antes de confirmar (brief §3, decisão de contestação de taxa).

5.2. Como caixa, quero dividir o valor da comanda entre múltiplas pessoas/formas de pagamento (split), para atender pedidos de divisão de conta.
- **Critérios de aceite:**
  - Todo valor monetário é tratado internamente em **centavos (inteiro)**, nunca em ponto flutuante — evita bugs clássicos de arredondamento (`0.1 + 0.2 !== 0.3`).
  - **Split igual (N partes iguais):** o sistema calcula automaticamente e fecha exato, sem conceito de tolerância — o resto da divisão inteira (ex: 1 centavo ao dividir R$100 por 3) é atribuído de forma determinística à primeira parcela.
  - **Split manual/customizado:** a soma das partes deve ser **exatamente igual** ao total da comanda — não há faixa de tolerância. A UI mostra em tempo real quanto falta ou sobra para fechar o split, e o botão de confirmar fica desabilitado até a soma bater exato.
  - Cada split pode ter forma de pagamento diferente (ex: metade dinheiro, metade cartão).
  - ~~Fechamento conjunto de mesas "juntas" (história 2.6)~~ — **removido (2026-09-22)** junto com a junção de mesas; cada comanda fecha individualmente.

5.3. Como caixa, quero registrar a forma de pagamento (dinheiro, cartão — manual) para cada parte do pagamento.

5.4. Como caixa, quero que o sistema calcule o troco automaticamente quando o pagamento em dinheiro for maior que o valor devido.
- **Critérios de aceite:**
  - Cálculo de troco só se aplica à parte paga em dinheiro (não faz sentido para cartão).

5.5. Como caixa, ao confirmar o fechamento, quero que a comanda mude de status para "fechada" e pare de aceitar novos itens.
- **Critérios de aceite:**
  - Comanda fechada é imutável para lançamento de itens; cancelamentos pós-fechamento (se necessários) são tratados como um fluxo separado, **fora do escopo deste MVP** (assume-se que fechamento é definitivo).

---

### Épico 6 — Resumo de Caixa

**Renomeado de "Fechamento de Caixa" (revisão 2026-09-22, achado em uso real):** o nome original sugeria uma ação/evento discreto ("fechar o caixa" num instante), mas a tela sempre foi um relatório somativo ao vivo — não existe um botão ou evento que "feche" o caixa do dia, e o total muda a qualquer momento em que uma comanda nova é fechada. O nome e os critérios de aceite abaixo foram ajustados pra não sugerir um momento de corte que não existe; nenhum comportamento mudou.

**Histórias:**

6.1. Como dono/caixa, quero ver um resumo do dia (total vendido, total por forma de pagamento, número de comandas fechadas), para conferir o caixa a qualquer momento do expediente.
- **Critérios de aceite:**
  - Resumo é calculado localmente a partir da réplica local (não depende de sync com a nuvem estar em dia), recalculado a cada consulta — não existe uma ação de "fechar o caixa" que congele o total do dia.
  - Comandas ainda abertas (não fechadas) nunca entram no total somado — aparecem à parte como "pendentes", em qualquer momento em que o resumo for consultado.

6.2. Como dono, quero que esse mesmo resumo fique disponível via consulta read-only no backend, mesmo sem tela remota no MVP (brief §4.7), para preparar o terreno de relatórios remotos futuros sem retrabalho de arquitetura.
- **Critérios de aceite:**
  - Este é um requisito de **arquitetura de backend**, não de UI — validação de "pronto" é a existência do endpoint/consulta, não uma tela.

---

### Épico 7 — Sincronização Multi-terminal e Offline-first

**Objetivo:** operacionalizar as decisões de arquitetura do brief §4.1-4.2 como requisitos verificáveis.

**Histórias (majoritariamente não funcionais, mas com comportamento observável):**

7.1. Como garçom/caixa, quero continuar lançando pedidos e fechando comandas mesmo sem conexão com a internet, para que o atendimento nunca pare.
- **Critérios de aceite:**
  - Nenhuma ação do fluxo principal (abrir comanda, lançar item, fechar comanda, fechar caixa) depende de conectividade com a nuvem.

7.2. Como operador em um terminal secundário, quero continuar operando mesmo se o terminal-host da unidade cair, para não parar o atendimento no rush.
- **Critérios de aceite:**
  - Terminal secundário mantém réplica local completa, não apenas cache.
  - Ao voltar a conexão com o host, os eventos são reconciliados sem perda (log append-only).

7.3. Como sistema, quero sincronizar os dados locais com o backend na nuvem quando houver conexão, para consolidar os dados da unidade e habilitar relatórios remotos futuros.

7.4. **[Não funcional]** O plano de QA deve incluir cenários sintéticos de concorrência multi-terminal (2+ terminais lançando pedidos na mesma mesa simultaneamente) antes do lançamento comercial do plano pago, já que usuários do plano free (1 terminal) nunca vão gerar esse cenário em produção (brief §6.3).

---

### Épico 8 — Freemium e Gestão de Plano

**Histórias:**

8.1. Como sistema, quero aplicar o limite de 1 terminal no plano free e liberar múltiplos terminais no plano pago.
- **Critérios de aceite:**
  - Tentativa de conectar um segundo terminal no plano free é bloqueada com mensagem clara de upgrade.

8.2. Como sistema, quero aplicar o limite de 10 comandas simultâneas no plano free (ver 2.7).

8.3. Como sistema, quero que os limites de plano sejam configuráveis no backend sem exigir novo deploy do app (brief §6.1).

---

## 4. Requisitos não funcionais

| # | Requisito | Origem |
|---|---|---|
| NFR1 | Aplicação deve operar 100% funcional sem conexão à internet | Brief §7 |
| NFR2 | Nenhum terminal pode ficar bloqueado pela queda de outro terminal (incluindo o host) | Brief §4.2 |
| NFR3 | Dados de itens de comanda são tratados como log append-only, não estado mutável | Brief §4.2 |
| NFR4 | Backend expõe endpoint read-only de consulta agregada (ex: fechamento do dia) desde a primeira versão do backend | Brief §4.7 |
| NFR5 | Limites de plano (comandas, terminais) são parametrizados no backend, não hardcoded no app | Brief §6.1 |
| NFR6 | Log de auditoria de cancelamento é append-only e não editável via UI | Brief §4.4 |
| NFR7 | Valores monetários são armazenados e calculados internamente em centavos (inteiro), nunca em ponto flutuante | PRD §5.2 |

## 5. Fora do escopo (reafirmado do brief)

- Emissão de nota fiscal
- Integração direta com maquininhas de cartão
- Impressão térmica automática
- Tela de cozinha
- Cancelamento/estorno após fechamento de comanda (assume-se fechamento definitivo no MVP)

## 6. Perguntas em aberto que bloqueiam estimativa (não bloqueiam o PRD)

Nenhuma pendência bloqueante no momento — ver histórico de resolução abaixo.

~~Validação do comportamento de junção de mesas com o cliente-zero~~ — **superado: feature removida (2026-09-22).** Havia sido fechado sem validação externa formal, depois revisitado com uso real: 2.6 foi emendado em 2026-09-21 com três critérios (trava de sobreposição, desfazer, visibilidade) em resposta a confusão real observada. No dia seguinte, mesmo com a emenda aplicada e testada, o dono avaliou que a feature continuava confusa e não valia a complexidade — decisão de remover 2.6 inteira em vez de corrigir de novo (ver 2.6 e §6 nota abaixo).

*Histórico original (contexto, não mais a decisão vigente):* uma conversa informal com o cliente-zero confirmou um sinal indireto relevante — o estabelecimento é pequeno, opera bem hoje com comanda manual + um sisteminha simples de cálculo, o que reforça que (a) 10 comandas simultâneas é confortável para esse perfil de volume, e (b) o fluxo básico (mesa + comanda avulsa, split, taxa de serviço) já cobre o que ele faz manualmente hoje. Isso não confirma especificamente o comportamento de junção de mesas na prática, mas reduz o risco de tê-lo errado, dado o perfil de baixa complexidade operacional do estabelecimento.

~~Nome "Fechamento de Caixa" (Épico 6)~~ — **resolvido, achado em uso real (2026-09-22)**: o nome sugeria uma ação de fechar o caixa num instante, mas a tela sempre foi um relatório somativo ao vivo, sem ação de fechamento nenhuma. Renomeado para "Resumo de Caixa" em 6.1 e no critério de aceite correspondente; nenhum comportamento mudou, só o nome e a redação que o cercava.

~~Transferência/junção de mesas~~ — **parcialmente superado**: transferência move a comanda entre mesas mantendo histórico (2.5) — segue valendo. Junção (2.6) foi implementada, emendada uma vez, e depois removida (2026-09-22) por não agregar valor suficiente em uso real — ver 2.6 e a entrada acima.

~~Tolerância de arredondamento no split de conta~~ — **resolvido**: valores em centavos (inteiro); split igual fecha exato com resto determinístico na primeira parcela; split manual exige soma exata ao total, sem tolerância (ver 5.2, NFR7).

~~Comportamento de downgrade de plano com dados excedentes~~ — **resolvido**: comandas já abertas não são bloqueadas retroativamente (2.7).

~~Expiração de sessão de login por PIN~~ — **resolvido**: sem expiração automática no MVP, registrado como risco de segurança conhecido e aceito (1.2).

## 7. Próximos passos

1. ~~Handoff para o agente **Architect**~~ — **concluído**, ver `docs/architecture.md`.
2. Handoff para implementação (agente Dev / quebra em tasks), começando pelo pacote `sync-engine` e pelo Épico 1, conforme `docs/architecture.md` § 11.
