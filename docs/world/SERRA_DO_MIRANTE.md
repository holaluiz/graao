# Serra do Mirante

Inspirada nas cristas de itabirito da Serra do Curral e na Serra do Espinhaço. Construção `serra-do-mirante`
(`game-data/world/kitVertical.ts`), placement `vert-serra-macico` em lat 64,2 / lon −77,5, `yaw` 180 (frente — os
paredões — para o sul, para quem chega pela trilha do lago). Sob ela o terreno foi nivelado numa chapada a 6,2 m
(`flatten` raio 6,8°, transição 3,6°); a peça `serra-crista-1`, que ficaria enterrada, foi movida para fora.

## Forma (referencial do maciço: +X leste, +Z sul, Y para cima da base)

| Patamar | Planta | Topo |
|---|---|---|
| 1 (base) | x −8…8, z −6…6 (enterrado até −3) | 4,2 m |
| 2 | x −6…5, z −4,5…3,6 | 8,0 m |
| 3 (cume) | x −3,5…2,5, z −3,4…2,0 | 11,6 m (17,8 m sobre o raio) |

Rocha: um colisor de caixa por patamar, **desenhado como rocha quebrada** — as faces viram facetas irregulares de
≈ 1,6 × 1,1 m (até 0,1 m para fora e 0,2 m para dentro do colisor, topo plano para caminhar) em estratos inclinados de
itabirito, canga e ferrugem (`KitPart.relief` e `bands`, só visual), com musgo/capim de campo rupestre por cima. Os
pilares de pouso das rampas seguem o mesmo visual. Tudo `traversal: 'none'` — as faces longas não são escada; os
paredões de quartzito claro (rota B) continuam lisos e claros para ler "escale aqui" de longe.

**Crista dos fundos** (`crista-mirante`, peça própria): três lâminas de rocha (cascos convexos) atrás do patamar 1,
do chão até 12, 17 e 14,5 m, inclinadas para trás — de longe o maciço vira serra, não bolo de andares; a mais alta
aparece por cima do cume vista da frente, abaixo do topo do cruzeiro. Rente à face de trás do patamar 1 até 1,4 m
acima do terraço de trás (sem fresta onde cair) e com vãos entre elas (a trilha continua exposta em trechos). Fora do
alcance sem magia; o topo é uma aresta, não um poleiro. Matacões do pé, do terraço e do cume também são cascos
convexos (colisor = desenho). Capturas: `docs/world/screenshots/vertical-serra-rocha.jpg` e
`vertical-ilha-e-crista.jpg`.

## Rotas

| Rota | Sem magia | Caminho | Tempo medido* |
|---|---|---|---|
| A — Trilha | sim | rampa 1 (13,2 m, 21°) no lado leste até o terraço de trás do patamar 1 → oeste → rampa 2 (9 m, 23°) até o terraço da frente do patamar 2 → leste → rampa 3 (7 m, 27°) → cume pelo canto de trás. Sem corrimão: correndo em sprint dá para cair pela lateral (trilha exposta) | 12,2 s em corrida normal, nenhum pulo |
| B — Escalada | sim | três paredões de quartzito na frente (4,75 / 3,85 / 3,65 m), com os terraços de 2,4 e 1,6 m como descanso. O pulo e a borda ao alcance das mãos encurtam cada face; a stamina mínima medida na subida foi 63 | 5,0 s |
| C — Aérea | sim (pipa) | corrente ascendente no lado oeste (até 6 m acima do cume) e um vento direcional que cruza do topo dela até a borda oeste do cume (não além: quem passa do topo plana o resto) | 4,3 s, segurando pular |

\* `pnpm exec tsx tools/profiling/vertical-routes.ts` joga cada rota com entradas de jogador no mapa real; os testes
`tests/world.vertical.test.ts` exigem que as três cheguem ao cume.

Atalhos por magia: Voo de Papagaio (sobe 18 m), Linha de Varal (pega qualquer superfície; numa beirada termina na
altura de pendurar), Pulo de Pipa entre patamares — verificado em partida real: do terraço 1, diante da face lisa do
patamar 2 (sem beirada, sem escalada), pulo + pulo duplo ficam no terraço 1 e com o Pulo de Pipa no alto do pulo
duplo o jogador pousa no terraço 2, pulando a rampa 2 e o paredão. A pipa universal e a Asa de Papel saem do cume
para a Ilha do Sino; o Atalho de Giz do cume abre um portal até ela. Antes de 20/10, pular repetidamente contra a face
lisa do patamar 2 subia até o cume sem magia nenhuma (a parede contava como chão): corrigido no motor
([estados](../gameplay/TRAVERSAL_STATES.md)).

## Cume

- **Cruzeiro** (`cruzeiro-serra`): o marco visível de longe; a barra é âncora de gancho.
- **Sineira** (`sineira`): o sino do cume acorda por 24 s o vento `vert-corrente-cume-ilha`, que leva quem plana do
  cume até a Ilha do Sino (sem o sino, a planagem não alcança — teste dedicado). O toque é ouvido longe: todo mundo
  sabe que há alguém no cume.
- **Baú** `vert-cume-mirante` (exposto, céu aberto) e duas pedras como cobertura parcial. Região de baús **Alturas**:
  sorteado com vantagem, disputado também pelos bots ([ilhas](FLOATING_ISLANDS.md#loot)).
- Descidas: as três rotas ao contrário, saltar e planar para qualquer lado, ou a corrente do sino para as ilhas.

Contestável: o cume é visto (e atingível) da trilha, dos terraços, da corrente oeste e das ilhas; a rampa 3 e os
paredões chegam por lados diferentes.

## Pé do maciço

Pedras de cobertura baixa na aproximação, o marco de trilha `vert-marco-trilha`, o mirante de madeira existente
(`serra-mirante`) diante da frente, a corrente do sino logo a leste (o começo da ida às ilhas).

## Verificação

- Motor real no mapa real: rotas A, B e C chegam ao cume; bots do servidor sobem pela trilha, pelos três paredões e
  pela corrente oeste, e do cume tocam o sino para planar até a Ilha do Sino (`world.vertical`).
- Sala hospedada na aba com convidado por WebRTC: rota B completa, sino do cume, planagem na corrente do sino até a
  ilha ([autoridade](../networking/TRAVERSAL_AUTHORITY.md)).
- Navegador (Chromium) contra o servidor: escalada → mantle → terraço com correção de reconciliação ≤ 6 mm.
- Visual: capturas no relatório de QA. Arte: rocha facetada com estratos e crista (4ª rodada, 19/10); as rotas
  mediram os mesmos 12,2 / 5,0 / 4,3 s depois da troca.
