# Ilhas flutuantes — Arquipélago dos Sinos

Três ilhas suspensas a leste e ao sul da Serra do Mirante, sobre o campo baixo (terreno ≈ 1 m). Cada ilha é uma
construção com `lift` (altura da superfície caminhável sobre o terreno), editável no editor como qualquer peça.

| Ilha | Construção | Topo (sobre o raio) | Conteúdo |
|---|---|---|---|
| Ilha do Sino | `ilha-do-sino` (11 × 9) | 15,6 m | capelinha (baú coberto, uma entrada), sineira, duas árvores, duas âncoras |
| Ilha do Oratório | `ilha-do-oratorio` (7 × 7) | 15,6 m | mureta e pilar em ruína (cobertura), uma âncora |
| Ilha da Torre | `ilha-da-torre` (5 × 5) | 22,6 m | pilar quebrado, baú exposto, uma âncora |

## Ilha

`ilha-flutuante-g/m/p`: laje caminhável de terra (topo na base da peça, bordas agarráveis — quem cai perto ainda
pega a beirada; lados desenhados com facetas leves), e por baixo **uma rocha só** afunilando até uma ponta 7,4 m
abaixo da laje: anéis de pontos em retângulo arredondado, puxados para dentro ao acaso, em estratos de itabirito,
canga e ferrugem; cristais saindo da rocha no meio da descida e raízes pendendo do beiral. A rocha é um casco convexo
desenhado e colidido com os mesmos pontos (projéteis e corpos batem no que se vê; ninguém agarra a parte de baixo) e
nunca passa de 0,8 da laje — quem pendura na borda fica livre dela (teste em `world.vertical`). As pedras flutuantes
(`plataforma-pedra`) têm a mesma ponta, em miniatura. Captura: `docs/world/screenshots/vertical-ilhas-rocha.jpg`.

## Acesso e saída

| Para | Rota universal (sem magia) | Alternativas |
|---|---|---|
| Ilha do Sino | corrente ascendente `vert-corrente-do-sino` (lado oeste) + pipa | Voo de Papagaio, Linha de Varal (âncoras), vento do sino do cume |
| Ilha do Oratório | ponte suspensa de 7 m (`ponte-tabuas`) | as mesmas |
| Ilha da Torre | escada de 6 pedras flutuantes (≈ 1 m de subida e ≈ 0,4 m de vão cada) a partir do Oratório, e a borda sul da ilha como beirada | sino da Ilha do Sino: acorda por 24 s a corrente `vert-corrente-torre` |

Saída de qualquer ilha: saltar e planar (ou só cair: não há dano de queda), a corrente de volta, a ponte. Ninguém
fica preso: cada ilha tem borda agarrável e pelo menos duas saídas.

## Sino interativo (evento)

`sineira` tem uma parte `bell`; o layout exporta `layout.bells` (id = ordem no mapa). F perto do sino (2,6 m do
peito) envia `WORLD_USE {k: 1}`; o servidor confere alcance, intervalo e se já está tocando, toca por 24 s, liga os
ventos cujo `trigger` é a peça do sino e manda o evento `bell` a todos (som espacial ouvido a 120 m, faíscas
douradas, aviso na tela). `WORLD_STATE.b` traz os sinos tocando para quem entra no meio. O sino não abre portas,
não move plataformas e não dá loot: só vento (sistema pequeno, como pedido).

## Loot

Pontos de baú do sistema existente (`chestSpots` com `surface: 'prop'` e `height`), validados pelo servidor:
`vert-ilha-sino-capelinha` (coberto) e `vert-ilha-torre` (exposto); mais o do cume. A região de loot é "Trilhas" (a
raridade é a do sorteio normal; não há loot "melhor" por altura — se o design quiser, é uma regra nova de loot).

## Combate

Armas e magias funcionam normalmente nas ilhas (os colisores são do mundo estático: projéteis batem, explosões e
Muro de Papel se apoiam neles). Empurrões tiram da beirada/planagem com espera de 0,35 s antes de reagarrar; a queda
dá tempo de abrir a pipa. Verificado em partida real (`tests/vertical.abilities.multiplayer.test.ts`): o Meteoro
Solar no chão sob a ilha não atinge quem está nela (área 3D) e o da borda atinge o chão; projéteis mágicos param na
rocha vindo de baixo; o Anel de Vento joga pela borda e um Muro de Papel na borda segura o mesmo empurrão.

## Câmera

A câmera colide só com o terreno (props se dissolvem entre câmera e jogador): perto das bordas e embaixo das ilhas a
rocha dissolve em vez de empurrar a câmera — a leitura da borda fica por conta da distância extra em beiradas e na
planagem.
