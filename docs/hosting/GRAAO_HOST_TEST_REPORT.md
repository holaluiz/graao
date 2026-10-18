# Graao Host — relatório de testes (2026-10-18)

Máquina: um PC Windows 10 Home 19045 (x64), rede doméstica no Brasil, Node 24.14 (só para ferramentas; o app não usa),
Electron 43.7.7, cloudflared 2026.9.3. **Tudo abaixo rodou em UM computador e UMA rede.** Testes que dependem de
outro PC, outra rede, Windows limpo, Supabase com a migration aplicada ou conta Cloudflare estão marcados como
**não executados**, com o motivo.

Legenda: ✅ executado e passou · ⚠️ executado com ressalva · ⛔ não executado (bloqueio)

## Resumo por teste pedido

| Teste | Situação | Evidência |
|---|---|---|
| **A — Servidor local** | ✅ Bundle autocontido roda numa pasta vazia, sem `node_modules`, em Node (0,7 s) e no runtime do Electron (2,1 s); cliente Colyseus entra com a chave de dono, vira host, 3 bots previstos, `/health` em modo `DESKTOP`. App empacotado (fuses ativas) abre a sala em 1,4 s. ⛔ Máquina Windows **limpa**: não disponível | `tools/hosting/smoke-bundle.ts`, `tools/hosting/packaged-check.ts` |
| **B — Instalação única** | ✅ Instalar → link `graao-host://` aberto pelo Windows chega ao app → sala pronta; nova sala no mesmo PC sem reinstalar e **sem nova confirmação** (PC já vinculado) | `packaged-check --via protocol`, E2E "Pedro hosts again" |
| **C — Internet real** | ⚠️ Conexões do jogo saem do PC, passam pela borda da Cloudflare (`gig`) e voltam pelo túnel do host (`wss://*.trycloudflare.com`), ping 23–31 ms, partidas completas. ⛔ **Outro computador em outra rede: não executado** (não há segunda máquina nesta sessão) | `docs/hosting/evidence/three-hosts.json` |
| **D — Gameplay** | ✅ No servidor empacotado: Draft (4 rodadas), preparação, OVNI e salto, pouso, partida, bots atirando (42–56 tiros e 37–53 danos em ~9–12 s), eliminação, 14 baús, Tormenta ativa. Magias dos humanos: loadout de 4 habilidades recebido; uso de magia/escudo/passivas **não** dirigido pelos clientes de teste (as regras são o mesmo código coberto por `tests/multiplayer.test.ts` e `packages/game-core`). Vitória/resultados: não esperados até o fim | `tests/graaoHost.e2e.test.ts`, evidências JSON |
| **E — Capacidade** | ✅ 1+9, 2+8, 3+7, 5+5 e 10+0 (humanos de teste + bots do host), cada sala com 10 participantes na partida; 13 entradas simultâneas → exatamente 10 vagas | `capacity-1+9-2+8.json`, `three-hosts.json`, `DesktopHost.test.ts` |
| **F — Três hosts** | ✅ Três instalações independentes (identidade, processo, túnel, sala) no **mesmo PC**, três salas na lista, três endpoints, três partidas simultâneas; encerrar uma não afeta as outras; outra conta não usa um PC vinculado. ⛔ Três PCs físicos: não executado | `three-hosts.ts`, E2E |
| **G — Falha do host** | ✅ Encerrar: aviso "O HOST ENCERROU A PARTIDA" (código 4000) e sala fora da lista na hora. Processos mortos à força ("queda de energia"): convidado cai em ~0,3 s, sala fora da lista em 30 s; no navegador o aviso aparece com [Voltar às salas] [Menu principal] | `packaged-check.ts`, navegador (capturas) |
| **H — Instalador** | ✅ Instalar (37 s), protocolo, atalhos, reinstalar (40 s), atualizar 0.1.0→0.1.1 (42 s), desinstalar (6 s, limpo), inicialização sem Node externo (servidor em `utilityProcess`). Firewall: nenhum aviso (só loopback + saída). ⛔ Antivírus de terceiros, reinício do Windows, Windows 11, fluxo assistido clicado | `GRAAO_HOST_INSTALLER.md` |
| **I — Túnel** | ✅ WebSocket por Quick Tunnel; 3 túneis simultâneos com 18 clientes; prontidão só após DNS + `/health` público; queda do túnel de teste encerra a sala com erro claro. ⛔ Túnel **gerenciado** (provisionamento, revogação, remoção): código pronto, **não executado** (sem conta Cloudflare) | `three-hosts.ts`, `GRAAO_HOST_TUNNELS.md` |
| **J — Custo e limites** | ✅ Pesquisa documentada (1.000 túneis/conta, US$ 4,50/túnel acima disso, 200 registros DNS em zona grátis nova, Quick Tunnel só teste, 200 requisições em voo); tráfego medido ≈ 1,2 Mbit/s médio por host com 10 pessoas | `GRAAO_HOST_TUNNELS.md` |

## Testes automatizados

| Arquivo | O que prova | Resultado |
|---|---|---|
| `apps/server/src/desktop/DesktopHost.test.ts` | Loopback, `create` da rede recusado, código alocado, chave de dono (também após recarregar), aba do host fecha e a sala fica, uma sala por processo, 13 entradas simultâneas → 10, bots cedem vagas, encerramento avisa todos | 4/4 |
| `tests/hostCentral.test.ts` | Migration real num Postgres embutido (PGlite): tickets (uso único, expiração, versão, limite), vínculo, conflito de conta, segredo errado, publicação só com endpoint válido, contagens validadas, lista só com salas públicas e recentes, resolução de código, revogação, três hosts isolados, **grants e RLS** (anon/authenticated não leem tabelas nem chamam funções de serviço) | 8/8 |
| `tests/graaoHost.e2e.test.ts` | `HostController` real + servidor empacotado em processo próprio + central: três hosts, isolamento, heartbeat, encerrar, processo morto, re-hospedar sem vincular de novo, conflito, partida real com 8 bots | 3/3 |
| `packages/shared/src/hosting.test.ts` | Deep link, validação da linha pública, configurações, endpoints, versões | 6/6 |
| Suíte inteira (`pnpm test`) | Regressão | 285 passaram, 13 falharam: 12 em `SpectatorDirector.test.ts` (trabalho paralelo de espectador em andamento, arquivo não versionado) e "renders a remote smoothly at 60 Hz" (teste de tempo real instável sob carga; **49/49 com o arquivo sozinho**) |

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

1. Aplicar a migration 0003 no Supabase; publicar o instalador; build do site com as variáveis.
2. **PC A** (Windows limpo, sem Node): baixar pelo site, instalar, Criar e hospedar (aceitar o aviso do SmartScreen e
   o prompt do navegador), confirmar o vínculo.
3. **PC B em outra rede** (ex.: celular roteando 4G): abrir o site, ver a sala na lista, entrar, andar, atirar, ver o
   outro jogador; anotar ping (F3).
4. Três PCs: três salas simultâneas, cada uma com amigos.
5. Fechar o Graao Host no meio da partida (e desligar o Wi-Fi do PC A em outra rodada).
