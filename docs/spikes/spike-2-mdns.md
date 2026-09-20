# Spike 2 — Descoberta mDNS entre terminais

**Referência:** `docs/architecture.md` §2 (decisão 2), `docs/implementation-plan.md` M0
**Data:** 2026-09-20
**Status:** 🟡 Protótipo construído e validado localmente — validação cross-device/cross-rede pendente (precisa rodar em 2 máquinas físicas, não é algo que dá pra terceirizar pra CI como o Spike 1)

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

## Pendente: validação real entre 2 dispositivos, em 2 redes

Ver seção "Como rodar o teste real" abaixo. Preencher esta seção depois de rodar:

- [ ] Rede 1 (Wi-Fi de casa): descoberta funcionou? Em quanto tempo?
- [ ] Rede 2 (hotspot pessoal do iPhone): descoberta funcionou? Em quanto tempo?
- [ ] Testado nos dois sentidos (cada máquina anunciando e descobrindo)?
- [ ] Algum firewall/prompt do SO precisou ser liberado manualmente?

## Como rodar o teste real (2 dispositivos, 2 redes)

Em **cada** uma das duas máquinas:

```bash
git pull
cd spikes/spike-2-mdns
npm install
```

**Rede 1 (Wi-Fi de casa)** — ambas as máquinas conectadas à mesma rede:

- Máquina A: `npm run descobrir`
- Máquina B: `npm run anunciar -- --nome maquina-b --porta 4550`
- Esperado: a Máquina A imprime `ENCONTRADO` com o nome, host e IP da Máquina B em poucos segundos.
- Repita invertendo os papéis (A anuncia, B descobre), pra confirmar que funciona nos dois sentidos.
- No macOS, pode aparecer um prompt de firewall ("Deseja permitir que o app aceite conexões de entrada?") — precisa clicar em Permitir, senão a descoberta falha silenciosamente. **Isso já é um dado relevante pro relatório** (mesma preocupação existe no Windows, com o Windows Defender Firewall, ver `ARCH §9`/M12).

**Rede 2 (hotspot do iPhone)** — ativar o Ajuste Pessoal (Personal Hotspot) no iPhone e conectar as duas máquinas nele, depois repetir os mesmos passos acima.

Depois de rodar, me conta o resultado (funcionou/não funcionou em cada rede, quanto tempo levou, algum prompt de permissão) que eu atualizo este documento e o `implementation-plan.md`.

## Pendências conhecidas (não bloqueiam o teste acima, mas ficam pro M9)

1. **Fallback manual de IP** (ARCH §2, decisão 2) não foi prototipado aqui — é só um campo de configuração na UI, sem risco técnico; entra no M9 junto com o resto do sync LAN.
2. Não testado o cenário de **múltiplos terminais simultâneos** (3+) nem o de **rede sem suporte a multicast** de verdade (só temos como testar "funciona" ou "não funciona" nas redes disponíveis — não temos um roteador conhecidamente ruim à mão). Se a Rede 2 (hotspot) falhar, isso já serve como um caso real de "multicast não funciona nessa rede" pra validar o fallback manual no M9.

## Como rodar (local, sanity check rápido antes do teste real)

```bash
cd spikes/spike-2-mdns
npm install
npm run typecheck

# terminal 1
npm run descobrir

# terminal 2 (mesma máquina, só pra conferir que o código funciona)
npm run anunciar -- --nome teste --porta 4550
```
