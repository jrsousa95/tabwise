# Plano de Implementação — Passa a Régua

**Fase:** Implementação (BMAD — Dev)
**Data:** 2026-09-21
**Baseado em:** `docs/prd.md`, `docs/architecture.md`
**Status:** Roadmap sequenciado por dependência técnica, pronto para início de desenvolvimento

---

## Como ler este documento

A ordem aqui **não segue a numeração dos épicos do PRD** — segue a ordem em que as coisas precisam existir para as próximas funcionarem. Cada task referencia a história do PRD (`PRD 2.3`) ou a seção da arquitetura (`ARCH §3`) de onde vem. Marque `[x]` conforme for concluindo — este arquivo é para ser editado ao longo do projeto, não é um artefato congelado.

---

## M0 — Spikes técnicos (antes de qualquer código de produto)

Objetivo: eliminar as maiores incertezas técnicas antes de comprometer tempo em features. Referência: `ARCH §9`.

- [x] Spike 1 (completo — ver `docs/spikes/spike-1-sidecar.md`): processo sidecar Node empacotado via SEA, spawnado por um app Tauri mínimo — **validado em macOS/arm64** (build, spawn automático pelo Tauri e resposta HTTP confirmados via `curl`, com confirmação visual) **e em Windows real** (via CI, runner `windows-latest`, ver `.github/workflows/spike1-windows-validation.yml`): sidecar respondeu `/health` e o instalador Tauri completo (`.msi`/`.exe`) foi gerado com sucesso. Armadilhas encontradas e resolvidas: binário Node universal do macOS duplicava o sentinel do SEA (`lipo -thin`); `execFileSync`/`spawnSync` não roda `.cmd`/`.bat` (`npx`) sem `shell:true` no Windows — resolvido invocando o CLI do `postject` direto via `node`, sem depender de shell.
- [ ] Spike 2: descoberta mDNS entre dois processos na mesma rede Wi-Fi, testado em pelo menos 2 redes diferentes (ex: rede de casa + hotspot de celular, simulando roteador ruim).
- [ ] Spike 3: protótipo isolado do merge de eventos (HLC + regra de conflito de comanda duplicada, `ARCH §4.2`) com testes automatizados cobrindo diferentes ordens de chegada dos eventos.

**Critério de saída do M0:** os 3 spikes rodam de forma independente (não precisam estar integrados ao app final ainda) e você tem confiança de que nenhum vai exigir replanejamento de arquitetura.

---

## M1 — Fundação: monorepo + sync-engine

Objetivo: ter o pacote `sync-engine` funcional e testado isoladamente, antes de conectá-lo a qualquer UI. Referência: `ARCH §3, §8`.

- [ ] Setup do monorepo (`apps/desktop`, `apps/backend`, `packages/sync-engine`, `packages/shared-types`) com workspace TS (ex: pnpm workspaces ou Turborepo).
- [ ] `shared-types`: definir os tipos de evento (`EventoBase`, união discriminada por `tipo`) e schemas de validação (ex: Zod) para: `operador_cadastrado`, `comanda_aberta`, `comanda_transferida`, `mesas_agrupadas`, `item_adicionado`, `item_cancelado`, `comanda_fechada`, `pagamento_registrado`.
- [ ] `sync-engine`: implementar HLC (gerar, comparar, mesclar ao receber evento remoto) com testes unitários.
- [ ] `sync-engine`: schema SQLite da tabela `eventos` (append-only) + camada de acesso (insert, listar desde cursor, buscar por `aggregate_id`).
- [ ] `sync-engine`: motor de projeção — função pura `aplicarEvento(estadoAtual, evento) => novoEstado`, testável sem banco (recebe lista de eventos ordenados por HLC, devolve estado materializado).
- [ ] `sync-engine`: reconciliação — função de merge de dois logs de eventos (dedupe por `id`, reordenação por HLC, aplicação da regra de conflito de comanda duplicada do `ARCH §4.2`).
- [ ] Suite de testes de propriedade (property-based) para a reconciliação: gerar sequências aleatórias de eventos em ordens diferentes e validar que o estado final é sempre o mesmo (comutatividade do merge).

**Critério de saída do M1:** `sync-engine` tem cobertura de teste sólida e funciona 100% em memória/CLI, sem depender do Tauri ou de rede — isso é o que te dá confiança pra construir tudo o resto em cima.

---

## M2 — Esqueleto do app desktop

Objetivo: Tauri + sidecar + React conversando entre si, sem nenhuma feature de produto ainda.

- [ ] Scaffold do app Tauri (`apps/desktop`) com sidecar Node/TS embutido (usando o `sync-engine` como dependência).
- [ ] Canal de IPC entre webview (React) e sidecar (ex: sidecar expõe uma API local via HTTP/WebSocket em `localhost`, consumida pelo frontend).
- [ ] Inicialização do SQLite local no primeiro start do sidecar (criação de schema).
- [ ] Layout base da UI (roteamento entre telas: login, mapa de mesas, comanda, caixa) — sem lógica de negócio ainda, só shell navegável.

**Critério de saída do M2:** o app abre, o sidecar sobe, e uma tela React consegue escrever e ler um evento de teste no SQLite local via IPC.

---

## M3 — Épico 1: Autenticação e Operadores

Referência: `PRD Épico 1`.

- [ ] Evento `operador_cadastrado` + projeção da tabela `operadores` (nome, papel, hash do PIN).
- [ ] Tela de cadastro de operador (dono) — PRD 1.1.
- [ ] Fluxo de login por PIN, validação local contra hash (bcrypt/argon2) — PRD 1.2.
- [ ] Sessão de terminal (persistida até logout/troca de operador, sem expiração automática — decisão já registrada em `PRD 1.2`).
- [ ] Enforcement de permissões por papel na navegação (garçom não acessa configurações/fechamento de caixa) — `PRD §2`.
- [ ] Estrutura de log de auditoria (genérica, reaproveitável pelo cancelamento no M6) — evento append-only vinculado a `operador_id`.

**Critério de saída do M3:** dá pra cadastrar operadores, logar e navegar respeitando permissões — ainda sem nenhuma feature de mesa/comanda.

---

## M4 — Épico 3: Cadastro de Produtos e Cardápio

Referência: `PRD Épico 3`. Precisa vir antes do lançamento de pedidos (M6), que depende de produtos existirem.

- [ ] Evento/projeção de categorias — PRD 3.1.
- [ ] Evento/projeção de produtos (nome, preço, categoria, status ativo/inativo) — PRD 3.2.
- [ ] Telas de cadastro (dono) de categorias e produtos.
- [ ] Tela de busca de produto por nome/categoria (usada depois pelo garçom no M6) — PRD 3.3.

---

## M5 — Épico 2: Mesas e Comandas

Referência: `PRD Épico 2`.

- [ ] Evento/projeção de mesas (cadastro) — PRD 2.1.
- [ ] Abrir comanda vinculada a mesa, com invariante local "1 comanda aberta por mesa" — PRD 2.2.
- [ ] Abrir comanda avulsa (numeração sequencial, sem `mesa_id`) — PRD 2.3.
- [ ] Tela de mapa de mesas + lista de comandas abertas (mesa + avulsa) — PRD 2.4.
- [ ] Transferência de comanda entre mesas (evento `comanda_transferida`, mantendo histórico) — PRD 2.5.
- [ ] Junção visual de mesas (`mesas_agrupadas`), sem mesclar dados de comanda — PRD 2.6.
- [ ] Enforcement do limite de 10 comandas simultâneas (contagem local mesa+avulsa) — PRD 2.7. *(Neste milestone, usar valor fixo/local do limite; a leitura do valor real do plano via backend entra no M9.)*

**Critério de saída do M5:** fluxo completo de "abrir mesa/comanda avulsa → ver no mapa → transferir/agrupar" funcional em um único terminal, offline.

---

## M6 — Épico 4: Lançamento de Pedidos

Referência: `PRD Épico 4`. Depende de M4 (produtos) e M5 (comandas).

- [ ] Adicionar item a uma comanda aberta (evento `item_adicionado`) — PRD 4.1.
- [ ] Observação por item (ex: "sem cebola") — PRD 4.2.
- [ ] Cancelamento de item com motivo obrigatório (lista pré-definida + "outro"), gerando evento de auditoria — PRD 4.3, ligado ao log do M3.

---

## M7 — Épico 5: Fechamento de Comanda

Referência: `PRD Épico 5`. Depende de M6.

- [ ] Cálculo de subtotal + taxa de serviço (default 10%, configurável por estabelecimento, ajustável/isentável por comanda) — PRD 5.1.
- [ ] Valores monetários em centavos (inteiro) em toda a stack — PRD NFR7.
- [ ] Split igual (N partes, resto determinístico na primeira parcela) — PRD 5.2.
- [ ] Split manual (soma exata obrigatória, UI mostra quanto falta/sobra, botão desabilitado até bater) — PRD 5.2.
- [ ] Registro de forma de pagamento por parte do split (dinheiro/cartão manual) — PRD 5.3.
- [ ] Cálculo de troco (só sobre a parte em dinheiro) — PRD 5.4.
- [ ] Fechamento da comanda (evento `comanda_fechada`, imutabilidade pós-fechamento) — PRD 5.5.
- [ ] Fechamento conjunto de mesas agrupadas (M5) numa única operação de pagamento — PRD 5.2.

---

## M8 — Épico 6: Fechamento de Caixa (local)

Referência: `PRD Épico 6.1`. Depende de M7.

- [ ] Cálculo do resumo do dia a partir da projeção local (total vendido, total por forma de pagamento, comandas fechadas vs. pendentes) — PRD 6.1.
- [ ] Tela de fechamento de caixa (dono/caixa).

**Critério de saída do M8:** o MVP funcional em **um único terminal, 100% offline**, está completo.

**M8 é um checkpoint de ir/não ir, não só um marco de demo.** Antes de investir no M9 (o milestone de maior risco técnico do projeto), vale usar esse ponto para validar a tese central do produto: o fluxo single-terminal (mesas, comandas, cardápio, fechamento) já resolve o problema de verdade para um bar pequeno como o do cliente-zero? Se a reação real ao produto funcionando aqui não convencer ninguém a querer usar, é muito mais barato descobrir isso agora do que depois de construir sync LAN inteiro. Recomenda-se uma demo real com o cliente-zero neste ponto antes de seguir para o M9.

---

## M9 — Sync LAN + Backend + Sync com a nuvem

Referência: `PRD Épico 7`, `ARCH §2, §5`. Este é o milestone de maior risco técnico do projeto — o M0/M1 deveriam ter reduzido boa parte da incerteza antes de chegar aqui.

- [ ] Backend (`apps/backend`): API de ingestão de eventos (recebe lote de eventos de um terminal, autenticado por credencial de terminal).
- [ ] Backend: projeção materializada em PostgreSQL (mesmo motor de `aplicarEvento` do `sync-engine`, reaproveitado).
- [ ] Backend: cadastro/pareamento de terminal (emissão de credencial vinculada ao estabelecimento).
- [ ] Sidecar: servidor de sync LAN (aceita conexões de outros terminais, autenticado por token de pareamento local) — `ARCH §2, §7`.
- [ ] Sidecar: integração de descoberta mDNS (reaproveitando o Spike 2 do M0) + fallback de IP manual.
- [ ] Sidecar: cliente de sync — tenta host primeiro, cai para qualquer peer alcançável se host estiver fora — `ARCH §2, item 3`.
- [ ] Sidecar: cliente de sync com a nuvem, independente do sync LAN (`ARCH §5`).
- [ ] UI: notificação visível e não bloqueante quando um merge automático de conflito acontece no terminal (`ARCH §4.2`, decisão de não deixar silencioso).

**Critério de saída do M9:** dois terminais na mesma rede local sincronizam entre si e com a nuvem; queda do host não bloqueia os demais terminais (testar isso explicitamente, não só assumir).

---

## M10 — Épico 8: Freemium e Gestão de Plano

Referência: `PRD Épico 8`, `ARCH §6`. Depende de M9 (precisa do backend e do sync).

- [ ] Backend: tabela de planos/assinaturas (`max_comandas_simultaneas`, `max_terminais`).
- [ ] Sidecar: cache local do plano, atualizado a cada sync com a nuvem.
- [ ] Enforcement real de limite de terminais (bloqueio de 2º terminal no free) — substitui o valor fixo usado provisoriamente no M5.
- [ ] Enforcement de limite de comandas usando o valor vindo do plano (não mais hardcoded).

---

## M11 — Épico 6.2: Endpoint de relatórios read-only

Referência: `PRD 6.2`, `ARCH §5`. Pode ser feito em paralelo ao M10, já que ambos dependem só do backend estar de pé (M9).

- [ ] Endpoint read-only no backend consultando a projeção PostgreSQL (ex: fechamento do dia por estabelecimento).
- [ ] Sem tela associada no MVP — validação de "pronto" é o endpoint responder corretamente, conforme decidido no PRD.

---

## M12 — QA de concorrência e hardening

Referência: `PRD 7.4`, `ARCH §9, item 4`.

- [ ] Cenários sintéticos de concorrência multi-terminal (2+ terminais lançando pedido na mesma mesa simultaneamente, incluindo o caso de conflito do `ARCH §4.2`).
- [ ] Revisão de segurança: hashing de PIN, autenticação do servidor de sync LAN, HTTPS/credenciais do sync com a nuvem — `ARCH §7`.
- [ ] Teste de empacotamento/instalação em Windows real (não só build local no Mac) — `ARCH §10`.

---

## Notas de sequenciamento

- **M0 e M1 são inegociáveis primeiro** — construir telas antes de validar o motor de sync/reconciliação é o caminho mais provável para retrabalho caro depois.
- **M3 e M4 podem ser feitos em qualquer ordem entre si** (não há dependência direta), mas ambos precisam vir antes do M6.
- **M9 é o milestone que valida a arquitetura mais arriscada do projeto** — vale considerar uma demo interna com 2 terminais reais (não só emulador) antes de seguir para M10/M11.
- Este plano assume desenvolvimento solo sequencial. Se em algum momento houver mais de uma pessoa, M3/M4 e partes de M11 são candidatos naturais a paralelização, já que têm baixo acoplamento com o núcleo de sync.
