# Relatório de testes — Vertical World & Traversal (19/10/2026)

Estados conforme [RELEASE_GATES](RELEASE_GATES.md). Nada aqui foi verificado em redes externas, em celular físico ou
com dez participantes humanos.

## Resumo por gate do roadmap

| Gate | Estado | Evidência |
|---|---|---|
| V0 Auditoria | DONE | [auditoria](../gameplay/VERTICAL_TRAVERSAL_AUDIT.md) com baseline |
| V1 Movimento (beirada, mantle, escalada curta, planagem) | TESTING | 29 testes do motor; navegador solo e online; telhado da vila pela beirada em rede |
| V2 Autoridade e rede | TESTING | servidor real + clientes SDK; partida real com combate vertical; **predição do cliente com 100 ms de atraso em cada sentido**; Chromium × servidor local; sem rede externa |
| V3 Correntes de vento | TESTING | 10 testes; ventos do mapa real; sincronia do sino em rede |
| V4 Serra do Mirante | TESTING | 3 rotas chegam ao cume no motor real (12,2 s / 5,0 s / 4,3 s), e bots sobem pelas rotas B e C; arte em blocos |
| V5 Ilha do Sino | TESTING | acesso universal, caminhada, ponte, pedras, saída por planagem, baús; tiro da ilha ao chão, rocha como cobertura, empurrão da borda, Tormenta na ilha (partida real); meteoro, projéteis, Voo de Papagaio, Anel de Vento e Muro de Papel na borda |
| V6 Editor | TESTING | aba Ventos, cores de colisor por tag, família VERTICAL; ligações de travessia dos bots (Alt+clique, tipo/vento/risco) e "Testar rota" |
| V7 Arquipélago | TESTING | 3 ilhas, 2 sinos com evento autoritativo |
| V8 Bots e creeps | TESTING | `BotTraversalLink` no grafo; bots escalam, sobem correntes, planam para descer, saltam pedras e **tocam sinos** no mapa real; falha bloqueia o link; da ilha fogem da Tormenta e voltam a lutar; creeps terrestres |
| V9 Polimento | PARTIAL | controles de toque com ação contextual; animações procedurais (pendurar, planar) + clipe UAL; **rocha facetada com estratos, ilhas com rocha em ponta, crista da Serra**; sem clipes dedicados nem celular físico |
| V10 Validação final | PARTIAL | 10 participantes (2 SDK + 8 bots) no servidor real; **sala hospedada na aba com convidado por WebRTC** (rota B, sino, planagem até a ilha); faltam celular físico, redes externas e partida completa entre pessoas |

## Testes automatizados

| Arquivo | Testes | O que prova |
|---|---|---|
| `packages/game-core/src/traversal.test.ts` | 29 | matemática radial, tabela de estados, beirada/mantle/escalada/planagem, anti-abuso, empurrão e magia, contrato de predição |
| `packages/game-core/src/wind.test.ts` | 10 | coluna e esvaecimento, pipa, direcional, stamina, sino, teto radial, Tormenta por direção em altitude e no lado oposto |
| `tests/world.vertical.test.ts` | 21 | mapa real: rotas A/B/C, ilha pela corrente, ponte + pedras, sinos; **bots** pela trilha, pelos três paredões (rota B), pela corrente oeste (rota C), Corrente do Sino → ilha → ponte → Oratório, da ilha ao chão planando, pedras até a Ilha da Torre, tocando o sino da ilha e o do cume para abrir as correntes, parando na borda a pé; sem travessia nenhum link; **rocha**: casco desenhado = colisor, relevo nunca muda colisor, rocha da ilha ≤ 0,8 da laje, crista rente ao terraço e com vãos, matacões apoiados |
| `apps/server/src/sim/BotNav.test.ts` | 8 | sair no link, concluir, erro de tentativa ≠ falha, descanso pela stamina, duas falhas bloqueiam (sem laço), tempo esgotado, capacidades e vento de evento, desvio até o sino e volta, sino longe demais ou mudo |
| `tests/vertical.bots.multiplayer.test.ts` | 2 | bot na ilha foge da Tormenta planando, entra na região segura e volta a lutar; 10 participantes ao redor da Serra até o fim da partida, com o custo de cada tick |
| `tests/traversal.multiplayer.test.ts` | 5 | B vê CLIMB/MANTLE/terraço e GLIDE subindo; stamina no snapshot; sino recusado de longe, aceito de perto |
| `tests/vertical.multiplayer.test.ts` | 6 | telhado da vila pela beirada (LEDGE_HANG → MANTLE); Corrente do Sino até a ilha; partida real: tiro entre altitudes, ilha como cobertura, empurrão + planagem + pouso, Tormenta fere quem está na ilha, vencedor; predição sob latência |
| `tests/vertical.abilities.multiplayer.test.ts` | 4 | magias reais entre o chão e a ilha: Meteoro Solar caindo no chão bem embaixo de A (dentro do raio no plano) não atinge A 15 m acima, e o da borda atinge B no chão (35); Orbe Solar de baixo termina na rocha, Laço de Cipó de fora da borda acerta A; Voo de Papagaio leva B do chão até a ilha; Anel de Vento joga A pela borda (A abre a pipa e pousa) e um Muro de Papel na borda segura A no mesmo empurrão |
| `apps/client/src/game/Input.test.ts`, `TouchControls.test.ts` | +2, 3 | toque segura/aperta as mesmas ações que o teclado, eixo analógico, olhar pelo mesmo caminho do mouse; prioridade do botão contextual e rótulo do pulo |
| `tests/world.nav.test.ts` | 10 | grafo com a nova regra de degraus continua cobrindo regiões, sobrado, viaduto, ilha do lago, cachoeira |

Quarta rodada (19/10 à noite): antes da arte de rocha, **666/666 em 69 arquivos**; depois, **669/670** (474 s) e
typecheck completo limpo — a falha foi `multiplayer.test.ts › keeps the seat while B reconnects…` esperando uma
mensagem de reconexão por 8 s sob a carga da suíte (nascimentos na vila, nada da Serra); o arquivo isolado passa
49/49.

Terceira rodada — suíte completa (com os testes de magia): **655/656 em 68 arquivos** (405 s) e typecheck completo limpo. A única falha é o teste de relógio real `multiplayer.test.ts › renders a remote smoothly…` (p95 2,01 contra o limite de 2,0 m/s), já conhecido como sensível à carga da máquina desde a auditoria de base; o arquivo isolado passa 49/49. A rodada anterior teve 652/652.

## Cenários multiplayer pedidos (25)

| # | Cenário | Situação |
|---|---|---|
| 1 | A escala e B observa | feito (Node) |
| 2 | A agarra beirada | **feito** em rede: parede de casa da vila, B vê LEDGE_HANG |
| 3 | A sobe no telhado | **feito** em rede: MANTLE e A de pé no telhado (> 2,2 m acima da rua) |
| 4 | A plana de uma estrutura | feito: da borda da ilha depois do empurrão |
| 5 | A entra em corrente | feito |
| 6 | A chega a uma ilha | **feito** em rede (Corrente do Sino) |
| 7 | A atira da ilha para o solo | **feito**: o hitscan do servidor acerta B no chão |
| 8 | B usa magia de mobilidade para perseguir | **feito**: Voo de Papagaio do chão até a ilha, B pousa ao lado de A (A vê B lá em cima) |
| 9 | A recebe empurrão e cai | **feito**: Anel de Vento real joga A pela borda; A abre a pipa, plana e pousa |
| 10 | A aterrissa | feito |
| 11 | Ambos continuam combatendo | **feito**: tiro e meteoro entre altitudes, projéteis mágicos (rocha bloqueia de baixo, laço acerta de fora da borda), Muro de Papel segurando A na borda contra o Anel de Vento |
| 12 | Tormenta fecha sobre a região | **feito**: A na ilha (alto, fora) leva dano, B no chão (dentro) não, partida termina com B vencedor |
| — | Latência simulada | **feito**: 100 ms em cada sentido com a predição real do cliente; 95% das correções < 5 cm, máximo < 35 cm, nenhum salto |
| — | Redes externas | **não feito** (BLOCKED: máquinas do M2) |

### Defeito encontrado pela latência simulada

Com latência, logo depois de um reposicionamento (respawn, início de partida) o cliente reconstruía "pulo segurado"
a partir da própria predição; o replay perdia a borda do pulo e da pipa e corrigia **1,96 m**. Corrigido em
`LocalPlayer` (`heldBefore`: os botões antes do replay). Depois da correção, nenhuma correção acima de 5 cm no mesmo
cenário.

## Bots (26)

| Pedido | Situação |
|---|---|
| Bot usando escadas/rampas | feito (trilha da Serra; regiões no `world.nav`) |
| Bot contornando rochas | feito (maciço) |
| Bot utilizando link de subida | **feito**: escalada (3 paredões), corrente (oeste e do Sino), saltos (pedras) |
| Bot alcançando objetivo | feito: cume, ilha, Oratório, Ilha da Torre |
| Bot fugindo da Tormenta | **feito** em partida real: o bot na ilha plana pelo link de planagem e entra na região segura (`vertical.bots.multiplayer`) |
| Bot abandonando rota inviável | **feito**: duas falhas bloqueiam o link por 45 s e o plano dá a volta (teste de grafo); queda numa caminhada encarece a aresta |
| Bot evitando queda fatal | sem dano de queda no jogo; caminhadas de onde caiu passam a custar mais |
| Bot retornando ao combate | **feito**: depois de descer da ilha planando, o bot volta a acertar quem o esperava no chão |
| Bot tocando sino | **feito**: desvia até o sino perto do início de um link de vento de evento, a sala valida o toque, o bot volta e sobe/plana na corrente |

### Defeitos encontrados pelos bots e corrigidos

1. O grafo aceitava subir do terraço para o lado da laje de uma rampa (1,2 m), achando apoio num bloco de enchimento
   dentro da laje: o bot pulava, caía da rampa e repetia. Agora caminhadas que sobem são amostradas a cada 0,3 m, cada
   degrau cabe no autostep, e apoio só conta com 1 m livre acima.
2. Sem memória de caminhadas que falham, um bot que caía de uma rampa voltava a ela. Agora a aresta custa mais por 60 s.

## Navegador (painel do app, Chromium)

Primeira rodada: escalada → mantle → terraço, planagem na corrente, sino, editor (aba Ventos); online contra o servidor
local com correção ≤ 6 mm. Capturas: `docs/world/screenshots/vertical-*.jpg`.

Segunda rodada (cliente `graao-client-vertical`, servidor `graao-server-vertical`):

- Editor `?editor`: "17 travessias" no título; o painel do waypoint lista a ligação (tipo, vento, risco); "Testar rota"
  da base da Corrente do Sino à Ilha da Torre: "7 pontos · corrente do Sino, corrente da Torre", linha desenhada e as
  17 setas (51 segmentos) na cena.
- Toque, emulação de celular (paisagem 812×375 e retrato 375×812, toque emulado): joystick até o paredão da Serra → o
  botão contextual vira ESCALAR → toque → escalando, botão SOLTAR; cliques reais com teste de acerto chegam a PULAR e
  aos ícones de magia do HUD (a magia 2 sai: avanço e recarga de 6,2 s); HUD sem sobreposições em paisagem; em retrato
  o cartão "Gire o celular" cobre tudo.
- **Defeito encontrado e corrigido:** a camada `.ability-bearings` (tela cheia) recebia `pointer-events: auto` pela regra
  `#ui > *` e engolia todo toque e clique no mundo — o toque nunca chegaria ao joystick, e no desktop um clique no mundo
  não recapturava o ponteiro. Agora o clique no mundo acerta o canvas.
- Não verificado: celular físico (tela cheia e trava de orientação só existem de verdade no aparelho).

## Combate vertical com magias (19/10, terceira rodada)

- **Áreas são 3D:** o impacto do Meteoro Solar caiu no chão a menos de 6 m (na horizontal) de A, que estava na ilha 15 m
  acima: um círculo no plano teria atingido A; o servidor mede distância 3D e linha de visão do centro (`areaVictims`),
  e A não levou dano nem empurrão. De cima para baixo a área funciona (B levou 35).
- **Projéteis e a rocha:** o Orbe Solar disparado de baixo termina na rocha da ilha (evento `projEnd` com alvo −1,
  acima de B e abaixo do topo). O lábio da borda esconde o corpo de quem está nela para quem atira de baixo — o laço é
  uma esfera de 0,35 m e raspa o lábio onde um raio fino passa; mirando a cabeça de um ponto com folga, acerta.
- **Muro de Papel:** só nasce sobre superfície (sobre o vazio é recusado); erguido entre A e a borda, segurou A no
  Anel de Vento (A foi de 2,3 m a 3,5 m e parou no muro em 3,9 m; sem o muro, A cai pela borda).
- Nenhum defeito encontrado nesta rodada: os quatro cenários passaram como o motor prevê.

## Sala hospedada na aba, convidado por WebRTC (19/10, quarta rodada)

O modo do site desde a ADR-006 nunca tinha sido exercitado com travessia (as rodadas anteriores usaram servidor
dedicado com `?server=` ou o modo offline). Duas abas do painel no `graao-client-vertical`, sem servidor: A cria a sala
(Worker na aba de A), B entra pelo código (WebRTC, sinalização Supabase). Detalhes em
[autoridade](../networking/TRAVERSAL_AUTHORITY.md).

| Cenário | Resultado |
|---|---|
| B escala a rota B | três paredões, ESCALADA → PENDURADO → MANTLE, cume em ~6 s (duas vezes) |
| B toca o sino do cume | o Worker valida; B vê "Sino tocando" |
| B plana até a ilha | do cume, na corrente do sino, agarra a borda da Ilha do Sino e sobe: de pé no centro da ilha |
| A vê B | a anfitriã recebe RUN → CLIMB → MANTLE → CLIMB → MANTLE → GLIDE → pouso |
| Correções de B (subida + planagem) | 133 reconciliações: mediana 1 mm, p95 2 mm, máximo 7 mm |
| Soluço da anfitriã | aba anfitriã em segundo plano ficou 340 ms sem repassar mensagens: a sala derrubou B (proteção `starvedFor`, 0,3 s sem comandos no ar) e a correção seguinte foi de 0,68 m |

Achado (não é defeito da travessia): numa sala hospedada, um travamento ≥ 0,3 s da aba anfitriã aciona a queda por
falta de comandos para quem está no ar (planando, pendurado), porque os comandos do convidado passam pela thread
principal da anfitriã. Com a anfitriã jogando, com a aba na frente, não apareceu.

Não exercitado no navegador: bots com travessia dentro do Worker (o mesmo `GraaoMatchRoom` coberto no Node).

## Arte de rocha (19/10, quarta rodada)

Troca das "pilhas de lajes" por rocha, sem mexer nas rotas: patamares do maciço desenhados com facetas e estratos de
itabirito sobre o mesmo colisor de caixa (`relief`, `bands`), a parte de baixo das ilhas e das pedras flutuantes como
uma rocha só em ponta, matacões irregulares e uma crista de três lâminas atrás do maciço (cascos convexos: o colisor
é o desenho). Rotas A/B/C medidas de novo (12,2 / 5,0 / 4,3 s, iguais), testes do motor, do grafo e dos bots verdes,
4 testes novos de rocha. Custo: +2,4% de triângulos no kit, nenhuma malha nova, quadro no pé da Serra ~1 ms acima da
vila como antes ([orçamento](../performance/VERTICAL_WORLD_BUDGET.md)). Capturas: `vertical-serra-rocha.jpg`,
`vertical-ilha-e-crista.jpg`, `vertical-ilhas-rocha.jpg` em `docs/world/screenshots/`.

## Pendências

- Celular físico: toque, tela cheia e trava em paisagem foram testados só com emulação no Chromium do painel.
- Clipes dedicados (pendurar, planar), roupa ao vento; texturas/arte final além da rocha procedural.
- Bots: escolher altura por estratégia; creeps aéreos; bots com travessia exercitados dentro do Worker no navegador.
- Sala hospedada: a queda por falta de comandos (0,3 s) pune o convidado no ar quando a aba anfitriã trava.
- Redes externas e celular físico (máquinas do M2). O Graao Host está desligado no site (ADR-006); instalador novo
  para o protocolo 11 só se ele voltar (publicação exige aprovação).
