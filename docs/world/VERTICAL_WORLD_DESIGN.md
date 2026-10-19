# Mundo vertical — design

O planeta tem 100 m de raio (628 m de volta). A verticalidade foi composta dentro dessa escala, sem mudar o raio.

## Princípios aplicados

- **Altura é escolha, com risco.** Cume e ilhas veem longe (do cume, a 17,8 m sobre o raio, o horizonte fica a ~62 m:
  uma calota de ~32° de arco do planeta) e guardam baús, mas são expostos, têm cobertura limitada (pedras, um cruzeiro, uma capelinha
  com uma só entrada) e mais de uma saída. Nenhuma posição é um bunker: cada lugar alto tem rota de acesso sem magia,
  e todo lugar alto é alcançável por armas e magias de baixo.
- **Múltiplas rotas.** A Serra tem três (trilha, escalada, corrente de ar); cada ilha tem uma rota universal e
  alternativas por magia ou evento.
- **Magia acelera, não tranca.** Nenhuma região essencial exige magia; o Voo de Papagaio (+18 m), a Linha de Varal
  (âncoras nas ilhas e o cruzeiro) e o Pulo de Pipa encurtam caminhos.
- **Cair não mata** (o jogo não tem dano de queda — mudar isso é regra competitiva e precisa de aprovação): ser
  empurrado de uma ilha custa a posição e o tempo de voltar, e a pipa permite reagir na queda.
- **Leve:** composição, silhueta e cor em vez de polígonos ([orçamento](../performance/VERTICAL_WORLD_BUDGET.md)).

## Escala (medida no motor)

| Medida | Valor |
|---|---|
| Pulo / pulo duplo | 1,3 m / 2,4 m |
| Beirada alcançável no ar | até 2,25 m sobre os pés (≈ 4,6 m do chão com pulo duplo) |
| Paredão escalável com uma barra de stamina | ≈ 9 m contínuos (18/s a 1,7 m/s); os da Serra têm ≤ 4,8 m com patamar entre eles |
| Planagem sem vento | 2,6 s, 6,6 m/s, cai 4,8 m/s → ≈ 17 m de alcance perdendo 12,5 m |
| Teto radial | 42 m sobre o raio |
| Cume da Serra / Ilha do Sino / Ilha da Torre | 17,8 m / 15,6 m / 22,6 m sobre o raio |

**Lição de construção:** uma construção é rígida no plano tangente do seu centro; numa esfera de 100 m, a 12 m do
centro o chão já está 0,7 m abaixo do `y = 0` dela (d²/2R). Peças largas precisam descer até o terreno nas bordas
(o pé da rampa 1 começa 0,6 m abaixo da base; pedras do pé descem 1 m) e alturas de waypoints/baús saem do ponto do
mundo, não da altura radial do centro.

## Conteúdo

- [Serra do Mirante](SERRA_DO_MIRANTE.md): maciço de itabirito em três patamares sobre uma chapada nivelada na
  primeira crista da serra (`planet.ts`: `flatten` em 64,2 / −77,5).
- [Arquipélago dos Sinos](FLOATING_ISLANDS.md): três ilhas a leste e ao sul do maciço, ponte suspensa, escada de
  pedras flutuantes, dois sinos que acordam ventos.
- [Prefabs verticais](VERTICAL_PREFABS.md) e [volumes de vento](../gameplay/WIND_VOLUMES.md) no editor.
- Vila das Lanternas: telhados agarráveis pelos beirais (testeiras de colisão).

## Autoria

`tools/world/vertical-world.ts` escreve o conjunto (ids `vert-*`) no mapa versionado ao lado das edições manuais,
calculando elevações, baús, ventos e waypoints nos referenciais que o jogo constrói; depois disso o editor
(`?editor`) ajusta qualquer peça. Rodar de novo só para refazer a região.

## Tormenta

A zona segura é decidida pela direção geocêntrica (ângulo), nunca por X/Z nem pela altura: estar numa ilha, planando
ou no teto não protege (teste em `wind.test.ts`). O teto radial impede fugir da simulação subindo.
