# Autoridade das habilidades

O cliente envia intenções. `GraaoMatchRoom` valida identidade, sequência e fase; `GRAAbilitySystem` valida e executa os dados de `@graao/game-data`. Mana, cooldowns, estados, dano, cura, proteção, colisões, reconhecimento e teleporte pertencem ao servidor.

Colyseus dedicado e sala hospedada no navegador usam a mesma implementação: `HostRoomDriver` executa `GraaoMatchRoom` no worker. Não é necessário Supabase, R2 ou outro serviço de persistência para executar as regras localmente.

## Pedido e confirmação

`ABILITY_REQUEST` preserva o formato compacto `{s,k,a,c,d?,p?}`: sequência, slot zero-based, ID esperado, sequência de movimento, direção ×10000 e ponto em milímetros. O servidor não aceita posição ou estado derivados do cliente como consequência pronta.

Admissão: jogador existente e vivo; sequência nova; slot pertencente ao loadout; fase compatível; habilidade ativa; ausência de bloqueio; cooldown; Mana; tipo de alvo; alcance; superfície e linha de visão; condições específicas de movimento/colocação. Direções e pontos têm forma, limites e números inteiros validados antes da conversão.

`ABILITY_RESULT` responde com a sequência, slot e motivo. `SELF` traz os valores autoritativos. Passivas são rejeitadas na ativação manual. Banho de Chuva e Roda de Confetes podem remover silêncio durante sua vigência; essa exceção não ignora Mana, cooldown nem outros bloqueios.

O cliente prevê somente apresentação e movimento compartilhado seguro, faz rollback quando recusado e correlaciona os eventos por sequência. O dash inicia no comando anunciado quando plausível; comandos fora da janela são alinhados ao próximo comando simulado. Dano e revelações não são previstos pelo cliente.

## Estado público e privado

| Canal | Destinatário | Conteúdo |
|---|---|---|
| `ROOM_STATE` | Sala | Builds públicas depois das revelações, roster e fase |
| `SELF` | Proprietário | Mana, cooldowns, conjuração, estados, proteção temporária e modificadores próprios |
| `EVENTS` | Sala | Casts, projéteis, impactos e criação/alteração/remoção de entidades visíveis |
| `ABILITY_STATE` | Cliente entrando/reconectando | Snapshot das entidades persistentes atuais |
| `ABILITY_REVEAL` | Somente conjurador | Resultado autorizado e com expiração de reconhecimento |

Uma entidade pública contém identidade, habilidade, proprietário, tipo, posição, tamanho/direção quando aplicável, expiração e resistência pública. Não contém escolhas secretas, cooldowns adversários, conteúdo de baú fechado nem histórico de deslocamento.

Reconhecimento é separado do broadcast: Orbe revela o alvo atingido por até quatro segundos; Vaga-Lume consulta baús fechados/pickups reais; Eco consulta amostras autoritativas recentes; Olho e Farol enviam direções aproximadas em setores de 30°, sem coordenadas exatas. Mensagens de direção não têm campos de posição ou ID do adversário. O histórico de rastros fica no servidor, limitado a oito segundos; só um resultado autorizado é enviado.

## Física e combate

O mundo estático é compartilhado por salas. Barreiras usam `Group.BARRIER`, handles próprios e predicados da sala em raycasts/overlaps; `CharacterMotor.barrierFilter` impede colisão com estruturas de outras partidas. Adicionar uma parede como prop estático global viola esse isolamento.

Paredes possuem resistência, prazo e colisão real. Hitscan e projéteis consultam o mesmo mundo da sala; dano em cobertura é tratado pelo sistema que a criou. Nuvem possui volume opaco autoritativo e obstrui consultas de visibilidade, sem virar terreno ou âncora válida. Portais validam os dois extremos, volume livre e distância de superfície; somente o proprietário atravessa, com orientação transportada pela esfera e intervalo entre travessias.

Casulo absorve dano em ordem temporário → normal → Vida. Tormenta e água continuam removendo Vida diretamente. Guarda-Chuva valida o setor frontal no servidor e bloqueia o disparo do portador. Passivas de arma modificam a dispersão/equipamento reais; Catador modifica distância e aproveitamento de coleta antes da transação existente.

## Ciclo de vida e reconexão

Morte/saída cancela conjurações, estados, áreas e entidades do proprietário e remove rastros/reconhecimento transitório. Reinício limpa o sistema; descarte de sala precisa liberar também os colliders temporários do mundo compartilhado. Projéteis já lançados seguem sua própria vida limitada até serem limpos ou finalizados pelo sistema.

A reconexão preserva o ator e troca seu destino privado para a nova conexão. O servidor reenvia `SELF`, `ROOM_STATE`, loot e snapshot público das entidades. O snapshot de habilidades descreve entidades persistentes; não é um replay histórico de todos os casts/projéteis.

Durante carregamento, os deltas de criação/remoção precisam atualizar o cache de entidades mesmo antes da apresentação ficar ativa, para não restaurar um snapshot inicial já obsoleto. Revelações recebidas nesse intervalo só podem ser reapresentadas enquanto não expiradas. Não reproduzir impactos antigos nem prolongar informação privada por reconexão. Casts/projéteis em andamento exigem cobertura específica de sincronização se forem incluídos em futuras versões do snapshot.

O protocolo usa versão compartilhada e rejeita clientes incompatíveis no join. Códigos de rejeição anteriores permanecem estáveis; novos motivos foram acrescentados. Posições e direções são quantizadas; não replicar partículas individuais.

## Verificação e medição

As suítes `abilities-v2.multiplayer.test.ts`, `multiplayer.test.ts`, `hostRoom.test.ts`, `abilitySystem.v2.test.ts` e `abilityPhysics.test.ts` exercitam os caminhos compartilhados. Houve validação por SDK independente com 1 humano + 9 bots e 2 humanos + 8 bots; isso não representa teste com dez humanos nem medição de FPS do navegador.

Medir em cenários repetíveis, com qualidade gráfica, resolução e composição de sala registradas:

- Tick de servidor: custo médio/p95/p99 e pico quando vários Supremos ocorrem juntos.
- Runtime: projéteis, casts/áreas pendentes, entidades e colliders por sala e por conjurador; retorno ao baseline após morte/reset/descarte.
- Rede: bytes de snapshot, eventos e revelações por segundo, mensagens por canal e maior pacote; comparar idle, combate e dez participantes.
- Cliente: FPS, frame time p50/p95/p99, draw calls, VFX/partículas e memória antes/depois do pico e da limpeza.
- Qualidade de sincronização: correção de posição após dash/portal, eventos duplicados e estado após reconexão durante conjuração/área.

Os limites de runtime ficam em `ABILITY_RULES`. Registrar números observados, ferramenta e cenário; aprovação de testes lógicos não substitui medição de frame time ou tráfego.
