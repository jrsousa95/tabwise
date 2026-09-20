# Arquitetura — Passa a Régua

**Fase:** Arquitetura (BMAD — Architect)
**Data:** 2026-09-20
**Baseado em:** `docs/project-brief.md`, `docs/prd.md`
**Status:** Rascunho para revisão antes do início da implementação

---

## 1. Princípio unificador

O sistema inteiro é construído em torno de uma única ideia: **cada terminal mantém um log de eventos append-only, e sincronizar significa trocar e mesclar esses logs — não importa se o peer é outro terminal na mesma rede ou o backend na nuvem.**

Isso significa que **LAN sync e cloud sync usam o mesmo protocolo de replicação**, apenas com transportes diferentes (WebSocket/HTTP local vs. HTTPS pela internet). O backend na nuvem não é uma entidade arquiteturalmente diferente de um terminal — é só mais um peer, só que permanente e privilegiado (fonte de verdade para plano/limites, agregador multi-unidade para relatórios).

Essa unificação existe porque o PRD já exige (§ Épico 7, NFR2/NFR3) que nenhum terminal dependa de outro para funcionar, e que os dados de comanda sejam eventos append-only. Uma vez que você aceita essas duas premissas, ter dois protocolos de sync diferentes (um pra LAN, outro pra nuvem) seria trabalho duplicado sem necessidade.

## 2. Decisões fundacionais desta fase

1. **Runtime local: sidecar Node.js/TS** embutido no app Tauri (via [Tauri sidecar](https://tauri.app/develop/sidecar/)). Todo o motor de sync, o SQLite local e a lógica de reconciliação rodam em TypeScript — o mesmo pacote de lógica de eventos é compartilhado com o backend na nuvem (`packages/sync-engine`, ver seção 9). O Rust do Tauri fica restrito a: abrir o processo sidecar, IPC entre webview e sidecar, e capacidades nativas do SO (ex: impressão futura).
   *Por quê:* máximo reaproveitamento de código entre local e nuvem, e a parte de maior risco técnico do projeto (event sourcing + reconciliação) fica na linguagem onde você tem 5+ anos de experiência.

2. **Descoberta LAN: mDNS/Bonjour automático com fallback manual.** Cada terminal anuncia sua presença na rede local via mDNS (biblioteca Node, ex: `bonjour-service` ou `multicast-dns`). Se a rede do estabelecimento bloquear multicast (comum em roteadores de baixo custo), o operador pode digitar o IP/porta do host manualmente nas configurações do terminal como fallback.

3. **"Host" é um papel de prioridade, não um caminho de código diferente.** Todo terminal roda exatamente o mesmo software (mesmo sidecar, mesma lógica de sync). "Host" é apenas o terminal que a UI trata como referência (ex: primeiro a ser configurado, geralmente o do caixa). Na prática:
   - Cada terminal tenta sincronizar com o host primeiro.
   - Se o host estiver inacessível, o terminal tenta sincronizar com **qualquer outro terminal alcançável na LAN** (o protocolo é simétrico — qualquer terminal pode aceitar conexões de sync de qualquer outro).
   - Isso cobre um cenário que o PRD não detalhava explicitamente: se o host (PC do caixa) cair, dois tablets de garçom ainda conseguem sincronizar *entre si* diretamente, em vez de ficarem isolados até o host voltar. Isso fortalece o NFR2 do PRD ("nenhum terminal pode ficar bloqueado pela queda de outro") sem custo extra de implementação, porque é a mesma lógica de sync, só apontando para um peer diferente.
   - **Isso é uma extensão da decisão do brief/PRD, não uma contradição** — a topologia "host local" continua sendo o caminho preferencial e a UI continua mostrando o host como referência da unidade; a diferença é que o Architect está removendo o host como *ponto único de sync* sem custo adicional de engenharia.

## 3. Modelo de dados

### 3.1 Camada de eventos (fonte de verdade, append-only)

Cada terminal mantém uma tabela `events` no SQLite local:

| Campo | Tipo | Descrição |
|---|---|---|
| `id` | TEXT (ULID) | Identificador do evento, ordenável por tempo de criação |
| `hlc` | TEXT | Hybrid Logical Clock — timestamp lógico usado para ordenação causal entre terminais (ver § 3.3) |
| `aggregate_type` | TEXT | Ex: `order`, `table`, `operator` |
| `aggregate_id` | TEXT | Id da entidade afetada (ex: id da comanda) |
| `type` | TEXT | Ex: `item_added`, `item_canceled`, `order_opened`, `order_transferred`, `order_closed`, `tables_grouped` |
| `payload` | JSON | Dados específicos do evento |
| `operator_id` | TEXT | Quem gerou o evento (obrigatório — decorre da exigência de auditoria do PRD) |
| `terminal_id` | TEXT | De qual terminal o evento se originou |
| `created_at` | INTEGER | Timestamp de parede (wall-clock), só para exibição — nunca usado para ordenação de conflito |

Eventos **nunca são editados ou apagados** — um cancelamento é um novo evento (`item_canceled`) que referencia o evento original, não uma remoção.

### 3.2 Camada de leitura (materializada, derivada dos eventos)

Para a UI responder rápido, cada terminal também mantém tabelas "normais" (mutáveis), que são **projeções recalculadas a partir do replay dos eventos** em ordem de HLC:

- `tables` (id, identificador, status)
- `orders` (id, table_id nullable, status, opened_at, closed_at)
- `order_items` (estado atual — já refletindo cancelamentos aplicados)
- `payments` (registros de fechamento, splits)
- `table_groups` (vínculo visual de mesas "juntas", PRD história 2.6)

Essas tabelas são **descartáveis e reconstruíveis** a qualquer momento a partir do log de eventos — isso é o que torna a reconciliação segura: se dois terminais mesclam seus logs de eventos, cada um recalcula sua camada de leitura do zero (ou incrementalmente) e chega ao mesmo estado, porque a função "aplicar eventos em ordem de HLC" é determinística.

### 3.3 Ordenação causal: Hybrid Logical Clock (HLC)

Relógios de parede de terminais diferentes não são confiáveis para decidir "o que aconteceu primeiro" (podem estar dessincronizados). Por isso, cada terminal mantém um **HLC** (combinação de timestamp físico + contador lógico), que é incrementado a cada evento local e ajustado ao receber eventos de outros terminais — garantindo que, se o evento A causou o evento B, o HLC de A é sempre menor que o de B, independente do relógio de cada máquina.

Isso é uma peça de infraestrutura pequena (uma biblioteca de ~100 linhas), mas é o que torna a reconciliação determinística. Recomendo usar uma biblioteca existente (ex: `@clockwork/hlc` ou implementação própria baseada no paper original de Kulkarni et al.) em vez de reinventar.

## 4. Reconciliação — casos especiais

### 4.1 Caso feliz (a maioria dos eventos)
Itens adicionados a uma comanda por terminais diferentes simplesmente se unem no log — não há conflito real porque "adicionar item" é uma operação que comuta (a ordem não muda o resultado final: a lista de itens da comanda).

### 4.2 Caso de conflito real: duas comandas abertas na mesma mesa
Cenário: o host cai; dois garçons em terminais diferentes, sem conseguir se enxergar na LAN, cada um abre uma comanda para a "mesa 5" (ex: um não viu que o outro já tinha aberto, ou acharam que a mesa tinha ficado livre). Quando os logs se mesclam, existem dois eventos `order_opened` para a mesma mesa.

**Regra de resolução (confirmada):** o evento com o **menor HLC** (o que aconteceu primeiro, causalmente) é a comanda canônica; o segundo evento é reclassificado automaticamente como se fosse uma continuação da primeira comanda (seus itens são reatribuídos à comanda canônica). **O merge é automático e não bloqueia ninguém** — não exige decisão manual no meio do rush.

**Mas não é silencioso.** O risco identificado: se os itens forem reatribuídos sem nenhum sinal visível, o cliente pode ver na conta, no fechamento, itens que não reconhece — e o garçom/caixa não vai saber explicar por quê, porque nunca foram avisados de que o merge aconteceu. Por isso, assim que o terminal que "perdeu" a comanda sincroniza e recebe o merge, ele exibe um indicador não bloqueante na tela (ex: "⚠️ 1 comanda foi mesclada automaticamente — ver detalhes"), permitindo ao operador conferir com o cliente antes do fechamento. O registro de auditoria completo continua existindo e visível ao dono, além dessa notificação no terminal.

### 4.3 Idempotência
Como cada evento tem um `id` único (ULID), reaplicar o mesmo evento duas vezes (ex: por causa de uma sincronização retomada após queda de conexão) é seguro — o merge é feito por `UNION`/`UPSERT` por `id`, nunca por reprocessamento cego.

## 5. Sincronização com a nuvem

O backend (Node/TS + PostgreSQL) participa do mesmo protocolo de replicação de eventos descrito acima, com duas diferenças práticas:

- **Transporte:** HTTPS/WebSocket pela internet, autenticado com uma credencial de terminal (emitida no momento do cadastro/pareamento do terminal com a conta do estabelecimento).
- **Papel:** cada terminal sincroniza com a nuvem **diretamente e de forma independente** quando tiver internet — não depende do host local para isso. Isso é importante operacionalmente: se o tablet do garçom tem Wi-Fi/dados e o PC do caixa não, os dados desse tablet ainda chegam à nuvem sem esperar o caixa se conectar.

O backend mantém sua própria camada de leitura materializada em PostgreSQL (mesma lógica de replay de eventos, só que agregando todos os terminais de todos os estabelecimentos), que alimenta:
- O endpoint de relatórios read-only (PRD Épico 6.2)
- A fonte de verdade dos limites de plano (PRD Épico 8)

## 6. Enforcement de limites de plano (freemium)

- O backend é a **fonte de verdade** dos limites (`max_concurrent_orders`, `max_terminals`) por estabelecimento, guardados em uma tabela `planos`/`assinaturas` no Postgres.
- Cada terminal mantém uma **cópia local em cache** desses limites (atualizada a cada sync com a nuvem) e faz o enforcement **localmente e offline**, usando o valor em cache.
- Consequência aceita: se o dono faz upgrade de plano enquanto o terminal está offline, o novo limite só passa a valer no próximo sync — isso é esperado e aceitável (não é um requisito de tempo real).
- Downgrade com dados excedentes: conforme já decidido no PRD (§ 2.7), comandas já abertas não são bloqueadas retroativamente — a trava só impede novas aberturas até a contagem cair abaixo do limite.

## 7. Segurança

- **PIN de operador:** armazenado com hash (ex: bcrypt/argon2), nunca em texto plano — mesmo sendo um PIN curto, não há razão para guardá-lo reversível.
- **Servidor de sync LAN:** cada terminal expõe uma porta local para receber conexões de sync de outros terminais. Isso precisa de autenticação mínima (ex: um token compartilhado gerado no momento do pareamento entre terminais do mesmo estabelecimento) para impedir que qualquer dispositivo na rede Wi-Fi do bar (ex: celular de um cliente na mesma rede) consiga ler ou injetar eventos.
- **Sync com a nuvem:** HTTPS obrigatório; credencial de terminal com escopo limitado ao próprio estabelecimento (nunca acesso cross-tenant).

## 8. Estrutura de projeto sugerida (monorepo)

```
passa-a-regua/
  apps/
    desktop/           # Tauri + React + TS (UI)
      src-tauri/        # Rust: shell, IPC, gerenciamento do sidecar
      src/               # React/TS: telas de mesas, comandas, caixa
      sidecar/           # Node/TS: SQLite local, servidor de sync LAN, motor de eventos
    backend/            # Node + TS + PostgreSQL (API de sync + relatórios)
  packages/
    sync-engine/        # TS compartilhado: HLC, aplicação de eventos, regras de reconciliação
    shared-types/       # Tipos/schemas de eventos compartilhados entre desktop e backend
  docs/
    project-brief.md
    prd.md
    architecture.md
```

O pacote `sync-engine` é o coração técnico do projeto e deve ser desenvolvido com testes de propriedade (property-based testing) desde o início — reconciliação de eventos é exatamente o tipo de lógica onde bugs sutis só aparecem em cenários de concorrência raros.

## 9. Riscos técnicos e spikes recomendados antes de codar o MVP completo

Dado que esse é o componente de maior incerteza técnica do projeto, recomendo protótipos isolados (spikes de 1-3 dias cada) antes de comprometer o cronograma do MVP:

1. **Spike de sidecar Tauri:** validar que um processo Node embutido via Tauri sidecar consome, instala e atualiza de forma confiável em **Windows** (SO alvo de lançamento — ver § 10) — inclusive em ambientes sem Node instalado globalmente. Como o desenvolvimento acontece em macOS, o Tauri já suporta build cross-platform nativamente (macOS/Windows/Linux), mas o empacotamento do sidecar Node precisa de binário correto por plataforma (`tauri.conf.json` + target triples) — validar isso cedo evita surpresa só na hora de gerar o instalador Windows a partir do Mac.
2. **Spike de mDNS em redes de bar reais:** testar descoberta automática em pelo menos 2-3 redes Wi-Fi domésticas/comerciais típicas, já que roteadores de baixo custo têm suporte inconsistente a multicast.
3. **Spike de reconciliação:** simular o cenário do § 4.2 (duas comandas abertas na mesma mesa) com testes automatizados, validando que o merge determinístico realmente produz o mesmo estado final em qualquer ordem de chegada dos eventos.
4. Reafirma o item já registrado no PRD (Épico 7.4): cenários sintéticos de concorrência multi-terminal precisam existir no plano de QA antes do lançamento do plano pago.

## 10. Ambiente de desenvolvimento vs. plataforma de lançamento

- **SO alvo de lançamento: Windows** — confirmado como suposição de lançamento (não precisa de pesquisa formal), coerente com o mercado de PDV para pequeno negócio no Brasil (SAIPOS, Consumer etc. também miram Windows, que já vem nos PCs vendidos para esse público).
- **Ambiente de desenvolvimento: macOS.** Tauri suporta build cross-platform nativamente, então isso não bloqueia o desenvolvimento — mas exige atenção ao empacotamento do sidecar Node por plataforma (ver spike 1, § 9) e testes periódicos em Windows real antes de cada release, não só builds locais no Mac.

~~Merge automático e silencioso para comandas conflitantes~~ — **resolvido** (§ 4.2): merge automático mantido (não bloqueia o operador), mas passa a gerar uma notificação visível e não bloqueante no terminal afetado, além do registro de auditoria completo.

## 11. Próximos passos

1. Executar os spikes técnicos da seção 9 antes de iniciar a implementação dos épicos do PRD, com atenção especial ao empacotamento cross-platform (Mac → Windows) no spike 1.
2. Handoff para o time de desenvolvimento (ou agente Dev do BMAD) para iniciar a implementação, começando pelo pacote `sync-engine` (base de tudo) e pelo Épico 1 (Autenticação e Operadores) do PRD.
