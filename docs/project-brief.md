# Project Brief — Tabwise

**Fase:** Discovery (BMAD — Analyst)
**Data:** 2026-09-19
**Status:** Rascunho consolidado, pronto para handoff ao PM (fase PRD)

---

## 1. Visão do produto

Sistema de PDV desktop para bares e restaurantes, com foco em gerenciamento de mesas e comandas. Objetivo: competir com SAIPOS, Consumer e Goomer começando por um MVP mais enxuto, sem nota fiscal, focado em resolver bem o ciclo operacional do dia a dia (abrir comanda → lançar pedido → fechar comanda → fechar caixa).

Nome do projeto: **Tabwise** (originalmente "Passa a Régua", renomeado em 2026-10-28 pra um nome global).

## 2. Personas

| Persona | Necessidade principal | Restrições / permissões |
|---|---|---|
| **Garçom** | Lançar pedido rápido, sem fricção, muitas vezes em pé/com mãos ocupadas | Sem acesso a preço de custo ou configurações. Login/PIN próprio (obrigatório). |
| **Caixa** | Fechar comanda rápido, calcular troco, registrar forma de pagamento e split | Login/PIN próprio. Acesso à tela de fechamento de caixa. |
| **Dono/Gerente** | Ver fechamento de caixa (resumo do dia), controlar perdas via auditoria de cancelamentos | Provavelmente precisa de acesso remoto a relatórios (implica alguma superfície de consulta no backend de sync, não só armazenamento). |

Não há persona de cozinha no MVP (decisão confirmada — ver seção 4).

## 3. Escopo do MVP

### Incluído
- Gerenciamento de mesas **e** comandas avulsas — comanda é a entidade central (id, status, itens, pagamentos); mesa é um vínculo opcional (`comanda.mesa_id` nullable). Uma comanda pode existir sem mesa (balcão/numerada); uma mesa pode ter comanda vinculada.
- Cadastro de produtos/cardápio com categorias
- Abertura e fechamento de comanda
- Login/PIN por operador (**obrigatório**, decorre da exigência de auditoria — ver abaixo)
- Auditoria de cancelamento/estorno de item (quem cancelou, quando, motivo)
- Taxa de serviço: 10% como default, **configurável no cadastro do estabelecimento**, com possibilidade de ajuste/isenção por comanda individual no fechamento (cobre casos de contestação do cliente)
- Split de conta: divisão entre pessoas/formas de pagamento no fechamento
- Cálculo de troco
- Múltiplas formas de pagamento (dinheiro, cartão — registro manual por enquanto)
- Fechamento de caixa (resumo do dia)

### Fora do MVP (fases futuras)
- Emissão de nota fiscal (via integração futura com Focus NFe ou eNotas, custo repassado ao cliente final)
- Integração direta com maquininhas de cartão
- Impressão térmica automática (cozinha/cupom)
- Tela/persona de cozinha

## 4. Decisões de discovery (com justificativa)

1. **Multi-terminal nativo desde o design**, mesmo que o deploy inicial seja single-terminal.
   *Por quê:* bar/restaurante real quase sempre acaba tendo caixa + pelo menos 1 tablet de garçom. Migrar de "single-terminal" para "sync em LAN" depois seria uma reescrita da camada de dados, não um ajuste incremental.

2. **Topologia de rede local: host local, mas terminais standalone.** Um terminal (geralmente o caixa) atua como ponto de agregação/relay da unidade; demais terminais (tablets de garçom) sincronizam com ele quando disponível — mas **nenhum terminal depende do host para continuar operando**. Cada terminal mantém réplica local completa (não apenas cache), e reconcilia quando o host volta.
   *Por quê:* no rush de um bar, parar de vender é o pior cenário possível — muito pior que reconciliar um conflito raro depois. Se o host cair, os terminais-clientes continuam operando isolados e sincronizam depois.
   *Requisito não funcional formal:* **nenhum terminal pode ficar bloqueado pela queda de outro.**
   *Implicação de dados:* itens de comanda são tratados como **log append-only** (evento de adicionar/remover item, não linha mutável) — isso reduz a superfície de conflito na reconciliação em relação a um modelo de estado mutável compartilhado. Essa é uma decisão de esquema significativa que o Architect deve aprofundar (ex: como snapshots de estado são derivados do log, como cancelamentos — que já exigem auditoria — se representam como eventos).

3. **Comanda avulsa + mesa (ambos).**
   *Por quê:* cobre tanto o padrão de restaurante com mapa de mesas fixo quanto o padrão de bar com comanda numerada/balcão.

4. **Cancelamento com auditoria obrigatória** (não é "nice to have").
   *Por quê:* não há rastreabilidade de quem cancelou um item sem saber quem está operando o terminal — isso torna login/PIN por operador um requisito do MVP, não uma feature adicional.

5. **Taxa de serviço e split de conta entram no MVP.**
   *Por quê:* são operações do dia a dia em bar/restaurante, não features avançadas — ficar sem elas tornaria o MVP inutilizável para o caso de uso real.

6. **Sem tela de cozinha no MVP.**
   *Por quê:* cozinha continua recebendo pedido verbalmente ou por comanda de papel, como hoje. Reduz escopo do MVP.

7. **Backend de sync já desenhado com endpoint de consulta read-only para relatórios**, mesmo que a tela de relatório remoto não entre no MVP visível.
   *Por quê:* decisão de baixo custo agora / alto custo depois. O backend já precisa existir para reconciliar terminais; expor uma consulta read-only simples (ex: fechamento do dia) em cima dessa mesma base é incremento pequeno. Adicionar isso depois, numa arquitetura que não previu esse caso de uso, exigiria abrir uma API nova de consulta do zero.

## 5. Modelo de negócio

Freemium. Eixos de limite:
- **Limite de comandas abertas simultaneamente: 10** (plano free). Aplica-se ao total de comandas ativas ao mesmo tempo, independente de estarem vinculadas a mesa ou serem avulsas (balcão) — evita a brecha de usar só comanda avulsa para fugir do limite de mesas cadastradas.
- **Limite de terminais: 1 no plano free; múltiplos terminais (LAN) só no plano pago.**
  *Por quê:* multi-terminal é a feature de arquitetura mais cara de construir (réplica local completa + sync + reconciliação) — faz sentido que seja o gancho de monetização mais forte, não um detalhe secundário. Um bar pequeno que roda só no PC do caixa (garçom anota em papel e leva pro caixa) cabe perfeitamente no free; no momento em que o dono quer dar um tablet pro garçom lançar direto na mesa, ele já sente valor suficiente pra pagar.

*Nota:* os dois eixos remam na mesma direção — empurram o cliente que cresce ou que tem mais de um terminal para o plano pago, o que é coerente com a decisão de multi-terminal ser nativa da arquitetura.

**Validação obtida (informal):** conversa informal com o cliente-zero confirmou um sinal indireto relevante — o estabelecimento é pequeno e já opera bem hoje com comanda manual + um sisteminha simples de cálculo (baixo volume, baixa complexidade). Isso reforça que 10 comandas simultâneas é confortável para esse perfil, e que o fluxo básico do MVP (mesa + comanda avulsa, split, taxa de serviço) cobre o que ele já faz manualmente. Não é uma validação de mercado ampla (2-3 clientes, como recomendado originalmente), mas reduz o risco de os números estarem grosseiramente errados. Tratado como suficiente para lançamento — os limites continuam ajustáveis via backend sem novo deploy (ver item 1 abaixo), então o custo de errar um pouco é baixo.

## 6. Riscos e lacunas em aberto (para PRD/Architect)

1. **Números do freemium** — limite de **10 comandas abertas simultaneamente** (mesa + avulsa) e **1 terminal** definidos para o plano free, com validação informal (ver seção 5). Confirmado que os limites devem ser tratados como **parâmetro de configuração do plano** (armazenado no backend, ex: `max_comandas_simultaneas`/`max_terminais` por plano), não hardcoded no app — permite ajustar sem novo deploy. Cenário de **downgrade de plano com dados locais já existentes** especificado e resolvido no PRD (§2.7): comandas já abertas não são bloqueadas retroativamente.
2. **Risco de QA — sync multi-terminal só é exercitado por clientes pagantes.** Como o free trava em 1 terminal, ninguém no free vai gerar o cenário real de "dois garçons lançando pedido na mesma mesa ao mesmo tempo" para validar a arquitetura de sync em produção. Isso não pode depender só de clientes pagantes descobrirem bugs de reconciliação — precisa entrar no plano de testes/QA como cenário sintético (ex: ambiente interno com 2+ terminais simulando concorrência) antes do lançamento do plano pago, não depois. **Ainda em aberto** — registrado também em `docs/architecture.md` §9 como spike recomendado.

~~Cliente zero informal~~ — **fechado**: a conversa informal já aconteceu e gerou o sinal de validação registrado acima. Uma entrevista estruturada mais profunda (fluxos detalhados, dores do sistema atual) permanece como algo útil para refinar iterações futuras, mas deixa de ser bloqueio para o MVP.

~~Percentual da taxa de serviço configurável~~ — **resolvido**: 10% default, configurável por estabelecimento, com ajuste/isenção possível por comanda no fechamento (ver seção 3).

~~Resiliência do host local~~ — **resolvido**: terminais-clientes continuam operando isolados (standalone) se o host cair e reconciliam depois; nenhum terminal pode ficar bloqueado pela queda de outro (ver seção 4, item 2).

~~Acesso remoto do dono a relatórios~~ — **resolvido**: backend de sync já desenhado com endpoint de consulta read-only, mesmo que a tela remota não entre no MVP visível (ver seção 4, item 7).

## 7. Stack já definida

- Frontend/App: Tauri + React + TypeScript
- Banco local: SQLite
- Backend de sincronização: Node.js + TypeScript + PostgreSQL
- Requisito não funcional crítico: aplicação **offline-first** — internet instável não pode parar o atendimento.

## 8. Perfil do time

Desenvolvedor full stack com 5+ anos de experiência em React, Next.js, TypeScript e Node.js. Já possui contexto prático de integração com serviço de emissão de notas fiscais via API de terceiro (relevante para a fase futura de nota fiscal, fora do MVP atual).

## 9. Próximos passos sugeridos

1. ~~Handoff para o agente **PM**~~ — **concluído**, ver `docs/prd.md`.
2. ~~Handoff para o agente **Architect**~~ — **concluído**, ver `docs/architecture.md`.
3. ~~Entrevista de discovery com o cliente-zero informal~~ — **concluída (informalmente)**, ver seção 5/6.
4. Handoff para implementação, começando pelo pacote `sync-engine` e Épico 1 do PRD (`docs/architecture.md` §11). Manter em aberto o risco de QA de sync multi-terminal (seção 6, item 2) como item de acompanhamento durante o desenvolvimento.
