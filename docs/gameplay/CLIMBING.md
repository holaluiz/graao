# Escalada, beiradas e mantle

Implementação: `packages/game-core/src/traversal.ts` (`TraversalProbe`: detecção) e `character.ts`
(`stepHang`, `stepMantle`, `stepClimb`). Ajustes em `TRAVERSAL` (`game-data/traversal.ts`). Tudo roda igual no cliente
(predição) e no servidor (autoridade); a animação nunca move a cápsula.

## Superfícies (tags de jogabilidade, não textura)

Cada parte de prefab tem `traversal: 'ledge' | 'climb' | 'none'` (ou herda do prefab). O layout grava os bits
`SurfaceFlag` em cada colisor (`SurfacedCollider.trav` → `physics.traversalByCollider`).

| Tag | Equivale a | Padrão de |
|---|---|---|
| `ledge` (`LEDGE`) | `LEDGE_GRABBABLE` | toda parte sólida do kit (paredes, lajes, caixas, beirais), ilhas, plataformas |
| `climb` (`LEDGE`+`CLIMB`) | `CLIMBABLE` | paredões de escalada (`paredao-escalada-*`) |
| `none` | `NON_CLIMBABLE` | grades/cercas (`solid: 'move'`), troncos, rochas do maciço, rampas |
| — | `GRAPPLE_ANCHOR` | parte com `anchor: true` (Linha de Varal), sem relação com escalada |
| — | `GLIDE_LANDING` | qualquer topo caminhável; não precisa de tag |
| — | `WIND_SOURCE` | volume `winds` do mapa ([WIND_VOLUMES](WIND_VOLUMES.md)) |

Terreno nunca é beirada. Barreiras de magia (Muro de Papel) contam como beirada. Estruturas clássicas: casa, muro,
arco, poço e lasca flutuante são beiradas; torre, árvore gigante, poste e cristais não.

## Detecção (no ar, empurrando contra algo)

1. **Filtro barato:** uma sobreposição de cápsula alargada só aceita colisores com tag; sem nada marcado ao alcance,
   nenhuma sonda roda (`taggedNear`, −40% do custo no pior caso).
2. **Parede:** raios na direção do movimento a 0,6 / 1,15 / 1,7 / 2,05 m dos pés, de 0,4 m atrás do eixo até 0,78 m à
   frente; a face precisa ser íngreme e estar de frente (`wall`).
3. **Topo:** raio de cima para baixo logo atrás da face: topo caminhável (≤ 38°), entre 0,45 e 2,25 m sobre os pés,
   com uma face real de ≥ 0,35 m sob a borda (sem agarrar frisos) e do mesmo colisor ou marcado (`ledgeTop`).
4. **Espaço:** antes de pendurar, a cápsula precisa caber na pose (`canHang`); antes de subir, o destino 0,55 m além
   da borda precisa de apoio caminhável e a coluna da subida precisa estar livre (`canMantle`).

Resultado: beirada até 1,45 m (ou tão baixa que pendurado os pés tocariam o chão) → **mantle direto**; mais alta →
**pendurar**; face com `climb` → **escalar**.

## Pendurado (LEDGE_HANG)

Desliza até a pose (mãos na borda, 5 cm da face) a 4,5 m/s pelo controlador — nunca teleporta. ↑ (depois de 0,12 s)
ou pular sobem se houver espaço; ←/→ deslizam onde a beirada continua (sondada à frente); ↓ solta (ou passa a
escalar numa face `climb`); ↓+pular salta para trás; correr solta. Gasta 4/s.

## Mantle

Trajetória física em duas fases pelo controlador cinemático: sobe rente à face mais saliente sob a borda até os pés
passarem do topo, depois avança sobre ele (um telhado inclinado continua sendo subido pelo controlador). Bloqueado na
subida ou com mais de 1,1 s: solta. Custa 4 de stamina. Termina em pé com 1,5 m/s para a frente.

## Escalada (CLIMBING)

Velocidades ao longo da própria face (uma laje inclinada é escalada ao longo do declive): ↑1,7 ↓2,3 ↔2,0 m/s,
mantida a 4 cm da face. Gasto: ↑18/s, ↔10/s, ↓6/s, parado 3/s. Perto do topo (borda ao alcance das mãos) vira
mantle; no pé da parede, descendo, volta ao chão; pular salta para fora (4,5 m/s para fora, 5,6 para cima, custa 10).

## Stamina e exaustão

100 pontos; recupera 24/s no chão andando, 34/s parado (descanso em apoio seguro). Zerada pendurado ou escalando:
solta e não agarra nada por 0,8 s (pode cair; pode tentar agarrar outra beirada depois da espera, se tiver ≥ 5).
Nunca fica negativa (asserção em todos os testes de travessia).

## Segurança (o que é impossível por construção)

- Escalar dentro da geometria / através do teto: todo deslocamento passa pelo controlador; teto na subida do mantle
  cancela; destino ocupado recusa o mantle antes de começar.
- Teleporte por animação: a animação só acompanha o estado.
- Collider inexistente: a parede é re-sondada a cada passo; sem ela, solta.
- Velocidade acima do autorizado: velocidades fixas por estado, o servidor simula com o mesmo código.
- Reagarrar para ganhar altura: espera de 0,35 s e teste dedicado.
- Subir parede lisa no pulo repetido: a parede não é chão (o controlador do Rapier achava que era, porque na esfera
  ela inclina 1–2° para trás); o motor exige apoio caminhável sob a cápsula — teste dedicado (20/10).
- Magia saindo da parede: só mobilidade, com a espera de reagarre (ver [estados](TRAVERSAL_STATES.md)).

## Telhados da vila (medido)

Beirais de telhado ganharam uma testeira só de colisão (`eaveBoards` em `kitCore.ts`) para a borda ser agarrável por
fora. Em 72 paredes térreas da Vila das Lanternas abordadas por um script com pulo + pulo duplo, 29 levam ao telhado
(pendurar + mantle); as que não levam são sobrados e beirais acima do alcance (precisam de escada, magia ou outra
rota) — comportamento esperado.

## Testes

`traversal.test.ts`: caixa de 1 m (mantle direto), muro de 1,8 e 3,2 m (pendurar e subir), deslizar e parar no fim
da beirada, muro fino (pendura mas não sobe), beirada sob laje (subida recusada), bloco sem tag, sem stamina,
bot sem capacidade, reagarre sem ganho de altura, paredão de 6 m (escala e sobe), paredão de 20 m (exaustão), salto
para fora, pulo repetido contra face lisa não sobe. `tests/world.vertical.test.ts`: os três paredões da Serra do
Mirante no mapa real. `tests/vertical.mobility.multiplayer.test.ts`: Ricochete chuta para fora de um paredão (sem
reagarre imediato) e é recusado longe de parede; Linha de Varal do chão até a beirada da Ilha do Sino.

## Animação

O ciclo `climb` é procedural (nenhum pacote tem escalada de parede): uma mão alcança alto enquanto a outra puxa na
altura do ombro e o pé oposto sobe, depois o outro lado; joelhos para os lados (a cápsula fica a 4 cm da face: joelhos
para a frente entrariam na rocha) e a cabeça olha a rota. Corre com a velocidade de escalada (para trás descendo).
Pendurado parado, `hang`; deslizando na beirada, `shimmy` (a mão líder estende-se ao longo da borda), no sentido do
deslize. O mantle continua o `ClimbUp_1m` da UAL. Captura: `docs/world/screenshots/vertical-escalada-ciclo.jpg`.
