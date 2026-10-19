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

Rocha: um colisor de caixa por patamar, vestido com lâminas inclinadas, estratos claros e musgo/capim de campo
rupestre (decoração a ≤ 0,15 m do colisor). Tudo `traversal: 'none'` — as faces longas não são escada.

## Rotas

| Rota | Sem magia | Caminho | Tempo medido* |
|---|---|---|---|
| A — Trilha | sim | rampa 1 (13,2 m, 21°) no lado leste até o terraço de trás do patamar 1 → oeste → rampa 2 (9 m, 23°) até o terraço da frente do patamar 2 → leste → rampa 3 (7 m, 27°) → cume pelo canto de trás. Sem corrimão: correndo em sprint dá para cair pela lateral (trilha exposta) | 12,2 s em corrida normal, nenhum pulo |
| B — Escalada | sim | três paredões de quartzito na frente (4,75 / 3,85 / 3,65 m), com os terraços de 2,4 e 1,6 m como descanso. O pulo e a borda ao alcance das mãos encurtam cada face; a stamina mínima medida na subida foi 63 | 5,0 s |
| C — Aérea | sim (pipa) | corrente ascendente no lado oeste (até 6 m acima do cume) e um vento direcional que cruza do topo dela até a borda oeste do cume (não além: quem passa do topo plana o resto) | 4,3 s, segurando pular |

\* `pnpm exec tsx tools/profiling/vertical-routes.ts` joga cada rota com entradas de jogador no mapa real; os testes
`tests/world.vertical.test.ts` exigem que as três cheguem ao cume.

Atalhos por magia: Voo de Papagaio (sobe 18 m), Linha de Varal até a barra do cruzeiro (âncora), Pulo de Pipa entre
patamares.

## Cume

- **Cruzeiro** (`cruzeiro-serra`): o marco visível de longe; a barra é âncora de gancho.
- **Sineira** (`sineira`): o sino do cume acorda por 24 s o vento `vert-corrente-cume-ilha`, que leva quem plana do
  cume até a Ilha do Sino (sem o sino, a planagem não alcança — teste dedicado). O toque é ouvido longe: todo mundo
  sabe que há alguém no cume.
- **Baú** `vert-cume-mirante` (exposto, céu aberto) e duas pedras como cobertura parcial.
- Descidas: as três rotas ao contrário, saltar e planar para qualquer lado, ou a corrente do sino para as ilhas.

Contestável: o cume é visto (e atingível) da trilha, dos terraços, da corrente oeste e das ilhas; a rampa 3 e os
paredões chegam por lados diferentes.

## Pé do maciço

Pedras de cobertura baixa na aproximação, o marco de trilha `vert-marco-trilha`, o mirante de madeira existente
(`serra-mirante`) diante da frente, a corrente do sino logo a leste (o começo da ida às ilhas).

## Verificação

- Motor real no mapa real: rotas A, B e C chegam ao cume; o bot do servidor sobe pela trilha (`world.vertical`).
- Navegador (Chromium) contra o servidor: escalada → mantle → terraço com correção de reconciliação ≤ 6 mm.
- Visual: capturas no relatório de QA. Arte: blocos estilizados; refinamento de silhueta/cor é polimento (V9).
