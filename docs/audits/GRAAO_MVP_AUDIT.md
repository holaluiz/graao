# graao — Auditoria do MVP (Fase 0)

Data: 2026-10-17 · Auditor: Claude Code · Baseline: commit `ef3d31b` (branch `fase-7-ovni`), tag local
`baseline-auditoria-2026-10-17` · Branch de trabalho: `mvp-online-1v1`.

Fontes de evidência, nesta ordem de peso:

1. **Teste real no navegador** (esta sessão): dois clientes do jogo (duas abas do navegador embutido, mesmo perfil)
   contra um servidor local na porta 2570, do menu até o resultado.
2. **Testes automatizados** (`pnpm test`: 162 testes em 17 arquivos, incluindo uma suíte de integração com servidor
   real e dois clientes Colyseus SDK).
3. **A gravação do usuário** (`graao - Google Chrome 2026-10-17 20-05-52.mp4`, 30 s, 1440×900, em
   `graao.vercel.app`), analisada quadro a quadro. Quadros salvos em [`img/`](img/).
4. **Leitura do código** e do bundle publicado no Vercel.

Código existente sem nenhuma das três primeiras evidências foi classificado no máximo como
**IMPLEMENTADO, MAS NÃO VALIDADO**.

## Resumo executivo

- **O multiplayer funciona localmente, mas não existe online.** O cliente publicado em `graao.vercel.app` procura o
  servidor em `wss://graao.vercel.app:2567` (fallback de `serverUrl()` quando `VITE_SERVER_URL` não é definido no
  build). Nada escuta ali: o Vercel só hospeda arquivos estáticos e não roda o servidor Colyseus. O menu da gravação
  mostra "Não foi possível falar com o servidor do graao. Ele está rodando? (pnpm dev)" — uma mensagem de
  desenvolvimento vazando para produção ([quadro t=1 s](img/baseline-t1s.jpg)). **Este é o bloqueio P0 número 1.**
- O servidor **já é autoritativo** para tudo que o MVP pede: movimento (cada comando é um passo fixo do mesmo
  controlador, com orçamento de tempo real contra speed-hack), tiro (hitscan resolvido no servidor a partir da origem
  da câmera, validada a até 7,5 m da cabeça), munição, recarga, troca de arma, Mana, cooldowns, habilidades, dano
  Escudo→Vida, morte, vencedor, draft, OVNI e placar. O cliente nunca declara dano.
- **Ciclo 1v1 completo comprovado no navegador nesta sessão** (duas abas): criar sala → entrar por código → lobby com
  os dois → troca de roupa replicada → prontos → draft de 4 rodadas decidido pelo servidor → OVNI → salto e ejeção
  automática → pouso → contagem → combate → 13 acertos confirmados pelo servidor (Escudo 100→0, Vida 100→0, 200 de
  dano) → eliminação → **VITÓRIA!** para A e **DERROTA** para B → retorno ao lobby com placar 1×0.
- **Quedas de conexão não têm tolerância.** O servidor não implementa `onDrop`/`allowReconnection`: qualquer queda de
  rede remove o jogador na hora e, num 1v1, entrega a vitória ao outro. O SDK do cliente já tenta reconectar, mas o
  assento já foi apagado. Na internet isso é P0.
- **Ainda não testado:** duas sessões de navegador independentes, dois dispositivos, duas redes. Não há servidor
  público, então os dois últimos são impossíveis até haver hospedagem (ação do usuário: conta em um provedor).
- A pose de "braços abertos" da gravação foi localizada: é a **pose procedural de paraquedismo** (`skydiveClip`)
  vista de cima/trás. Não é bind pose nem erro de mapeamento de ossos. Detalhes na seção 4.

## Classificação por sistema

Legenda: **FT** = FUNCIONAL E TESTADO · **INV** = IMPLEMENTADO, MAS NÃO VALIDADO · **PAR** = PARCIAL ·
**AUS** = AUSENTE · **DEF** = DEFEITUOSO.

| # | Sistema | Status | Evidência | Problemas | Prioridade |
|---|---|---|---|---|---|
| 1 | Inicialização e fluxo de cenas | FT | Boot → "ENTRAR NO GRAAO" → menu → criador / solo / online, visto na gravação e no navegador. `GraaoApp.setPhase` (BOOT, MENU, CHARACTER_CREATOR, MATCH) + fases do servidor (FREE_ROAM, ABILITY_DRAFT, UFO, MATCH, RESULTS) | Rapier (1,67 MB gzip) carrega antes do menu | P2 |
| 2 | Character Creator | FT | Gravação (abas Corpo…Acessórios, Surpreenda-me, Pronto); `parts.test.ts` (todas as peças em ambos os corpos, chapéus × cabelos) | Clipping durante animação não foi auditado visualmente | P1 |
| 3 | Avatar e roupas | FT (estático) / INV (em movimento) | Uma SkinnedMesh mesclada por personagem (≈ 10 k tris, 55 ossos); roupas são geometria própria skinada no mesmo esqueleto; aparência não toca o capsule (hitbox em `game-core`) | Encaixe durante corrida/salto/queda não inspecionado | P1 |
| 4 | Rig e animações "Mixamo" | PAR | Rig `GRA_Rig_MixamoCompatible` (nomes Mixamo), `Retargeter.test.ts` (direções a 4°, clipes in-place). **Fonte real: Quaternius UAL (CC0)**, não Mixamo. O carregador FBX Mixamo existe e nunca rodou com um clipe real | Pose de queda lida como "pose de rig" (seção 4); clipes Mixamo reais ausentes (bloqueio antigo do status) | P1 |
| 5 | Character Controller | FT | `world.test.ts`: gravidade radial, salto, salto duplo, volta completa sem flips/NaN, replay idêntico (contrato de predição), natação, afogamento | — | — |
| 6 | Movimento sobre a esfera | FT | Volta completa no teste; no navegador A atravessou meio planeta (≈ 200 m) correndo até B | — | — |
| 7 | Câmera | INV | Heading tangente transportado, puxada por terreno, FOV/ombro de mira; sem teste de volta completa da câmera; dissolve de obstrução "TESTING" no status | Quadro t=27 s da gravação: câmera muito perto do personagem após o pouso (ocupa ⅓ da tela) | P1 |
| 8 | Colisão e física Rapier | FT | Mesmo mundo determinístico no cliente e no servidor (teste); colliders de props; spawns livres (teste de overlap) | — | — |
| 9 | Armas | FT (local) | Teste de integração (escudo primeiro, cadência, origem teleportada recusada); no navegador 13/13 tiros válidos confirmados até a eliminação; munição reconciliada por sequência | Sem compensação de latência (rewind): acertos em alvos rápidos com ping alto podem falhar (o hitmarker só aparece confirmado) | P1 |
| 10 | Habilidades | FT (servidor) / INV (sensação) | 8 básicas + 3 Supremas sobre 8 primitivas reais (projétil, área, dash, escudo, cura, lentidão, empurrão, dano). Testes de integração: posse, fase, cooldown, Mana, projétil do servidor, área com aviso, eliminação só com magias | Nenhuma partida pessoa × pessoa testou habilidades | P1 |
| 11 | Mana, cooldown, atributos | FT | `abilities.test.ts`, `AbilityController.test.ts` (espelho do cliente nunca é juiz; recusas revertidas) | — | — |
| 12 | Colyseus e sincronização | FT (local) / DEF (internet) | Predição + sequência de input + reconciliação (erro 0,0003 cm medido no navegador) + interpolação remota (teste a 60 Hz) + orientação radial, animação derivada do estado, arma, aparência e uso de habilidade replicados. **Sem `onDrop`/reconexão** | Queda de rede = saída definitiva; teste de suavidade a 60 Hz instável sob carga | **P0** |
| 13 | Supabase | PAR | Esquema + RLS + `record_match` + verificação de token (ES256, testado). Login anônimo **agora está ligado** (signup respondeu com token nesta sessão). Partida desta sessão foi salva ("Partida salva no seu histórico") | O build do Vercel não tem `VITE_SUPABASE_*`: em produção todos são convidados. Duas abas do mesmo navegador compartilham o mesmo usuário anônimo | P1 |
| 14 | R2 e assets | AUS | `GRAAssetManager` aceita `VITE_ASSET_BASE`; hoje tudo vem do próprio cliente (`/assets/v1/...`, 1 MB de animações). Sem bucket, sem upload | Não bloqueia o MVP | P2 |
| 15 | Estados da partida | FT | `match.test.ts` + integração (aquecimento → prontos → draft → OVNI → partida → resultados → lobby) e navegador | 1v1 pode pousar em lados opostos do planeta (no teste: 202 m, 34 s correndo) | P1 |
| 16 | OVNI e queda | FT | `deploy.test.ts` (9) + integração (5) + navegador: revelação → bordo → salto → queda → pouso; ejeção automática do outro jogador no fechamento da janela | Pose de queda (seção 4) | P1 |
| 17 | HUD e feedback | FT (estrutura) / INV (legibilidade) | Escudo/Vida/Mana, armas E/Q com munição, 4 habilidades com custo e cooldown, hitmarkers por tipo, números de dano, kill feed, banners, resultado; HUD de modo correto (solo: "EXPLORANDO SOZINHO · tiros e magias de treino"; online: "OVNI · 2 a bordo…", "PARTIDA · armas liberadas em instantes") | Legibilidade em 1366×768 / 1440×900 / 1920×1080 não medida; áudio sintetizado nunca ouvido por uma pessoa | P2 |
| 18 | Performance e bundle | PAR | Overlay F3 completo (FPS, ms, draw calls, tris, skinned, VFX, ping, KB/s, snapshot, tick). Medições em `docs/performance/BUDGETS.md` (painel 697×728). Bundle medido hoje: app 122 KB, three 193 KB, net 51 KB, supabase 55 KB (lazy), **rapier 1,67 MB gzip** | Sem medição em 1080p nem em hardware intermediário; Rapier no caminho crítico | P2 |
| 19 | Build e deploy | DEF | `pnpm build` passa (cliente + `server.mjs`). Cliente publicado no Vercel (versão 0.6.0, protocolo 6, anterior aos bots solo). **Servidor não publicado em lugar nenhum**; nenhum Dockerfile ou config de host; `DEPLOYMENT.md` é TODO | Online impossível em produção; mensagem "pnpm dev" para o jogador | **P0** |
| 20 | Testes automatizados | FT com ressalvas | 162 testes; `typecheck` passa; **`lint` falha** (1 erro em `world.test.ts`, 1 aviso). No baseline 2 testes falharam e passaram na repetição: suavidade a 60 Hz (conhecido) e o teste de draft "only they can be cast" (recebeu `COOLDOWN` onde esperava `NOT_OWNED`) — ambos sensíveis a carga da máquina | Lint vermelho; dois testes instáveis | P1 |

## 1. Multiplayer: o que foi comprovado e o que não foi

| Teste exigido | Status | Como |
|---|---|---|
| Dois clientes SDK, mesmo processo | FT | `tests/multiplayer.test.ts` (46 testes) |
| Duas abas do mesmo navegador | FT | Esta sessão: sala `GR-86VU`, Ana × Beto, ciclo completo até VITÓRIA/DERROTA |
| Duas sessões de navegador independentes | TODO | Próximo passo (Chromium do Playwright, perfil separado) |
| Dois dispositivos | BLOQUEADO | Precisa de servidor acessível na rede (LAN funciona com `pnpm dev --host`; roteiro na entrega) |
| Duas redes distintas | BLOQUEADO | Precisa de servidor público (conta em provedor) ou túnel; ação do usuário |

Observação: o teste em duas abas usou automação para mirar (direção calculada até o peito do alvo) e para manter os
quadros rodando com o painel oculto. Os tiros passaram pelo mesmo caminho de rede e validação do servidor que um
clique real; o que a automação não prova é a sensação de mira com o mouse.

## 2. Combate: verificação dos itens pedidos

| Item | Resultado |
|---|---|
| Troca E/Q, equipamento | Servidor: `SWITCH_WEAPON` com atraso de equipar (220 ms); testes de cliente |
| Origem e direção do disparo | Origem da câmera validada a 7,5 m da cabeça do atirador no servidor; linha de visão do cano; spread determinístico por semente |
| Cadência | Recusa abaixo de 85 % do intervalo nominal (teste "rejects fire-rate spam") |
| Munição / recarga | Servidor conta e recarrega; cliente reconcilia por sequência de FIRE |
| Acerto em outro jogador, dano autoritativo | Navegador: 13 eventos `dmg` do servidor, total 200, Escudo antes de Vida, `kinds` com quebra de escudo e eliminação |
| Replicação do disparo | Evento `shot` com origem/destinos para todos |
| Habilidades: posse, Mana, cooldown, alvo, colisão, efeito, rejeição | Integração + unitários; o HUD do navegador mostrou exatamente o loadout concedido pelo servidor no draft |
| Morte | Servidor: sem respawn dentro da partida; cliente: ação `DEAD` → clipe `death` com pose mantida |
| Vencedor | `decideMatch` no servidor; resumo `MATCH_SUMMARY` idêntico para todos |

## 3. Fluxo da partida

O fluxo pedido (MENU → SALA/LOBBY → confirmação → DRAFT → OVNI → QUEDA → PARTIDA → RESULTADOS → LOBBY) **já existe
e roda sem recarregar a página**. Lacunas encontradas:

- Sala inexistente / cheia / versão incompatível: mensagens amigáveis existem (`friendlyError`) — validar com o
  servidor real (as mensagens do Colyseus 0.18 precisam bater com os regex).
- **Desconexão:** sem reconexão (P0, ver acima).
- **Falha de carregamento / servidor fora do ar:** o menu só descobre ao clicar, e a mensagem cita `pnpm dev`.
- Confirmação explícita do personagem antes do draft: hoje "Estou pronto" no lobby faz esse papel.

## 4. Pose de "braços abertos" na queda (Fase 3) — causa localizada

Reproduzido na gravação ([t=19 s](img/baseline-t19s.jpg), [t=21 s](img/baseline-t21s.jpg)): de 92 m até o chão o
personagem aparece "em pé" com os braços erguidos e abertos ao lado da cabeça.

- O clipe é `skydive`, **procedural**, montado sobre a bind pose em T (`GRAAnimationLibrary.skydiveClip`): braços para
  os lados, levemente erguidos, cotovelos dobrados 1,35 rad para as mãos subirem até a cabeça.
- `GraaoCharacter.update` inclina o corpo de barriga para baixo (1,3 rad) e, nos últimos 10 m, volta para quase em pé
  (0,15 rad) **mantendo a mesma pose de braços**. A câmera de queda olha de cima/trás (pitch −0,72), então o corpo
  deitado aparece vertical na tela.
- Resultado: lido como "mãos ao alto"/pose de rig. Não é bind pose crua, nem falta de clipe, nem mapeamento de ossos
  (o retargeter tem teste de direções), nem erro de orientação radial.
- Correção proposta (P1): misturar a pose de queda livre com `fall`/`air` conforme o personagem se endireita perto do
  chão, e recompor a pose de caixa com braços mais para frente e menos abertos. Validar com capturas lado a lado.

## 5. Prioridades e dependências

**P0 — fazer o jogo funcionar online de verdade**

1. Servidor publicável: Dockerfile + configuração de um host com WebSocket (região próxima ao Brasil), `/health`,
   variáveis documentadas. *Depende de: conta do usuário no provedor.*
2. Cliente: URL do servidor configurável em produção (`VITE_SERVER_URL` no Vercel) e, para testes, `?server=wss://…`
   também em produção, **sem enviar o token Supabase a servidores não oficiais**; mensagem de erro de produção sem
   `pnpm dev`; status do servidor visível no menu antes do clique.
3. Reconexão: `onDrop` + `allowReconnection` no servidor, aviso "Reconectando…" no cliente, testes de integração.
4. Testes: duas sessões independentes (local), depois LAN (dois dispositivos) e internet (roteiro para o usuário).

**P1** — pose de queda e transições; clipping de roupas em movimento; câmera pós-pouso e volta completa; pouso do 1v1
perto um do outro; compensação de latência; lint verde e testes instáveis; Supabase no build de produção.

**P2** — legibilidade do HUD nas três resoluções; feedback de tiro/magia; riqueza visual do planeta; Rapier fora do
caminho crítico; R2.

Dependências: P0.1 → P0.4 (internet). P0.2 só tem efeito público depois de um novo deploy do cliente (preview do
Vercel a partir da branch). Nada da P1/P2 bloqueia o 1v1.

## Anexo: ambiente desta auditoria

- Windows 10, Node 24.14, pnpm 10.33; servidor `tsx src/index.ts --port 2570` (lê `apps/server/.env`, grava no
  Supabase `graao`); cliente Vite sem HMR na porta 5177 (`graao-client-bench2`).
- Outro processo já ocupava 5173/2567 (provavelmente outra sessão ou o `pnpm dev` do usuário) e não foi tocado.
- `pnpm test` baseline: 160/162 (ver item 20); `pnpm typecheck`: ok; `pnpm lint`: 1 erro; `pnpm build`: ok.
