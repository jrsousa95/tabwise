# Spike 2 — Descoberta mDNS entre terminais

**Referência:** `docs/architecture.md` §2 (decisão 2), `docs/implementation-plan.md` M0
**Data:** 2026-09-20
**Status:** ✅ Validado — protótipo local e teste real cross-device em 2 redes diferentes (Mac + iPhone via app de Bonjour Browser)

## O que foi testado

Provar que dois terminais conseguem se achar automaticamente na rede local via mDNS/Bonjour (ARCH §2, decisão 2: "cada terminal anuncia sua presença... biblioteca Node, ex: `bonjour-service`"), sem precisar digitar IP manualmente — e entender se isso funciona de forma confiável em redes Wi-Fi "de verdade" (não só localhost), inclusive numa rede diferente da rede de desenvolvimento.

**Por que este spike não pode ser fechado só com este agente, ao contrário do Spike 1:** o Spike 1 usou um runner `windows-latest` do GitHub Actions porque isso *é* uma máquina Windows real. Não existe equivalente pra "uma rede Wi-Fi doméstica com um roteador de verdade, com um segundo dispositivo físico do outro lado" — isso só se valida com hardware físico, que só o usuário tem acesso.

## Implementação

Protótipo isolado em `spikes/spike-2-mdns/` (mesmo padrão de isolamento dos Spikes 1 e 3 — pacote TS standalone, fora do workspace npm):

- `src/anunciar.ts`: publica um serviço `_passaaregua._tcp.local` via `bonjour-service` (nome, porta e um TXT record com `terminalId`). CLI: `npm run anunciar -- --nome T1 --porta 4550`.
- `src/descobrir.ts`: fica escutando a rede e loga em tempo real quando um serviço aparece (`up`, com endereços IP resolvidos e tempo decorrido desde o início da busca) ou desaparece (`down`, goodbye packet). CLI: `npm run descobrir`.
- `src/args.ts`, `src/config.ts`: parsing de argumentos e constantes, sem dependência extra.
- Ambos os processos tratam `SIGINT`/`SIGTERM` fazendo `unpublish`/`destroy` — importante pra simular um terminal sendo desligado normalmente (o outro lado deve ver o evento `down`, não só parar de ouvir silenciosamente).

## Resultado (validação local, nesta máquina)

Rodei os dois processos nesta máquina (`descobrir` num processo, `anunciar` noutro, ambos usando a interface Wi-Fi real `en0`, IP `192.168.0.7` — não localhost):

- **Descoberta:** `descobrir` encontrou o serviço publicado por `anunciar` em **~2,9s** após iniciar a busca, resolvendo corretamente o IPv4 real da máquina (`192.168.0.7`) e IPv6 link-local.
- **Saída (goodbye packet):** ao encerrar `anunciar` com `SIGINT`, `descobrir` recebeu o evento `down` corretamente (~poucos segundos depois), confirmando que o desligamento normal de um terminal é detectável pelo outro lado, não só timeout.
- **Efeito colateral notado:** rodar dois processos `anunciar` distintos nesta máquina em sequência rápida fez o `mDNSResponder` do macOS detectar um "conflito" de hostname local e renomear automaticamente (`MacBook-Air-de-Eudes.local` → `-2`) — cosmético, não afeta a lógica do protótipo, mas mostra que o SO tem sua própria camada de resolução de nome mDNS rodando por baixo (relevante ter em mente pro M9, não é bug deste spike).

Isso confirma que **o código funciona** — mas não prova nada sobre o risco real identificado no ARCH §9 ("roteadores de baixo custo têm suporte inconsistente a multicast"), porque os dois processos nunca saíram desta máquina: não passaram pelo comportamento de forwarding de multicast entre portas de um roteador/AP de verdade.

## Validação real: 2 dispositivos físicos, 2 redes

Como não havia um segundo notebook disponível, a validação cross-device foi feita com o Mac rodando `anunciar` e um **iPhone 12 rodando um app de Bonjour/DNS-SD Browser** (busca manual pelo tipo de serviço `_passaaregua._tcp`) — um dispositivo genuinamente diferente, participando da rede pelo próprio rádio Wi-Fi, exatamente o cenário que o roteador precisa suportar.

- **Rede 1 (Wi-Fi de casa):** ✅ funcionou. O iPhone encontrou `mac-eudes._passaaregua._tcp.local.`, com IPv4 real (`192.168.0.7`), IPv6 e o TXT record completo (`terminalId`, `iniciadoEm`), em poucos segundos.
- **Rede 2 (hotspot pessoal do iPhone):** ✅ funcionou, confirmado numa segunda rodada sem ambiguidade — a primeira tentativa tinha ficado inconclusiva porque o processo `anunciar` não foi reiniciado ao trocar de rede (o `iniciadoEm` idêntico ao teste anterior denunciou isso). Reiniciando o `anunciar` já com o Mac conectado no hotspot: IPv4 mudou para `172.20.10.9` (faixa característica do Personal Hotspot da Apple) e `iniciadoEm` com timestamp novo — confirma que foi uma descoberta fresca, de verdade, nessa rede. O iPhone encontrou o serviço normalmente.
- **Firewall/permissões:** nenhum prompt do macOS apareceu em nenhum dos dois testes.
- **Testado só num sentido** (Mac anuncia, iPhone descobre) — suficiente pro objetivo do spike, já que o iPhone nunca vai rodar o software de produto; o que importa é provar que o roteador/AP encaminha multicast entre dispositivos diferentes, o que ficou confirmado nas duas redes.

**Observação lateral (não é um problema):** o hostname local do Mac (`MacBook-Air-de-Eudes.local`) foi renomeado automaticamente pelo `mDNSResponder` do macOS (`-3`, depois `-4`) durante os testes, por causa dos processos de teste anteriores rodados em sequência nesta mesma sessão — cosmético, não afeta a lógica de descoberta.

## Conclusão

**mDNS/Bonjour funciona de forma confiável nas duas redes testadas**, incluindo a mais "hostil" das duas (hotspot de celular, que tem uma pilha de rede diferente de um roteador doméstico convencional). Isso dá confiança suficiente para seguir com a decisão do ARCH §2 (descoberta automática com fallback manual) sem replanejamento de arquitetura. O fallback manual de IP continua recomendado (ARCH §2) para o caso de redes comerciais mais restritivas (ex: Wi-Fi corporativo de shopping, VLANs separando dispositivos) que não foram e não podiam ser testadas aqui.

## Pendências conhecidas (ficam pro M9)

1. **Fallback manual de IP** (ARCH §2, decisão 2) não foi prototipado aqui — é só um campo de configuração na UI, sem risco técnico; entra no M9 junto com o resto do sync LAN.
2. Não testado o cenário de **múltiplos terminais simultâneos** (3+), nem redes comerciais mais restritivas (Wi-Fi corporativo, VLANs) — as duas redes disponíveis pra teste (casa + hotspot) funcionaram bem, então não geramos um caso real de "multicast bloqueado" pra validar o fallback manual. Fica como risco residual conhecido, não eliminado por este spike.

## Como rodar

```bash
cd spikes/spike-2-mdns
npm install
npm run typecheck

# terminal 1
npm run descobrir

# terminal 2 (mesma máquina, só pra conferir que o código funciona)
npm run anunciar -- --nome teste --porta 4550
```
