# Volumes de vento

Correntes ambientais que mudam a movimentação no ar: `UPDRAFT` (corrente ascendente) e `DIRECTIONAL_WIND` (vento
direcional). `TURBULENCE_LIGHT` não foi implementado de propósito (o pedido proíbe turbulência aleatória que torne o
controle imprevisível; uma turbulência leve determinística fica para quando houver um uso de design).

## Dados (mapa versionado)

`GraaoMap.winds` (`game-data/world/map.ts`, `MapWind`): `id`, `kind` (`updraft` | `directional`), `lat`/`lon` do
centro, `base` (m sobre o terreno sob o centro) e `height`, `radius`, `strength` (m/s), `yaw` (direção do vento
direcional, graus a partir do norte local) e `trigger` opcional (id da peça cujo sino acorda o vento). `validateMap`
confere tipos, limites (`WIND_LIMITS`) e gatilhos. Mapas antigos sem `winds` continuam válidos (nenhum vento); o
`MAP_HASH` inclui os ventos, então cliente e servidor nunca jogam com ventos diferentes.

## Física (game-core `wind.ts` + motor)

- Coluna ao longo do *up* local do centro; força cheia por dentro, esvaecendo nos 25% externos do raio e nos 22%
  superiores da altura (sem borda dura).
- **Ascendente:** quem plana é acelerado a 26 m/s² até a velocidade da corrente; quem não plana só tem a queda freada
  até 3,2 m/s (sem subida livre sem pipa).
- **Direcional:** desloca o referencial do ar: o controle aéreo mira a intenção + a velocidade do vento, então um
  corpo sem comando é levado na velocidade do vento (45% dela sem pipa). Aceleração mínima de 9 m/s².
- Só no ar, fora d'água, sem mergulho, dash, enraizamento, Voo de Papagaio ou Linha de Varal.
- Cada efeito tende a uma velocidade-alvo: nada acumula (teste "never past its speed").
- Teto radial da zona jogável: 42 m sobre o raio; acima dele nada sobe.

## Autoridade e rede

O servidor e a predição rodam os mesmos volumes a partir do mesmo mapa; o cliente nunca declara estar num vento. Os
ventos de evento sopram enquanto o sino deles toca: `InteractiveSystem.windsOn` (servidor por sala, espelho no
cliente via `WORLD_STATE.b` e eventos `bell`) vira `CharacterMotor.windActive`.

## Apresentação (cliente `WindDirector`)

- Faixas pálidas instanciadas (cilíndricas, viradas para a câmera) subindo em espiral nas ascendentes e cruzando nas
  direcionais, mais folhas nas ascendentes: 2 draw calls para todos os ventos; volumes a mais de 95 m não são
  desenhados; ventos de evento aparecem e somem com o sino.
- Som: um leito de rajadas (`WorldAudio`, barramento de ambiente) cujo volume segue a distância ao vento mais próximo.
- Dica nas três primeiras vezes dentro de uma corrente sem pipa: "PULE E SEGURE [ESPAÇO] PARA PLANAR".
- Roupa animada pelo vento: não implementado (o rig não tem ossos de tecido).

## Editor

Aba **Ventos (4)** do editor de mapa: colunas desenhadas como no jogo (ciano ascendente, amarelo direcional com seta,
rosa de evento), clique cria uma ascendente (num telhado/deck a base começa nele), Q/E giram, +/− raio, PgUp/PgDn
base, [ ] altura, inspetor com tipo, força e gatilho (lista os sinos do mapa).

## Ventos do mapa (19/10)

| id | tipo | onde | papel |
|---|---|---|---|
| `vert-corrente-mirante-subida` | ascendente | lado oeste do maciço | rota C da Serra |
| `vert-corrente-mirante-travessia` | direcional (leste) | acima do patamar oeste | leva da corrente ao cume |
| `vert-corrente-do-sino` | ascendente | ao lado da Ilha do Sino | acesso universal à ilha |
| `vert-corrente-cume-ilha` | direcional, evento (sino do cume) | do cume para a ilha | atalho cume → ilha |
| `vert-corrente-torre` | ascendente, evento (sino da ilha) | norte da Ilha do Sino | atalho para a Ilha da Torre |

## Testes

`packages/game-core/src/wind.test.ts` (amostragem e esvaecimento, sem pipa não sobe, com pipa sobe e pousa na ilha,
direcional sem passar da velocidade, stamina limita o pairar, replay idêntico, sino e espelho do cliente, teto,
Tormenta por direção) e `tests/world.vertical.test.ts` (ventos do mapa real).
