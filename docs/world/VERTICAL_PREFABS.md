# Prefabs verticais

Família **VERTICAL** do kit (`game-data/world/kitVertical.ts`), listada no editor de mapa. Prefabs são partes
compartilhadas: mudar um prefab muda todas as instâncias; o mapa guarda só placement (posição, rotação, escala,
elevação). Overrides válidos por instância: `scale` dentro da faixa do prefab e `lift`.

| Pedido | Prefab / dado | Notas |
|---|---|---|
| `VERTICAL_CLIFF` / `CLIMBABLE_ROCK` | `paredao-escalada-4`, `-38`, `-36` | quartzito com agarras; `traversal: 'climb'`; face 0,25 m à frente da massa e topo 5 cm acima |
| `LEDGE` | `beirada-pedra` | lábio de rocha de 3 m para pendurar |
| `FLOATING_ISLAND` | `ilha-flutuante-g/m/p`; construções `ilha-do-sino`, `ilha-do-oratorio`, `ilha-da-torre` | topo caminhável na base: `lift` = altura do chão da ilha |
| `WIND_UPDRAFT` / `WIND_DIRECTIONAL` | `winds` do mapa (não é prefab) | aba Ventos do editor |
| `SUSPENDED_BRIDGE` | `ponte-tabuas` (existente, 7 m) | reaproveitada |
| `TRAVERSAL_PLATFORM` | `plataforma-pedra` | pedra flutuante de 1,8 m, escala 0,8–1,4 |
| `GRAPPLE_ANCHOR` | `ancora-gancho` (e `anchor: true` em qualquer parte) | alvo da Linha de Varal |
| `VERTICAL_LOOT_POINT` | `chestSpots` com `surface: 'prop'` + `height`, região **Alturas** (sorteio com vantagem) | aba Baús do editor (campo região) |
| `VERTICAL_OBJECTIVE` | `sineira` (parte `bell`) | sino que acorda ventos ([ilhas](FLOATING_ISLANDS.md)) |
| `BotTraversalLink` | `traversalLinks` do mapa (não é prefab) | aba Waypoints: Alt+clique liga dois waypoints; tipo, vento e risco no painel ([bots](VERTICAL_BOT_NAVIGATION.md)) |
| — | `cruzeiro-serra`, `capelinha`, `arvore-ilha`, `ruina-mureta`, `ruina-pilar`, `rampa-trilha-13/9/7`, `macico-mirante-*`, `crista-mirante` | apoio |
| — | construção `serra-do-mirante` | o maciço com as três rotas |

## Tags de travessia

`KitPrefab.traversal` (padrão do prefab) e `KitPart.traversal` (por parte) com `'ledge' | 'climb' | 'none'`; sem
tag, toda parte sólida é `ledge` e grades/cercas (`solid: 'move'`) são `none`. O editor mostra a tag nos colisores
(tecla C): laranja agarrável, roxo escalável, cinza sem agarre, ciano grade.

## Regras de autoria (aprendidas na Serra)

1. Uma face escalável precisa ficar à frente de qualquer decoração da massa atrás dela (a sonda acerta a primeira
   superfície) e o topo dela precisa ser a primeira coisa sob a borda.
2. Construções largas são planas no plano tangente: nas bordas o chão fica d²/2R abaixo — leve rampas e pedras até
   o chão.
3. Destinos de mantle precisam de 0,55 m livres além da borda (nada de pedra decorativa colada ao topo de um
   paredão).
4. Colisores simples: caixas, cilindros, cones e cascos convexos pequenos (`shape: 'hull'`). Nenhum trimesh novo.
5. Pontos (waypoints, pousos, destinos de teste) saem do apoio real sob o ponto do referencial — um ponto a 10 m do
   centro de um referencial flutua 0,5 m; abaixo de uma ilha, o chão é o terreno, não o topo da ilha.
6. Rocha sem polígono à toa: uma caixa com `relief` é desenhada quebrada em facetas (até `relief` m para fora e o
   dobro para dentro do colisor, topo plano; no máximo 0,1 m) e `bands` a pinta em estratos — só visual, o colisor
   continua a caixa, então serve para massas que as rotas usam. Uma rocha de forma livre (matacão, ponta de ilha,
   lâmina de crista) é um `hull`: o cliente desenha o casco dos mesmos pontos de que o `layout` faz o colisor, então o
   que se vê é o que bloqueia. Peças que a câmera pode ter entre ela e o jogador (a crista atrás do terraço) ficam em
   prefab próprio, para dissolver sozinhas.

## Ligações de travessia no editor

Na aba Waypoints (3): Alt+clique noutro waypoint cria (ou apaga) uma ligação do selecionado até ele — seta laranja
escalada, ciano corrente, verde planagem, amarela salto. O painel do waypoint lista as que saem dele com tipo, vento
(correntes: as ascendentes do mapa, marcando as de sino) e risco, e "Testar rota" monta o grafo dos bots sobre o mapa
editado (todas as ligações permitidas) e desenha o caminho até outro waypoint, dizendo quais ligações usou. Apagar ou
renomear um waypoint atualiza as ligações.

## Persistência e compatibilidade

Mapa `mapVersion/geometryVersion/collisionVersion` 7. `winds` e `traversalLinks` são opcionais (mapas antigos carregam
sem ventos e sem ligações: os bots só caminham); `validateMap` confere ventos, gatilhos e ligações (waypoints
existentes, tipo, vento das correntes, risco e custo); `serializeMap` grava `"winds"` e, havendo, `"traversalLinks"`. Prefabs e mapa entram no `MAP_HASH`: um
Graao Host com o mapa antigo é recusado com `MAP_MISMATCH` (correto: as colisões mudaram).
