# Graao Host — auditoria do projeto (GATE 0)

Data: 2026-10-18. Branch `mvp-online-1v1` (commit base `9f01d9c`, com trabalho paralelo não commitado de espectador e
corpo esculpido, que esta auditoria não altera).

Objetivo: decidir o que do servidor multiplayer atual pode ser empacotado e executado no PC de quem hospeda
(Graao Host) e o que depende de infraestrutura central.

## 1. Inventário

| Item | Situação encontrada | Onde |
|---|---|---|
| Colyseus | `@colyseus/core` **0.18.19**, `@colyseus/ws-transport` **0.18.4**, SDK `@colyseus/sdk` **0.18.5** | `apps/server/package.json`, `apps/client/package.json` |
| Ponto de entrada | `apps/server/src/index.ts` (top-level await; lê `apps/server/.env`; `--port`/`PORT`) | |
| Definição do servidor | `createGraaoServer()` em `apps/server/src/app.ts` (`defineServer`, uma sala `graao_match`, rotas `/rooms` e `/health`) | |
| Transporte | `WebSocketTransport({ pingInterval: 4000, pingMaxRetries: 3 })`; `maxPayload` padrão do transporte = **4 KB**, `perMessageDeflate` desligado | `@colyseus/ws-transport` |
| Gerenciamento de salas / matchmaking | Matchmaker padrão do Colyseus em memória (um processo). Códigos `GR-XXXX` gerados pela sala (`roomId`); `create`, `joinById`, reconexão (`allowReconnection`, 20 s) | `GraaoMatchRoom.onCreate` |
| Sala autoritativa | `GraaoMatchRoom` (1.721 linhas): movimento, combate hitscan, habilidades, loot, bots, Draft, preparação, OVNI, Tormenta, resultados | `apps/server/src/rooms/GraaoMatchRoom.ts` |
| Schemas | Não usa `@colyseus/schema` (patchRate `null`); mensagens próprias numeradas `C2S`/`S2C` validadas à mão | `packages/shared/src/protocol.ts`, `validate.ts` |
| Versões | `CLIENT_VERSION 0.9.0`, `PROTOCOL_VERSION 9` (a sala recusa outra versão no `onJoin`) | `packages/shared/src/version.ts` |
| Runtime | Node ≥ 22 (`engines`); máquina de desenvolvimento com Node 24.14 | `package.json` |
| Build atual | `esbuild` → `dist/server.mjs` com `@colyseus/*`, `ws`, `msgpackr`, Rapier **externos**; Docker instala os externos via `runtime-package.json` | `apps/server/build.mjs`, `Dockerfile` |
| Dependências nativas | Nenhuma obrigatória. `msgpackr-extract` (addon opcional, cai para JS puro), `bufferutil`/`utf-8-validate` (opcionais do `ws`) | |
| Rapier | `@dimforge/rapier3d-compat` **0.21.0**: o WASM vem embutido em base64 no JS — empacotável num único arquivo | |
| Mundo | 100% procedural (`createGameWorld({ includeVisual: false })`), sem leitura de arquivos/GLB no servidor; construído uma vez por processo | `apps/server/src/world.ts`, `packages/game-core` |
| Bots | Até 9 por sala (`MAX_SOLO_BOTS`), entidades da simulação (sem WebSocket). Planejados no LOBBY, instanciados ao iniciar o Draft. IA em `BotBrain.ts` + `updateBots` (perseguição, mira, Draft automático) | `apps/server/src/sim` |
| Armas | 6 (`sunbeam`, `petal`, `pistol`, `sniper`, `smg`, `launcher`), munição, recarga, troca, dispersão determinística | `packages/game-data/src/weapons.ts` |
| Habilidades | **12 no catálogo (9 básicas + 3 supremas), sem passivas.** O "catálogo das 40 magias" citado no pedido **não existe no código**; o Graao Host executa o catálogo que existir, sem mudança | `packages/game-data/src/abilities.ts` |
| Ability Draft | 4 rodadas simultâneas, bots draftam sozinhos | `packages/game-core/src/draft.ts` |
| Baús / inventário / pickups | `GRALootSystem` autoritativo (baús por geração, itens no chão, slots E/Q, consumíveis) | `packages/game-core/src/lootSystem.ts` |
| Tormenta | `GRATormentaSystem` (fases, pulso de dano, centro final) | `packages/game-core/src/tormenta.ts` |
| Estados da partida | `LOBBY → ABILITY_DRAFT → PREPARATION → UFO → MATCH → RESULTS → LOBBY`, mais `FREE_ROAM` (aquecimento legado de dev) e `CLOSED` | `MatchPhase` |
| Capacidade | 10 participantes no total (`MAX_PLAYERS`), humanos + bots; reserva dinâmica de bots no LOBBY já existe (`botsPlanned = min(botTarget, seats − humanos)`) | `roomMetadata()` |
| Concorrência de entrada | `maxClients` do Colyseus conta assentos reservados; a sala ainda confere `players.size >= seats` | |
| Saída do host | No modo atual o host sair **fecha a sala** (`HOST_LEFT`) | `onLeave` |
| Auto descarte | Padrão do Colyseus: sala sem clientes é descartada | |
| Autenticação | `onAuth` verifica JWT do Supabase (JWKS, ES256/RS256) e guarda só o `sub`; sem token = convidado; `GRAAO_REQUIRE_AUTH=1` recusa convidados | `apps/server/src/auth/SupabaseAuth.ts` |
| Persistência | Só o resumo final, uma vez, via RPC `record_match` + `GRAAO_SERVER_SECRET` (segredo do servidor). Partidas com bots não são gravadas | `apps/server/src/persistence/MatchStore.ts` |
| Supabase | Projeto `roxnhqzeznsdnsqjcmmn`; login anônimo **ligado** (checado em `/auth/v1/settings`); migrations `0001`, `0002` | `packages/database/migrations` |
| Criação de sala no site | `RoomBrowser` (Criar sala: nome, visibilidade, bots 0–9; Entrar por código; lista ao vivo) | `apps/client/src/ui/RoomBrowser.ts`, `GraaoApp.createRoom` |
| Código WebRTC/P2P existente | **Sim**: salas hospedadas no navegador (decisão de 2026-10-18). A mesma `GraaoMatchRoom` roda num Web Worker do host via `colyseusShim.ts`; convidados por WebRTC; sinalização e lista pública por Supabase Realtime (Presence `graao-rooms`) | `apps/client/src/net/host/*`, `docs/architecture/BROWSER_HOSTED_ROOMS.md` |
| Deploy atual | Cliente estático na Vercel (`graao.vercel.app`); servidor dedicado preparado para Fly.io (`fly.toml`, Dockerfile) mas sem deploy ativo | `docs/infrastructure/DEPLOYMENT.md` |
| Variáveis de ambiente | Cliente: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SERVER_URL` (opcional), `VITE_ICE_SERVERS`. Servidor: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GRAAO_SERVER_SECRET`, `GRAAO_REQUIRE_AUTH`, `PORT`, `SIMULATE_LATENCY_MS`, `GRAAO_REGION` | |
| Ferramentas locais | Supabase CLI 2.117 instalada **sem login**; sem Docker, sem `psql`, sem `cloudflared` | |

## 2. Requisitos mínimos de máquina (servidor)

O servidor não renderiza nada. Custos medidos antes (`docs/UX/PERFORMANCE.md`): LOBBY/Draft/preparação não simulam
mundo nem enviam snapshots; a partida roda a 20 Hz de tick e 20 Hz de snapshot, com movimento a 60 passos/s por
jogador. Medições específicas do Graao Host (memória, CPU com 1 humano + 9 bots) estão no relatório de testes
(`docs/hosting/GRAAO_HOST_TEST_REPORT.md`). Recomendação inicial: Windows 10/11 x64, 4 GB de RAM livres para o
navegador do host jogar ao mesmo tempo, CPU de 4 núcleos, upload estável ≥ 5 Mbit/s para 10 participantes.

## 3. O que empacota direto e o que depende da nuvem

| Parte | Graao Host (PC do host) | Nuvem |
|---|---|---|
| `GraaoMatchRoom` inteira (movimento, combate, habilidades, Draft, loot, bots, OVNI, Tormenta, resultados) | **Sim, sem mudança de regra** | — |
| Mundo procedural + Rapier WASM | **Sim** (num único arquivo JS) | — |
| Colyseus core + transporte WebSocket | **Sim** (puro JS; addons nativos opcionais ficam de fora) | — |
| Verificação de JWT do Supabase | Não usada no modo desktop: convidados **não** mandam token para PCs de terceiros (um host malicioso poderia roubá-lo) | — |
| Gravação de resultados (`record_match`) | **Não**: exige `GRAAO_SERVER_SECRET`, que nunca pode ir num executável distribuído; e o host controla o próprio processo (partida casual, sem ranking) | Só servidores oficiais |
| Lista de salas, presença dos hosts, sessões autorizadas, pareamento | — | **Supabase** (tabelas + RPCs `security definer`) |
| Endereço público HTTPS/WSS | Conector `cloudflared` (processo filho) | **Cloudflare Tunnel** (provisionamento por função protegida com token administrativo só no servidor) |
| Site/cliente | — | Vercel (inalterado) |

## 4. Mudanças necessárias no servidor (mínimas, por configuração)

1. Um **modo de execução** (`HOST_MODE=DEDICATED` padrão | `HOST_MODE=DESKTOP`, com o alias pedido
   `GRAAO_HOST_MODE=LOCAL_PLAYER_HOST`) lido num único módulo de política (`hostPolicy.ts`). A sala consulta a política
   em três pontos (criação, quem é o host, saída do host); nenhum sistema de gameplay muda.
2. No modo desktop: o **próprio servidor cria a única sala** (comando do aplicativo), clientes só entram por
   `joinById`; um `create` vindo da internet é recusado; a sala não se autodescarta vazia; o host é quem apresenta a
   chave de dono daquela sessão (e não "o primeiro a entrar"); a aba do host fechar **não** derruba a sala; encerrar
   no aplicativo avisa "O HOST ENCERROU A PARTIDA" e desconecta todos.
3. Ponto de entrada próprio para o processo filho (`apps/server/src/desktop/main.ts`), sem `.env`, sem top-level await,
   escutando só em `127.0.0.1` numa porta livre, com canal de controle por IPC do processo pai (nunca HTTP público).
4. Bundle **autocontido** (um `.mjs` com Colyseus, `ws`, Rapier) para não depender de `node_modules`.

## 5. Riscos identificados

- **Descompasso de versão**: o site na Vercel atualiza sozinho; o Graao Host instalado não. Qualquer aumento de
  `PROTOCOL_VERSION` exige nova versão do aplicativo. O ticket de hospedagem leva a versão do site e o aplicativo
  recusa com mensagem clara ("atualize o Graao Host").
- **Túnel gerenciado** depende de uma conta Cloudflare com zona/domínio próprio (não existe hoje) e de um token
  administrativo guardado só no backend. Quick Tunnels (`trycloudflare.com`) servem apenas para teste.
- **Migrations não aplicadas**: sem login da Supabase CLI nem MCP nesta sessão; o SQL foi validado num Postgres
  embutido (PGlite) com a mesma migration, mas precisa ser aplicado pelo dono do projeto.
- **Assinatura de código**: sem certificado, o SmartScreen avisa "Editor desconhecido".
- **Confiança no host**: quem hospeda pode alterar o próprio processo; partidas do Graao Host são casuais e não vão
  para histórico/ranking.
- **Rede doméstica**: CPU/upload do host limitam a experiência de todos; sem migração de host (host sai = partida
  termina).

## 6. Decisão

Seguir com Electron + `utilityProcess` executando o **mesmo** código do servidor, empacotado por esbuild num arquivo
único, instalador NSIS via `electron-builder`, conector `cloudflared` como processo filho e Supabase como serviço
central leve. O modo atual (servidor dedicado e salas no navegador) continua funcionando para regressão.
