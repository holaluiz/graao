# Ability v2 — servidor e rede

Coleta final de 19/10/2026, após as correções de cancelamento de áreas, volume da nuvem e rastros. Evidência bruta: [ability-v2-network-2026-10-19.json](./ability-v2-network-2026-10-19.json). Harness: [ability-metrics.ts](../../../../tools/profiling/ability-metrics.ts).

## Reprodução

```sh
pnpm exec tsx tools/profiling/ability-metrics.ts --seconds 12 --out docs/gameplay/perf/ability-v2-network-2026-10-19.json
```

O comando cria e encerra seu próprio servidor Colyseus no loopback. Não carrega `.env`; autenticação e persistência usam provedores locais sem acesso externo. Não depende de Supabase ou R2. O processo de desenvolvimento aberto pelo usuário não é usado nem encerrado.

A sala passou por lobby, READY dos dois clientes, START_MATCH do host, quatro rodadas de draft de 100 ms, PREPARATION e PREPARED de ambos, até MATCH. Capacidade: dez participantes, com **dois clientes SDK independentes e oito bots**. UFO, contagem inicial, Tormenta e creeps foram desligados por opções de desenvolvimento. Os dois humanos ficaram parados e enviaram seis intenções de habilidade pelos mesmos endpoints usados pelo jogo. Os bots mantiveram sua IA e validação normais.

## Amostra de rede e servidor

Janela de **12,019 s**, iniciada após a preparação. Dez builds válidos, com três básicas, uma Suprema e no máximo uma passiva. A sala permaneceu em MATCH até o fim da janela.

| Medida | Resultado |
|---|---:|
| Snapshots recebidos por cliente | 189 |
| Payload de snapshot, média / p95 / máximo | 773,69 / 782 / 786 bytes JSON |
| Snapshots, por cliente | 11,881 KiB/s JSON |
| Mensagens EVENTS por cliente | 94 |
| Eventos, por cliente | 1,687 KiB/s JSON |
| Total recebido, cliente A / B | 22,819 / 22,001 KiB/s JSON |
| PONG: média / p95 / máximo do tick suavizado | 6,5748 / 9,05 / 9,63 ms |
| Maior atualização completa da sala na janela | 32,8648 ms |
| Atualização do engine de habilidades, média / p95 / máximo | 0,1727 / 0,5585 / 7,7796 ms |
| Cérebro dos bots: média das amostras suavizadas | 1,2021 ms |
| Entidades persistentes: mínimo / pico | 0 / 10 |
| Casts e áreas pendentes: mínimo / pico | 0 / 5 |
| Projéteis de habilidade simultâneos observados | 0 |

**Bytes são `Buffer.byteLength(JSON.stringify(payload))` dos payloads S2C já decodificados.** Não incluem a codificação MessagePack, framing WebSocket, cabeçalhos TCP/TLS ou retransmissões; portanto, não representam tráfego real no fio. O total inclui mensagens normais da sala, como SELF e WORLD_STATE, e não apenas habilidades. A coleta exclui entrada, carregamento, draft e primeiro estado de mundo.

O valor de tick recebido por PONG é uma média móvel exponencial do servidor. Seus percentis descrevem essa média suavizada. O pico de 32,8648 ms vem do contador real de custo da atualização da sala. O harness cronometra separadamente cada `GRAAbilitySystem.update` da instância local e consulta seus contadores; a instrumentação adiciona algum custo.

## Efeitos e privacidade observados

Cinco intenções humanas foram aceitas: Vaga-Lume Explorador, Casulo de Folhas, Seiva Pegajosa, Meteoro Solar e Farol dos Vaga-Lumes. O Muro de Papel solicitado na direção inicial do personagem foi recusado como `BAD_TARGET`; o harness mantém a recusa no relatório e não altera colisão ou validação para forçar a aceitação.

Os bots efetuaram **18 casts aceitos de 15 IDs diferentes**, por sete dos oito bots dentro da janela. Um bot não teve cast aceito nesse intervalo curto. Todos usaram os próprios slots; nenhum cast de passiva apareceu. A contagem por habilidade e por bot está no JSON.

O cliente A recebeu um reveal de recursos; o cliente B recebeu cinco reveals de direção do farol. Todos os seis reveals recebidos tinham o próprio cliente como `by`, sem envio desses reveals ao outro cliente. Isso verifica o roteamento observado nesta amostra; os testes funcionais cobrem as demais modalidades de informação.

## Dez Supremos simultâneos no engine

Um microbenchmark separado solicitou **cada um dos dez Supremos em um ator diferente no mesmo instante simulado**. As dez solicitações passaram pela admissão do engine e foram aceitas. Executaram-se 900 passos de 1/60 s, equivalentes a quinze segundos simulados.

Usa Rapier real, terreno de teste plano e colliders reais das coberturas. Não usa mapa de produção, CharacterMotor, IA, SDK ou renderer. O estado de voo é criado, mas não integrado por um motor de personagem nesse microbenchmark.

| Medida | Resultado |
|---|---:|
| Admissão das dez solicitações, em lote | 1,2670 ms |
| Engine de habilidades, média / p95 / máximo | 0,0160 / 0,0544 / 1,4253 ms |
| Engine + passo Rapier, média / p95 / máximo | 0,0302 / 0,0760 / 1,6913 ms |
| Pico de entidades persistentes | 12 |
| Pico de casts e áreas pendentes | 9 |
| Eventos de gameplay produzidos | 131 |
| Reveals privados produzidos | 5 |
| Após `clear`: entidades / pendências / projéteis / colliders de habilidade | 0 / 0 / 0 / 0 |

## Limites de interpretação

- Dois clientes SDK e oito bots foram medidos; dez humanos não foram testados.
- É uma amostra curta, com uma execução final e máquina compartilhada com outras tarefas. Não estabelece capacidade de produção, estabilidade prolongada ou percentis de longa duração.
- Bot AI, agendamento e coleta de lixo podem alterar tempos e casts entre execuções. As configurações e builds efetivos estão no JSON.
- FPS, tempo de frame GPU, draw calls, VFX e partículas exigem a coleta de navegador. Nenhum desses valores pode ser inferido deste harness sem renderer.
- O teste simultâneo mede engine e física simplificados; não representa dez Supremos renderizados e replicados simultaneamente no cenário completo.
- Nenhum projétil foi observado neste conjunto de builds e ações. O valor zero não comprova orçamento de uma situação com muitos projéteis.
- O `gitHead` identifica a base da coleta; havia correções locais da entrega ainda não commitadas. O JSON é evidência da árvore de trabalho validada nessa entrega, não somente daquele commit-base.

Validação do harness: ESLint do arquivo e `tsc -p tsconfig.json --noEmit` passaram. Não altera arquivos de produção nem realiza operações Git.
