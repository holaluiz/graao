# Vertical World & Traversal — auditoria V0 (2026-10-19)

Auditoria do código real na branch `mvp-online-1v1` (`ab2b3cc`) antes de qualquer alteração do sistema de travessia
vertical. O relatório de engenharia de 19/10 foi usado só como ponto de partida; tudo abaixo foi conferido no código.

## 1. O que existe (e onde)

| Sistema | Implementação real | Observações para a travessia |
| --- | --- | --- |
| Character Controller | `packages/game-core/src/character.ts` — `CharacterMotor` (o "GraaoSphericalCharacterController"), passo fixo 1/60 s, **o mesmo código** no cliente (predição) e no servidor (autoridade). | Ponto único de extensão. Nada de segundo controlador. |
| Gravidade radial | `vs -= PLANET.gravity·dt` ao longo de `up = normalize(pos)`; mundo Rapier com gravidade zero (`physics.ts`). `PLANET.gravity = 20 m/s²`, raio 100 m. | `localUp`, `gravityDirection` e altitude radial já são calculados por passo. |
| Orientação | `facing` = tangente unitária transportada (`transportTangent`) e girada para o movimento/mira; cápsula alinhada a `up` (`quatFromUp`). | Em parede, `facing` pode apontar para dentro da parede e servir para re-derivar a normal. |
| Estados de locomoção | `MovementState` (`shared/protocol.ts`): IDLE, WALK, RUN, SPRINT, JUMP, FALL, SWIM. Flags `diving`, `swimming`, `abilityMovement` (grapple/glide/flight das magias). | Novos estados entram aqui (protocolo) — não existe máquina de estados formal. |
| Ground detection | `KinematicCharacterController` do Rapier com `setUp(localUp)` a cada passo, `computedGrounded()`, snap-to-ground 0,32 m, autostep 0,38 m, rampa até 52°; raio extra `slopeAlong` para ladeiras. | Suporte é colisão real; ilha suspensa já funciona como chão (é só collider). |
| Colisores | Terreno trimesh (62.720 tris) + 2.182 primitivas de prefab (cuboid, cylinder, cone, ball, hull). Grupos `TERRAIN/PROP/PLAYER/CHEST/BARRIER/RAIL`. `propByCollider`, `surfaceByCollider` (material para passos). | Falta uma tag de jogabilidade por collider (escalável/agarrável). |
| Coyote time / jump buffer | Sim: `coyoteTime 0,1 s`, `jumpBuffer 0,12 s`; pulo duplo (`airJumped`), pulo mágico (`abilityJumpUsed`). | Planagem por "segurar Pular" precisa conviver com o pulo duplo (borda de subida). |
| Movimento aéreo | `airAccel 9 m/s²`, terminal 42 m/s; mergulho do OVNI (`diving`) com terminal 22/38 m/s. | Planagem universal reaproveita o mesmo laço. |
| Animações de salto/queda | `CharacterAnimationController`: `jumpStart`, `air`, `fall`, `land`, `skydive` (procedural). Fonte: Quaternius UAL (CC0) reempacotado por `tools/animation/build-animations.mjs`. | UAL2 tem `ClimbUp_1m` (não empacotado ainda). Sem clipes de pendurar/escalar/planar: procedural. |
| Câmera 3ª pessoa | `GraaoThirdPersonCamera`: heading tangente transportado, pitch limitado, colisão só com terreno (props dissolvem via `Obstruction`), `fovBoost`, `shakeIntensity` configurável. | Expandir com distância/FOV por estado de travessia. |
| Habilidades de mobilidade | `abilitySystem.ts`: Pulo de Pipa (`jump`), Linha de Varal (`grapple`), Asa de Papel (`glide` 4 s, queda máx. 3,5 m/s, 9 m/s), Voo de Papagaio (`flight` 7 s, teto `maxFlightHeight`), Escorrega (`slide` = dash), Ricochete (empurrão na parede). Movimento autoritativo via `CharacterState.abilityMovement`. | A planagem universal tem de ser claramente mais fraca que a Asa de Papel. |
| Navegação dos bots | `game-core/nav.ts` (grafo de lattice + waypoints do mapa, A*), `apps/server/src/sim/BotNav.ts`, `BotBrain.ts` (pula quando bloqueado). | Bots apertam contra paredes e pulam: sem limite, entrariam em beiradas. |
| Editor de mapas | `apps/client/src/editor/MapEditor.ts` (`?editor`): prefabs por família, mover/girar/escalar/`lift`, baús, waypoints, ver colisores (C), salvar pelo dev server com `mapVersion`. | Já posiciona peça em altitude (`lift`). Falta tag de travessia, volumes de vento. |
| Persistência de prefabs | Prefabs em código (`game-data/world/kit*.ts`), mapa em `planeta-graao.map.json` com `mapVersion/geometryVersion/collisionVersion`; `MAP_HASH` inclui todos os prefabs e é conferido no join (`MAP_MISMATCH`). | Mudar tags de prefab muda o hash: Graao Host antigo recusa — correto. |
| Sincronização de movimento | `InputCmd` (`[seq, wish×3, aim×3, buttons]`) a 60 Hz; snapshot 20 Hz com `PlayerSnap` de 20 campos (pos mm, vel cm/s, facing ×127, moveState, flags, ack). | Estado de travessia precisa ir no snapshot para a reconciliação. |
| Client prediction | `LocalPlayer`: simula o comando na hora, guarda pendentes. | — |
| Server reconciliation | `LocalPlayer.reconcile`: reconstrói o estado do snapshot, reaplica pendentes, decai o erro visual (>4 m = snap). `jumpHeld` reconstruído do último comando reconhecido; dash reconstruído pela seq. | Novos campos (stamina, timers) têm de ser reconstruíveis do snapshot. |
| Tormenta | `game-core/tormenta.ts` + `apps/client/src/game/TormentaDirector.ts`: região segura por ângulo geocêntrico (`outside(pos)`), já independente da altitude. | Altitude não cria imunidade hoje; falta limite radial explícito. |
| Queda do OVNI | `deploy.ts` + `DeployDirector.ts`: `diving` até o primeiro contato. | Travessia desligada durante o mergulho. |
| Água / superfícies especiais | Esfera de água (`waterDepth`), natação, fôlego/afogamento; `surfaceByCollider` só para som de passos. | Travessia desligada nadando. |
| Input mobile | **Não existe.** `Input.ts` só tem teclado/mouse; nenhum controle touch no jogo (só o modo espectador trata toque). | Gap real: o controle unificado será por intenção (`InputCmd`), mas a camada touch é trabalho novo (V9). |

## 2. Baseline (antes de alterar)

| Métrica | Valor | Como |
| --- | --- | --- |
| Suíte de testes | **554/555** em 59 arquivos (293 s). Única falha: `multiplayer.test.ts › renders a remote smoothly…` (p95 2,89 > 2,0 m/s), teste de relógio real já conhecido como sensível à carga da máquina. | `pnpm exec vitest run` |
| `CharacterMotor.step` (Node, planeta real) | ≈ 31 µs/passo correndo e pulando na Vila; 53–59 µs parado no chão | `tools/profiling/motor-bench.ts` (novo) |
| Construção do mundo (servidor, só colisores) | 757 ms; 2.182 colisores; terreno 31.362 vértices / 62.720 triângulos | `tools/profiling/world-stats.ts` |
| Frame (navegador, menu na vila) | 16,7 ms mediana, 17,4 ms p95 (vsync), CPU 1,0 ms | `docs/performance/BUDGETS.md` |
| Draw calls / triângulos (chão) | 87 draws / 638 k tris | idem |
| Tick do servidor | 0,5–1,1 ms (2 jogadores); orçamento 5 ms com 20 | idem |
| Rede | ≈ 1,5 KB/s entrada, 1,2 KB/s saída por cliente (2 jogadores) | idem |
| Memória | heap JS ≈ 151 MB no cliente em partida | `docs/qa/AUDIT_M0_2026-10-19.md` |

Medidas de navegador são as registradas nos docs de 18–19/10; o painel do navegador embutido entrega rAF
estrangulado, então números novos serão medidos com quadros sintéticos (ver memória de teste no navegador).

## 3. Limitações identificadas

1. Não há máquina de estados de locomoção explícita: `moveState` é derivado no fim do passo. A travessia precisa de
   um modo persistente (`traversal`) além do `moveState` de apresentação.
2. Não há tag de jogabilidade em collider: a única informação por collider é o material (`surfaceByCollider`).
3. O snapshot não carrega recursos de movimento (fôlego, por exemplo, nunca é reconstruído). Stamina não pode seguir
   esse modelo: ela decide transições, então precisa voltar no snapshot.
4. A câmera só colide com o terreno; props dissolvem. Escalando uma rocha-prop, a rocha dissolve em vez de afastar
   a câmera — aceitável, mas a leitura da rota precisa de distância maior.
5. Bots apertam contra paredes e pulam quando bloqueados (`BotBrain`): com beirada/escalada automáticas eles
   entrariam em estados que a navegação não planeja.
6. Sem input touch (ver tabela).
7. Os testes de rotas do mapa (`tests/world.regions.test.ts`) dirigem o motor real com pulos quando travam: qualquer
   mudança no motor pode alterar essas rotas — precisam passar de novo.

## 4. Arquitetura escolhida

Sem segundo controlador e sem nomes paralelos: a travessia é um módulo do próprio motor.

| Conceito do pedido | Onde fica |
| --- | --- |
| `GRATraversalController` / `StateMachine` | `CharacterMotor.step` + `game-core/traversal.ts` (`TraversalMode`, transições e passos de pendurar/subir/escalar/planar) |
| `GRAClimbDetector` / `GRALedgeDetector` | `game-core/traversal.ts` (`probeWall`, `probeLedge`, `canStandAt`) — raycasts e teste de sobreposição de cápsula no Rapier |
| `GRAMantleSystem` | passo `MANTLE` em `traversal.ts`: trajetória física pelo controlador cinemático (sobe, depois avança), nunca pela animação |
| `GRAGlideSystem` | passo aéreo do motor com modificadores de planagem (`TRAVERSAL.glide`) |
| `GRAWindVolumeSystem` | V3 |
| `GRATraversalSurface` | tags de prefab/parte (`traversal: 'ledge' | 'climb' | 'none'`) → `physics.traversalByCollider` |
| `GRATraversalCamera` | `GraaoThirdPersonCamera` (distância/FOV por modo) |
| `GRATraversalPresentation` | `CharacterAnimationController` + `GraaoCharacter` (clipes e poses procedurais) |
| `GRATraversalNetworkAdapter` | `MovementState` novos + 2 campos no `PlayerSnap` (stamina, timers) e reconstrução em `NetSession`/`LocalPlayer.reconcile` |
| Dados | `game-data/traversal.ts` (`TRAVERSAL`, permissões por estado) |

Princípios mantidos: o cliente envia só intenção (`InputCmd`); toda transição sai de geometria + entrada no passo
determinístico; timers são inteiros em passos de 1/60 s para que cliente e servidor reconstruam o mesmo estado.

## 5. Riscos

- **Determinismo Node × Chromium** em raycasts: a reconciliação corrige pequenas divergências; a detecção usa só
  limiares com margem.
- **Rotas do mapa** mudando por causa de mantle automático: rodar `world.regions` e `world.nav`.
- **Hash do mapa**: tags novas mudam `MAP_HASH` e o protocolo sobe para 11 — Graao Host instalado (0.1.0) deixa de
  jogar com o site novo até ser atualizado (publicar instalador exige aprovação).
- **Bots**: travessia desligada para bots até a V8 (links de travessia no grafo).

## 6. Depois da implementação (19/10/2026)

Sistemas **reutilizados** (sem segundo controlador, sem mudar raio, Colyseus ou o motor de física): `CharacterMotor`,
`KinematicCharacterController`, `InteractiveSystem` (portas → sinos), `MapEditor`, `buildNavGraph`/`BotNavigator`,
`chestSpots`, `LootDirector` (prompt de F), `WorldAudio`, `GraaoThirdPersonCamera`, `MAP_HASH`.

**Alterações:** modo de travessia no motor (pendurar, subir, escalar, planar), tags de superfície no kit e no
layout, volumes de vento (`game-core/wind.ts`, `GraaoMap.winds`), teto radial de 42 m, sinos interativos com ventos de
evento, protocolo 11 (3 campos no snapshot, evento `bell`, `WORLD_USE.k`, `WORLD_STATE.b`), kit VERTICAL
(`kitVertical.ts`), Serra do Mirante + Arquipélago dos Sinos no mapa (versão 5) com uma chapada nivelada no
terreno, `WindDirector` (faixas, folhas, som), aba Ventos no editor, waypoints da trilha para bots, filtro barato
das sondas (`taggedNear`).

Documentos: [estados](TRAVERSAL_STATES.md), [escalada](CLIMBING.md), [planagem](GLIDING.md),
[vento](WIND_VOLUMES.md), [design vertical](../world/VERTICAL_WORLD_DESIGN.md),
[Serra](../world/SERRA_DO_MIRANTE.md), [ilhas](../world/FLOATING_ISLANDS.md),
[prefabs](../world/VERTICAL_PREFABS.md), [bots](../world/VERTICAL_BOT_NAVIGATION.md),
[autoridade](../networking/TRAVERSAL_AUTHORITY.md), [orçamento](../performance/VERTICAL_WORLD_BUDGET.md),
[relatório de testes](../qa/VERTICAL_TRAVERSAL_TEST_REPORT.md).

Comparação com o baseline: suíte 554/555 → 607/607 (63 arquivos); colisores 2.182 → 2.339; construção do mundo
757 → 748 ms; travessia +8 µs/passo no pior caso medido (A/B); quadro sintético no pé da Serra 5,4 ms (vila 4,6 ms).

**Rodadas seguintes (19/10):** links de travessia dos bots, toque, rede com latência e combate vertical com magias
(2ª e 3ª); na 4ª, arte de rocha (facetas e estratos de itabirito nos patamares, cascos convexos sob as ilhas e nos
matacões, crista atrás do maciço — `KitPart.relief`/`bands`/`hull`) e a validação na sala hospedada na aba com
convidado por WebRTC. Números e evidências no [relatório de testes](../qa/VERTICAL_TRAVERSAL_TEST_REPORT.md).
