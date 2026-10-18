# Graao Host — ciclo de vida

Implementado em `apps/host/src/main/HostController.ts` (sem dependência de Electron: o mesmo código roda no app, no
executor headless e nos testes).

```
NOT_INSTALLED (só o site sabe: ninguém respondeu ao link em 8 s)
      |
      v
IDLE (instalado, nada hospedado)  ◄──────────────────────────────┐
      | link graao-host://host                                    |
      v                                                           |
PAIRING ── PC não vinculado → espera "Vincular e hospedar"        |
      | claim                                                     |
      v                                                           |
STARTING_SERVER ── processo do servidor, `listening`, sala aberta |
      v                                                           |
CONNECTING_TUNNEL ── túnel registrado + DNS + /health público     |
      v                                                           |
REGISTERING_ROOM ── host_room_publish                             |
      v                                                           |
READY (na lista, sem pessoas) ⇄ HOSTING (pessoas na sala)         |
      | Encerrar / Sair do app / revogado / central pede          |
      v                                                           |
STOPPING ── avisa jogadores, fecha sala, túnel, processo, central |
      v                                                           |
OFFLINE ──────────────────────────────────────────────────────────┘
ERROR (qualquer passo) ── explica; [Tentar novamente] refaz do último passo possível; [Voltar] encerra a sessão
```

## Erros

| Código | Quando | Pode tentar de novo |
|---|---|---|
| `server_start` | processo não iniciou / não respondeu em 30 s / sala não abriu | sim |
| `server_crashed` | processo morreu ou a sala foi descartada durante a hospedagem | sim |
| `tunnel` | `cloudflared` não iniciou, não registrou, DNS/`/health` público não responderam em 45 s, ou caiu | sim |
| `tunnel_unconfigured` | a central está em modo `managed` sem segredos da Cloudflare | não |
| `provisioning` | a Edge Function falhou / endpoint recusado | sim |
| `version` | protocolo do site ≠ do app, ou versão abaixo da mínima | não (botão Baixar atualização) |
| `auth` | sessão expirada, instalação revogada ou segredo inválido | não |
| `conflict` | PC vinculado a outra conta | não |
| `network` | central inacessível, muitas tentativas | sim |
| `busy` | já existe sala ativa neste PC (o ticket novo vira `host_busy` para o site) | — |

Sem laços infinitos: cada espera tem prazo; o túnel gerenciado se reconecta no máximo 3 vezes (2, 4, 6 s); um túnel de
teste que cai encerra a sala (o endereço mudaria); heartbeats que falham só mudam o indicador ("instável" → "sem
contato", a partida continua).

## Quando o host sai

| Caso | O que acontece | Medido |
|---|---|---|
| "Encerrar hospedagem" / sair do app | `NOTICE ROOM_CLOSED "O HOST ENCERROU A PARTIDA"` para todos, desconexão (código 4000), sala fecha na central | E2E + app real |
| App fechado pela janela durante a partida | Continua na bandeja (aviso uma vez); "Sair" na bandeja encerra como acima (até 8 s) | — |
| PC desligado / processo morto / internet perdida | Convidados caem (SDK tenta reconectar); a sala some da lista em 30 s; o site consulta a central a cada 5 s durante a queda e mostra **O HOST ENCERROU A PARTIDA** quando ela some | `packaged-check`: queda em 238–318 ms, fora da lista em 30 s; navegador: aviso em ≤ 40 s |
| Falha curta do host (< 20 s) | O servidor guarda a vaga (`allowReconnection` 20 s); a lista mantém a sala até 30 s sem heartbeat | — |

Convidados que saem: no lobby a vaga volta (bots previstos reocupam); na partida vale a regra atual (itens caem no
chão, o ledger registra a saída, sem jogador fantasma). A aba do host fechar **não** encerra a sala: o app continua
hospedando e o host volta com "Abrir sala no navegador".

## Processos

- O servidor é um `utilityProcess` (no app) com ambiente mínimo (`NODE_ENV=production`, `HOST_MODE=DESKTOP`); o
  `cloudflared` é filho do processo principal. Ao encerrar: `close` → `shutdown` → espera 5 s → `kill`.
- O processo do servidor sai sozinho quando o pai morre (`disconnect`), e o Electron encerra utility processes junto.
- Logs do servidor e do `cloudflared` vão para um buffer de 500 linhas (painel técnico), com tokens mascarados.
