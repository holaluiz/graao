# Graao Host — arquitetura

**Quem quer jogar abre o site. Quem quer hospedar instala o Graao Host uma vez.** Cada host contribui com o próprio PC
para executar uma partida; o graao só autoriza, lista e conecta.

```
                         SITE graao (Vercel, Three.js)
                 lista de salas · Criar e hospedar · Entrar
                    |                    |                 \
        RPC (chave publicável)    graao-host://host?t=…&s=…   wss://h-xxxx.play.graao.com
                    |                    |                     (ou wss://….trycloudflare.com em teste)
                    v                    v                      \
   SUPABASE (projeto graao)        GRAAO HOST (PC do host)       \
   · Auth (anônimo/conta)          Electron (janela + bandeja)     CLOUDFLARE (borda)
   · host_tickets (pedidos)        HostController (estado)              |
   · host_installations            utilityProcess: servidor ◄──── cloudflared (túnel de saída)
   · host_sessions (privado)         Colyseus 0.18 + GraaoMatchRoom
   · host_rooms (lista)              Rapier, bots, armas, magias,
   · Edge Function                   baús, OVNI, Tormenta
     graao-host-tunnel  ──API──►  Cloudflare (cria túnel, DNS, token)
```

## Peças

| Peça | Onde | Responsabilidade |
|---|---|---|
| `GraaoMatchRoom` | `apps/server/src/rooms` | A partida, **o mesmo código** do servidor dedicado e das salas no navegador |
| Política de hospedagem | `apps/server/src/hostPolicy.ts` | Única diferença entre `HOST_MODE=DEDICATED` (padrão) e `HOST_MODE=DESKTOP` (alias `GRAAO_HOST_MODE=LOCAL_PLAYER_HOST`): quem cria salas, quem é o host, se a sala fecha com o host, autodescarte |
| `DesktopHost` | `apps/server/src/desktop/DesktopHost.ts` | Servidor do PC do host: escuta só em `127.0.0.1` (porta livre), abre/fecha a única sala por comando do app, relata sala + métricas a cada segundo |
| Entrada do processo | `apps/server/src/desktop/main.ts` → `graao-server.mjs` | Canal com o app (`process.parentPort` no Electron, `process.send` em testes); modo avulso para checagem de empacotamento |
| Bundle | `apps/server/build-desktop.mjs` | Um único `.mjs` (≈ 6,3 MB) com Colyseus, `ws`, express, Rapier (WASM embutido) e os pacotes do jogo; `NODE_ENV=production` fixo |
| App | `apps/host` | Electron 43: `main.ts` (janela, bandeja, protocolo, IPC), `HostController.ts` (ciclo de vida), `tunnel.ts`, `store.ts`, `serverProcess.ts`, janela em `renderer/` |
| Instalador | `apps/host/package.json` (`build`) + `resources/installer.nsh` | NSIS por usuário, registra `graao-host://`, atalhos, desinstalador |
| Central | `packages/database/migrations/0003_graao_host.sql` | Tabelas com RLS sem políticas + funções `security definer` |
| Túneis gerenciados | `supabase/functions/graao-host-tunnel` | Token administrativo da Cloudflare só aqui |
| Site | `apps/client/src/net/graaoHost/hostSite.ts`, `ui/HostSetupDialog.ts`, `ui/RoomBrowser.ts`, `app/GraaoApp.ts` | Criar e hospedar, painel de instalação, lista mesclada, entrar pelo endpoint, "O HOST ENCERROU A PARTIDA" |
| Tipos compartilhados | `packages/shared/src/hosting.ts` | `GraaoPublicRoom`, `GraaoHostRegistration`, deep link, mensagens app↔servidor, cliente da API central |

## Fluxo "Criar e hospedar"

1. O jogador (sessão Supabase anônima ou com conta) preenche nome, visibilidade e bots (0–9) e clica **Criar e
   hospedar**.
2. O site gera um segredo aleatório, chama `host_ticket_create(sha256(segredo), …)` e abre
   `graao-host://host?t=<ticket>&s=<segredo>` (segredo de uso único, válido por 5 minutos).
3. O navegador pede permissão para abrir o Graao Host. Sem resposta em 8 s o site mostra o painel de instalação
   (o que é, por que, tamanho, aviso do SmartScreen, **Baixar** e **Já instalei — abrir de novo**).
4. O app (Windows entrega o link à instância já aberta) consulta o ticket (`host_ticket_peek`). Se este PC ainda não
   está vinculado à conta, **pede confirmação** na janela. Depois `host_ticket_claim` devolve: id da instalação, token
   de sessão (12 h, renovado pelo heartbeat), código da sala alocado pela central (único entre salas ativas) e o modo de
   túnel.
5. `STARTING_SERVER`: inicia o processo do servidor, espera `listening`, abre a sala com o código e o SHA-256 do
   segredo do ticket (chave de dono).
6. `CONNECTING_TUNNEL`: túnel gerenciado (token da Edge Function) ou de teste; espera o registro, o DNS público e
   **`/health` respondendo pelo endereço público**.
7. `REGISTERING_ROOM`: `host_room_publish` — só agora a sala aparece na lista e o ticket fica `READY` com o endpoint.
8. O site (que acompanha o ticket a cada segundo) entra com `joinById` no endpoint, mandando a chave de dono:
   vira o host da sala. Convidados resolvem `código → endpoint` (`host_room_endpoint`) e entram **sem** token.
9. Heartbeat a cada 5 s com as contagens da própria sala. A lista esconde salas sem heartbeat há 30 s e fecha após 2 min.

## Modos de execução

| | DEDICATED (padrão) | DESKTOP (Graao Host) |
|---|---|---|
| Quem cria salas | Qualquer cliente (`create`) | Só o app (chave secreta do processo); `create` da rede é recusado |
| Host da sala | Primeiro a entrar | Quem apresenta a chave de dono (também após recarregar) |
| Host sai | Sala fecha (`HOST_LEFT`) | Sala continua; o host pode voltar |
| Sala vazia | Descartada | Fica no lobby até o app encerrar |
| Escuta | `PORT` em todas as interfaces | `127.0.0.1`, porta livre |
| Token Supabase dos jogadores | Verificado (JWKS) | Não é enviado a PCs de terceiros |
| Resultados no histórico | Sim (segredo do servidor) | Não (partida casual; host controla o processo) |

O servidor dedicado (Fly/Docker, `pnpm dev`, testes) e as salas no navegador (WebRTC, decisão anterior) continuam
funcionando para regressão. O mesmo `GraaoMatchRoom` roda nos três.

## Limites do MVP

- Uma sala ativa por instalação; até 10 participantes (humanos + bots), bots ocupam vagas livres e cedem a pessoas até
  o Draft.
- Sem migração de host: o host sai, a partida acaba para todos.
- Windows 10/11 x64.
- Partidas do Graao Host não vão para ranking/histórico.
