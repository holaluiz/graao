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
| `VERTICAL_LOOT_POINT` | `chestSpots` com `surface: 'prop'` + `height` | aba Baús do editor |
| `VERTICAL_OBJECTIVE` | `sineira` (parte `bell`) | sino que acorda ventos ([ilhas](FLOATING_ISLANDS.md)) |
| — | `cruzeiro-serra`, `capelinha`, `arvore-ilha`, `ruina-mureta`, `ruina-pilar`, `rampa-trilha-13/9/7`, `macico-mirante-*` | apoio |
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
4. Colisores simples: caixas, cilindros, cones. Nenhum trimesh novo.

## Persistência e compatibilidade

Mapa `mapVersion/geometryVersion/collisionVersion` 5. `winds` é opcional (mapas antigos carregam sem ventos);
`validateMap` confere ventos e gatilhos; `serializeMap` grava `"winds"`. Prefabs e mapa entram no `MAP_HASH`: um
Graao Host com o mapa antigo é recusado com `MAP_MISMATCH` (correto: as colisões mudaram).
