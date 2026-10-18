# Graao Host — relatório de testes (2026-10-18)

Máquina: um PC Windows 10 Home 19045 (x64), rede doméstica no Brasil, Node 24.14 (só para ferramentas; o app não usa),
Electron 43.7.7, cloudflared 2026.9.3. **Tudo abaixo rodou em UM computador e UMA rede.** Testes que dependem de
outro PC, outra rede, Windows limpo ou conta Cloudflare estão marcados como **não executados**, com o motivo. A
central de produção (Supabase com a migration 0003) foi ligada e testada depois, no mesmo dia: seção
"Central em produção".

Legenda: ✅ executado e passou · ⚠️ executado com ressalva · ⛔ não executado (bloqueio)

## Resumo por teste pedido

| Teste | Situação | Evidência |
|---|---|---|
| **A — Servidor local** | ✅ Bundle autocontido roda numa pasta vazia, sem `node_modules`, em Node (0,7 s) e no runtime do Electron (2,1 s); cliente Colyseus entra com a chave de dono, vira host, 3 bots previstos, `/health` em modo `DESKTOP`. App empacotado (fuses ativas) abre a sala em 1,4 s. ⛔ Máquina Windows **limpa**: não disponível | `tools/hosting/smoke-bundle.ts`, `tools/hosting/packaged-check.ts` |
| **B — Instalação única** | ✅ Instalar → link `graao-host://` aberto pelo Windows chega ao app → sala pronta; nova sala no mesmo PC sem reinstalar e **sem nova confirmação** (PC já vinculado) — repetido com o app empacotado e a **central de produção** (segunda sala pronta em ~9 s) | `packaged-check --via protocol`, E2E "Pedro hosts again", seção "Produção pelo navegador" |
| **C — Internet real** | ⚠️ Conexões do jogo saem do PC, passam pela borda da Cloudflare (`gig`) e voltam pelo túnel do host (`wss://*.trycloudflare.com`), ping 23–31 ms, partidas completas. ⛔ **Outro computador em outra rede: não executado** (não há segunda máquina nesta sessão) | `docs/hosting/evidence/three-hosts.json` |
| **D — Gameplay** | ✅ No servidor empacotado: Draft (4 rodadas), preparação, OVNI e salto, pouso, partida, bots atirando (42–56 tiros e 37–53 danos em ~9–12 s), eliminação, 14 baús, Tormenta ativa. Magias dos humanos: loadout de 4 habilidades recebido; uso de magia/escudo/passivas **não** dirigido pelos clientes de teste (as regras são o mesmo código coberto por `tests/multiplayer.test.ts` e `packages/game-core`). Vitória/resultados: não esperados até o fim | `tests/graaoHost.e2e.test.ts`, evidências JSON |
| **E — Capacidade** | ✅ 1+9, 2+8, 3+7, 5+5 e 10+0 (humanos de teste + bots do host), cada sala com 10 participantes na partida; 13 entradas simultâneas → exatamente 10 vagas | `capacity-1+9-2+8.json`, `three-hosts.json`, `DesktopHost.test.ts` |
| **F — Três hosts** | ✅ Três instalações independentes (identidade, processo, túnel, sala) no **mesmo PC**, três salas na lista, três endpoints, três partidas simultâneas; encerrar uma não afeta as outras; outra conta não usa um PC vinculado. ⛔ Três PCs físicos: não executado | `three-hosts.ts`, E2E |
| **G — Falha do host** | ✅ Encerrar: aviso "O HOST ENCERROU A PARTIDA" (código 4000) e sala fora da lista na hora. Processos mortos à força ("queda de energia"): convidado cai em ~0,3 s, sala fora da lista em 30 s; no navegador o aviso aparece com [Voltar às salas] [Menu principal]. Em produção, **no meio da partida**: aviso na convidada, lista e endpoint limpos | `packaged-check.ts`, navegador (capturas), seção "Produção pelo navegador" |
| **H — Instalador** | ✅ Instalar (37 s), protocolo, atalhos, reinstalar (40 s), atualizar 0.1.0→0.1.1 (42 s), desinstalar (6 s, limpo), inicialização sem Node externo (servidor em `utilityProcess`). Firewall: nenhum aviso (só loopback + saída). ⛔ Antivírus de terceiros, reinício do Windows, Windows 11, fluxo assistido clicado | `GRAAO_HOST_INSTALLER.md` |
| **I — Túnel** | ✅ WebSocket por Quick Tunnel; 3 túneis simultâneos com 18 clientes; prontidão só após DNS + `/health` público; queda do túnel de teste encerra a sala com erro claro. ⛔ Túnel **gerenciado** (provisionamento, revogação, remoção): código pronto, **não executado** (sem conta Cloudflare) | `three-hosts.ts`, `GRAAO_HOST_TUNNELS.md` |
| **J — Custo e limites** | ✅ Pesquisa documentada (1.000 túneis/conta, US$ 4,50/túnel acima disso, 200 registros DNS em zona grátis nova, Quick Tunnel só teste, 200 requisições em voo); tráfego medido ≈ 1,2 Mbit/s médio por host com 10 pessoas | `GRAAO_HOST_TUNNELS.md` |

## Central em produção (Supabase `roxnhqzeznsdnsqjcmmn`, 2026-10-18)

Migration `0003_graao_host.sql` aplicada (histórico: versão `20261018175557`). Smoke real feito depois, com a chave
publishable, uma sessão anônima real e um Graao Host headless (`tools/hosting/headless-host.ts --central
https://roxnhqzeznsdnsqjcmmn.supabase.co --tunnel quick`) — log em `evidence/prod-central-smoke.json`.

| Verificação | Resultado |
|---|---|
| Funções e grants | ✅ 19 funções `host_*` `security definer`, dono `postgres`, `search_path = ''`. `anon` executa só as 12 do app e da lista; `host_ticket_create`, `host_my_installations` e `host_revoke` só `authenticated`; as 4 da Edge Function só `service_role` |
| Tabelas pela API com a chave publishable | ✅ `GET` em `host_rooms`/`host_installations`/`host_tickets` → `[]`; `POST host_rooms` → 42501 (RLS); `rpc/host_session_validate` → 42501 (permission denied); schema `private` não exposto (PGRST106). Diferença do PGlite: lá a leitura direta dá erro; na Supabase as tabelas de `public` têm o grant padrão e o RLS sem policy devolve lista vazia — mesmo efeito, nada vaza e nada se escreve |
| `host_config` (anon) | ✅ `tunnel_mode = quick-test`, app 0.1.0 (mínima e mais recente), `api_version` 1 |
| `host_ticket_create` sem sessão | ✅ recusado (`unauthenticated`) |
| `host_ticket_create` com sessão anônima real | ✅ ticket `PENDING` por 5 min; `host_ticket_peek` com o segredo devolve as configurações (`linked: false`) |
| Host headless publica | ✅ pareou com identidade nova, servidor pronto em 0,7 s, Quick Tunnel em ~6 s (borda `gig`), `READY` em 11 s. Aos 13 s a sala `GR-XB22` estava em `host_public_rooms` (0 humanos + 9 bots, `LOBBY`, disponível); `host_room_endpoint` → `wss://….trycloudflare.com`; ticket `READY` com o endpoint; `GET https://…/health` **pela internet** → 200, `mode: DESKTOP`, protocolo 9 |
| Heartbeat | ✅ `last_heartbeat_at` avançou em 12 s; `host_my_installations` mostra a instalação do dono com a sala ativa |
| Encerrar hospedagem | ✅ 1,3 s depois a sala saiu de `host_public_rooms` e `host_room_endpoint` → `null`; no banco: sala `CLOSED` ("O HOST ENCERROU A PARTIDA"), instalação `OFFLINE`, 0 sessões, `cloudflared` encerrado; o site vê o ticket como `FAILED`/`room_gone` |

**Advisor de segurança** (`supabase db advisors --type security`, `evidence/prod-security-advisor.json`): 0 ERROR,
32 WARN, 6 INFO, todos esperados:

- `anon_security_definer_function_executable` (12 `host_*` + o antigo `record_match`) e
  `authenticated_security_definer_function_executable` (15 `host_*`): intencional. As funções são a única porta de
  entrada; cada uma exige o segredo do ticket, o token de sessão do app ou `auth.uid()`, e `host_config`,
  `host_public_rooms` e `host_room_endpoint` são públicas por desenho (conhecer o código de uma sala privada é o convite).
- `rls_enabled_no_policy` (INFO, as 6 tabelas do Graao Host): intencional, acesso só pelas funções.
- `auth_allow_anonymous_sign_ins` (`profiles`, `matches`, `match_players`) e `auth_leaked_password_protection`:
  anteriores ao Graao Host; o login anônimo é o desenho do jogo e ele não usa senha.

Ficaram em produção, do smoke: um usuário anônimo, uma instalação `OFFLINE` e a sala `GR-XB22` fechada (o ticket some
sozinho em um dia). O site criando o ticket pela interface, o **app empacotado** apontando para esta central e um
convidado entrando pelo navegador foram verificados depois — seção seguinte. Continua não verificado: o site
**publicado** (graao.vercel.app ainda serve um build antigo, sem Supabase nem hospedagem).

## Produção pelo navegador com o app empacotado (2026-10-18, 15:40–15:58)

Site: cliente Vite local (porta 5176, sem HMR) com `apps/client/.env.local`, isto é, a Supabase de produção (sessão
anônima real, `host_ticket_create` real). App: `apps/host/release/win-unpacked/Graao Host.exe`, com a central de
produção embutida no build, pasta de dados temporária; o link `graao-host://` foi entregue como o Windows faz (segunda
instância → instância aberta) e os botões do app foram **clicados de verdade** (controle do computador). Convidada:
segunda aba do mesmo navegador. Túnel: Quick Tunnel (`tunnel_mode = quick-test`). Tudo no mesmo PC e na mesma rede.

| Passo | Resultado |
|---|---|
| Criar sala → Criar e hospedar (7 bots) → app mostra "Hospedar para Jogador?" com a sala certa | ✅ |
| Confirmar depois de 5 min | ⚠️ **Bug achado**: o site marcou o ticket `EXPIRED` e o app mostrou "Pedido já usado" em vez de "Pedido expirado". Corrigido na migration `0004_host_ticket_expired.sql` (teste novo em `hostCentral.test.ts`; **aplicada em produção** depois da rodada: o mesmo ticket passou a responder `ticket_expired` — `evidence/prod-0004-check.json`) e no site ("Já instalei — abrir de novo" pede ticket novo perto da validade) |
| Tentar de novo → Vincular e hospedar | ✅ app ONLINE, sala `GR-4W9P`, "1 humano + 7 bots", fase Lobby, conexão "Túnel de TESTE"; o site entrou no lobby **como host** — `prod-packaged-app-hosting.jpg` |
| Convidada abre a lista | ✅ sala com selo GRAAO HOST, "8 / 10", Aguardando; entrou pelo `wss://…trycloudflare.com`: "2 humanos + 7 bots · 9 / 10" — `prod-packaged-lobby-guest.jpg` |
| Convidada volta à lista; host clica Encerrar hospedagem | ✅ a linha sumiu da lista aberta **~3 s** depois, sem Atualizar (correção de `RoomBrowser.ts`, ver abaixo) |
| Aba do host | ✅ "O HOST ENCERROU A PARTIDA" com [Voltar às salas] [Menu principal]; Voltar às salas → lista vazia, a sala fechada **não apareceu** em nenhum momento — `prod-packaged-host-closed.jpg` |
| Segunda sala no mesmo PC (9 bots) | ✅ sem novo cartão de vínculo: pronta ~9 s após o link; "1 humano + 9 bots · 10 / 10"; a convidada entrou e um bot cedeu a vaga: "2 humanos + 8 bots · 10 / 10" |
| Prontos → Iniciar Draft | ✅ `host_public_rooms` **em produção**: `DRAFT`, `available: false`, `human_count 2`, `effective_bot_count 8`; depois `DEPLOYMENT` (15:55:20) e `MATCH` (15:56:03) — fases vindas do servidor no PC do host |
| Partida | ✅ convidada em `MATCH` vendo 9 participantes remotos e o killfeed dos bots; app: "2 humanos + 8 bots", fase Partida, memória 148 MB, CPU do servidor 2% no instante da captura — `prod-packaged-app-match.jpg` |
| Encerrar hospedagem **no meio da partida** | ✅ convidada recebeu "O HOST ENCERROU A PARTIDA"; `host_public_rooms` → `[]`, `host_room_endpoint('GR-4W9P')` → `null`, nenhum `cloudflared` sobrando. ⚠️ Um clique encerrou sem perguntar: **corrigido** — o app agora pede confirmação quando há amigos na sala ou a partida já começou (validado com `app-drive.ts`: "1 amigo está na sala…") |

Uma rodada anterior pelo navegador (capturas `prod-lobby-*.jpg`, `prod-room-list.jpg`, `prod-host-closed-*.jpg`)
tinha mostrado a sala fechada ainda na lista até clicar em Atualizar (`prod-list-stale.jpg` →
`prod-list-after-refresh.jpg`). Causa: com a lista ao vivo como fonte principal, a consulta do Graao Host só redesenhava
quando havia salas; a última sala sumir não redesenhava nada, e a volta à tela reaproveitava a lista antiga. Corrigido
em `apps/client/src/ui/RoomBrowser.ts` e verificado na rodada acima.

Ficaram em produção desta rodada: uma instalação `OFFLINE` (`d4527c6a…`), as salas `GR-4W9P` e `GR-9KG2` fechadas e os
tickets (que somem sozinhos).

## Instalador publicado (2026-10-18, ~18:45)

GitHub Release `host-v0.1.0` em `holaluiz/graao` (repositório público; tag em `5e0e6eb`), com
`GraaoHost-Setup-0.1.0.exe` e o `.blockmap`. Detalhes e passo a passo em `GRAAO_HOST_RELEASE.md` ("Instalador
publicado").

| Verificação | Resultado |
|---|---|
| Release e arquivos | ✅ `gh release view`: publicada (nem rascunho nem pré-release), os dois arquivos `uploaded` com os tamanhos locais (128.188.290 e 134.789 bytes); `git ls-remote` mostra a tag em `5e0e6eb` |
| Link direto **sem login** | ✅ `curl` anônimo: 302 → 200, `Content-Length: 128188290`, `Content-Disposition: attachment; filename=GraaoHost-Setup-0.1.0.exe` |
| Arquivo baixado = arquivo local | ✅ download anônimo completo (6,1 s) com SHA-256 `7eb08761…a358`, igual ao do `apps/host/release` |
| `download_url` em produção | ✅ `update private.host_config` pela CLI (`supabase db query --linked`) → `returning` com o link novo; antes era `https://graao.vercel.app/graao-host` (404) |
| `host_config` com a chave publishable | ✅ `download_url` = link da release, `latest_app_version` = `min_app_version` = `0.1.0`, `tunnel_mode = quick-test`; o link devolvido responde 200 |
| Código do site | ✅ `hostDownloadUrl()` de `apps/client/src/net/graaoHost/hostSite.ts`, chamada no cliente Vite local (`.env.local` = produção, sem `VITE_GRAAO_HOST_DOWNLOAD_URL`), devolve o link da release — é o valor que o botão "Baixar Graao Host" abre |
| Prévia na Vercel | ⚠️ o push de `5e0e6eb` gerou uma prévia ("Deployment has completed"), mas ela é protegida por login da Vercel e não foi aberta: não se sabe se tem as variáveis `VITE_SUPABASE_*` |
| Site publicado | ⛔ graao.vercel.app continua com o build do `main` de 15:03 UTC: o bundle não cita `roxnhqzeznsdnsqjcmmn` nem "Baixar Graao Host". Publicar = variáveis na Vercel + merge no `main` (`GRAAO_HOST_RELEASE.md`, "Publicar o site") |

Não verificado: o download clicado num navegador real e o aviso do SmartScreen numa máquina que nunca viu o arquivo
(roteiro abaixo, PC A).

## Testes automatizados

| Arquivo | O que prova | Resultado |
|---|---|---|
| `apps/server/src/desktop/DesktopHost.test.ts` | Loopback, `create` da rede recusado, código alocado, chave de dono (também após recarregar), aba do host fecha e a sala fica, uma sala por processo, 13 entradas simultâneas → 10, bots cedem vagas, encerramento avisa todos | 4/4 |
| `tests/hostCentral.test.ts` | Migrations reais (0003 + 0004) num Postgres embutido (PGlite): tickets (uso único, expiração — também depois de o site vê-la —, versão, limite), vínculo, conflito de conta, segredo errado, publicação só com endpoint válido, contagens validadas, lista só com salas públicas e recentes, resolução de código, revogação, três hosts isolados, **grants e RLS** (anon/authenticated não leem tabelas nem chamam funções de serviço) | 8/8 |
| `tests/graaoHost.e2e.test.ts` | `HostController` real + servidor empacotado em processo próprio + central: três hosts, isolamento, heartbeat, encerrar, processo morto, re-hospedar sem vincular de novo, conflito, partida real com 8 bots | 3/3 |
| `packages/shared/src/hosting.test.ts` | Deep link, validação da linha pública, configurações, endpoints, versões | 6/6 |
| Suíte inteira (`pnpm test`) | Regressão | 285 passaram, 13 falharam: 12 em `SpectatorDirector.test.ts` (trabalho paralelo de espectador em andamento, arquivo não versionado) e "renders a remote smoothly at 60 Hz" (teste de tempo real instável sob carga; **49/49 com o arquivo sozinho**). Depois das correções da rodada em produção: **286 passaram**, as mesmas 12 de `SpectatorDirector.test.ts` falharam |

Typecheck (`tsc` raiz, `apps/host`, `apps/client` exceto o teste de espectador em andamento), ESLint dos arquivos
novos/alterados e `vite build` do cliente: ✅.

## App real (Electron, Playwright)

`tools/hosting/app-drive.ts` dirigiu o app de verdade: janela sem acesso a `require`/`process` ✅; link entregue por
uma **segunda instância** (como o Windows faz) ✅; cartão "Hospedar para Luiz?" → **Vincular e hospedar** ✅;
passos → ONLINE ✅; dois jogadores entram, "2 humanos + 7 bots" ✅; configurações e painel técnico ✅;
**Encerrar hospedagem** → convidado recebe código 4000, lista vazia ✅. Capturas em `docs/hosting/screenshots/host-*.png`.

## Site no navegador (painel do app Claude, cliente Vite em modo dev, central de desenvolvimento)

1. Jogar → Criar sala: o formulário mostra **Criar e hospedar** (e a opção antiga "hospedar nesta aba") — `site-create-room.jpg`.
2. Sem app instalado: após 8 s, "O Graao Host não respondeu" com explicação, **Baixar**, **Já instalei** — `site-install-panel.jpg`.
3. O mesmo link entregue a um Graao Host (headless, mesmo `HostController`): o site passa a "preparando", depois entra
   no lobby **como host** da sala, com 7 bots previstos — `site-lobby-host.jpg`. O ticket foi criado com a sessão
   anônima real da Supabase do graao, verificada pela central de desenvolvimento via JWKS.
4. Segunda aba: a sala aparece na lista com o selo **GRAAO HOST**; entra pelo endpoint — `site-room-list.jpg`.
5. Processo do host morto: as duas abas mostram **O HOST ENCERROU A PARTIDA** — `site-host-closed.jpg`.

Não verificado no navegador: o prompt "Abrir Graao Host?" de um navegador real com o app instalado (o painel embutido
não entrega protocolos ao Windows; a entrega pelo Windows foi testada com `Start-Process`).

## Medições de recursos (servidor de um host, durante a partida, com os clientes de teste no mesmo PC)

| Sala | CPU do servidor (pico, % de 1 núcleo) | Memória RSS (pico) | Tick (pico / orçamento) | Atraso do event loop p99 (pico) |
|---|---|---|---|---|
| 1 + 9 bots | 74% | 153 MB | 3,0 / 50 ms | 43 ms |
| 2 + 8 | 84% | 272 MB | 3,2 / 50 ms | 42 ms |
| 3 + 7 | 83% | 267 MB | 4,6 / 50 ms | 51 ms |
| 5 + 5 | 87% | 240 MB | 3,8 / 50 ms | 75 ms |
| 10 + 0 | 76% | 155 MB | 2,5 / 50 ms | 48 ms |

Os picos incluem o PC rodando ao mesmo tempo outros servidores, três `cloudflared` e até 18 clientes de teste.
Requisito sugerido para hospedar: 4 núcleos, 4 GB livres, upload ≥ 5 Mbit/s.

## Roteiro do que falta testar (com outra máquina)

1. ~~Aplicar a migration 0003 no Supabase~~ (feito em 2026-10-18, ver "Central em produção"); ~~aplicar a `0004`~~ (feito);
   ~~publicar o instalador~~ (feito, ver "Instalador publicado"); deploy do site com as variáveis (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`) — passo a passo em `GRAAO_HOST_RELEASE.md` ("Publicar o site").
2. **PC A** (Windows limpo, sem Node): baixar pelo site, instalar, Criar e hospedar (aceitar o aviso do SmartScreen e
   o prompt do navegador), confirmar o vínculo.
3. **PC B em outra rede** (ex.: celular roteando 4G): abrir o site, ver a sala na lista, entrar, andar, atirar, ver o
   outro jogador; anotar ping (F3).
4. Três PCs: três salas simultâneas, cada uma com amigos.
5. Fechar o Graao Host no meio da partida (e desligar o Wi-Fi do PC A em outra rodada).
