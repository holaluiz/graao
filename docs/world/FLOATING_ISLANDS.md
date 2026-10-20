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
| Ilha do Sino | corrente ascendente `vert-corrente-do-sino` (lado oeste) + pipa; do cume, a pipa também chega cruzando essa corrente | Voo de Papagaio; Linha de Varal do chão (corda no beiral, beirada, mantle); Asa de Papel do cume; Atalho de Giz do cume; vento do sino do cume |
| Ilha do Oratório | ponte suspensa de 7 m (`ponte-tabuas`) | as mesmas |
| Ilha da Torre | escada de 6 pedras flutuantes (≈ 1 m de subida e ≈ 0,4 m de vão cada) a partir do Oratório, e a borda sul da ilha como beirada | sino da Ilha do Sino: acorda por 24 s a corrente `vert-corrente-torre` |

Saída de qualquer ilha: saltar e planar (ou só cair: não há dano de queda), a corrente de volta, a ponte. Ninguém
fica preso: cada ilha tem borda agarrável e pelo menos duas saídas.

**Rotas por magia verificadas em partida real (20/10, `tests/vertical.mobility.multiplayer.test.ts`):**

- **Linha de Varal do chão:** de 3 m fora da borda sul, a corda (14 m de alcance) acerta a parte de baixo da laje
  junto ao beiral. Até 19/10 ela terminava 2,7 m sob o topo, debaixo do beiral — fora do alcance das mãos (2,25 m): o
  jogador batia a cabeça na laje e caía 14 m. Agora uma corda que pega a face ou o beiral de uma beirada termina
  diante da borda, 1,2 m sob o topo (`TRAVERSAL.grapple`); empurrando para a ilha, PENDURADO → MANTLE → de pé na laje.
  As âncoras das ilhas não alcançam do chão (o topo fica a ~16 m; a corda pega qualquer superfície).
- **Asa de Papel do cume** (sino calado): pousa na Ilha do Sino. Em ar parado, 14 m acima do chão, a Asa leva 32,1 m
  contra 18,1 m da pipa universal.
- **Atalho de Giz:** um portal precisa de linha de visão até a ponta: debaixo de uma ilha o topo nunca está à vista
  (recusado, `BLOCKED`); do cume (2 m mais alto, 20 m longe) está. O portal do cume leva à ilha e, enquanto dura,
  traz de volta; outro jogador que entra nele não vai a lugar nenhum, e ninguém é mandado para cima de quem está
  parado na outra ponta. Observação: quem chega e fica parado sobre a saída volta pelo portal depois de 1,5 s (regra da
  magia, não da ilha).
- **Passo de Vento pela borda:** o impulso passa do beiral; segurando pular a pipa abre e o jogador pousa no chão.

## Sino interativo (evento)

`sineira` tem uma parte `bell`; o layout exporta `layout.bells` (id = ordem no mapa). F perto do sino (2,6 m do
peito) envia `WORLD_USE {k: 1}`; o servidor confere alcance, intervalo e se já está tocando, toca por 24 s, liga os
ventos cujo `trigger` é a peça do sino e manda o evento `bell` a todos (som espacial ouvido a 120 m, faíscas
douradas, aviso na tela). `WORLD_STATE.b` traz os sinos tocando para quem entra no meio. O sino não abre portas,
não move plataformas e não dá loot: só vento (sistema pequeno, como pedido).

## Loot

Pontos de baú do sistema existente (`chestSpots` com `surface: 'prop'` e `height`), validados pelo servidor:
`vert-ilha-sino-capelinha` (coberto) e `vert-ilha-torre` (exposto); mais o do cume.

**Loot nas alturas (20/10).** Os três formam a região de baús **Alturas** (`CHEST_REGIONS`, `vantage`): toda partida
tem pelo menos um baú lá em cima; sendo o primeiro da região, é inicial (sempre traz arma); e é sorteado com vantagem —
duas rolagens, fica a de item mais raro (em 600 partidas simuladas a raridade do melhor item sobe ~0,15 degrau em
média, e as regras da partida — armas suficientes, no máximo 2 épicos — continuam valendo). É a recompensa pelo risco
de subir exposto. Os bots pesam esses baús como 20 m mais perto e sobem pelas rotas que conhecem: um bot no pé da
Serra trocou um baú comum a 8,2 m pelo do cume a 15,1 m, subiu os três paredões e o abriu
(`tests/vertical.bots.multiplayer.test.ts`). No editor, a região é a do campo "região" do baú.

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
