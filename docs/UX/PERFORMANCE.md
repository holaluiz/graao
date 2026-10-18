# Medição da preparação de partidas

## Comparação real no servidor local

Medição em **18/10/2026, 02:16 (America/Sao_Paulo)**, servidor local `127.0.0.1:2567`, versão 0.9.0, protocolo 9, cliente de teste Node v24.14.0. Dados completos: [prematch-benchmark.json](prematch-benchmark.json).

O mesmo servidor executou duas salas privadas, uma após a outra. Cada sala teve 1 segundo de aquecimento e uma janela solicitada de 8 segundos. Não foram enviados Pronto, Iniciar, inputs de movimento humano, disparos ou autenticação. As salas foram encerradas após a coleta; nenhuma partida foi persistida.

**Antes** reproduz a política anterior com `legacyWarmup: true`: 1 humano e 9 bots instanciados em `FREE_ROAM`, com movimento/simulação e snapshots. **Depois** usa o padrão competitivo: 1 humano e 9 bots previstos no `LOBBY`, sem instanciar os bots e sem simulação do mapa.

| Medida observada | Aquecimento anterior preservado | Lobby competitivo |
| --- | ---: | ---: |
| Janela efetiva | 8.014,87 ms | 8.003,59 ms |
| Humanos reais | 1 | 1 |
| Bots instanciados | 9 | 0 |
| Bots previstos | 9 | 9 |
| Entradas reais no elenco | 10 | 1 |
| Snapshots recebidos | 127 | 0 |
| Payload de snapshots, UTF-8 JSON | 100.577 bytes | 0 bytes |
| Snapshots por segundo | 15,85 | 0 |
| Payload de snapshots por segundo | 12,255 KiB/s | 0 KiB/s |
| Mensagens de eventos recebidas | 0 | 0 |
| Payload de eventos | 0 bytes | 0 bytes |
| `PONG.tick`, média das amostras | 4,3673 ms | 0,0094 ms |
| `PONG.tick`, percentil 95 das amostras | 5,76 ms | 0,01 ms |
| `PONG.tick`, maior amostra | 5,93 ms | 0,01 ms |
| Amostras de `PONG.tick` | 15 | 16 |
| Todas as mensagens recebidas na janela | 142 | 16 |
| Todos os payloads recebidos, UTF-8 JSON | 101.310 bytes | 781 bytes |

Nesta amostra, o lobby eliminou o tráfego periódico de snapshots antes do início. As 16 mensagens restantes do lobby foram respostas PONG às sondagens de medição. A ausência de eventos nos dois modos corresponde ao teste em espera: a política anterior mantinha os bots se movimentando, mas o benchmark não iniciou uma partida competitiva.

## Como reproduzir

Com o servidor local de desenvolvimento em execução:

```powershell
pnpm exec tsx tools/networking/prematch-benchmark.ts --url ws://127.0.0.1:2567 --seconds 8 --output docs/UX/prematch-benchmark.json
```

O script verifica que o modo anterior realmente recebeu `FREE_ROAM` e o modo novo recebeu `LOBBY`. Em produção, `legacyWarmup` é ignorado; nesse caso o script falha explicitamente e não publica uma comparação inválida.

O cliente conta o tamanho UTF-8 de `JSON.stringify(payload)` **depois da decodificação** das mensagens S2C. Os totais servem para comparar os payloads da aplicação; não representam os bytes exatos de MessagePack, WebSocket, TCP ou TLS. O aquecimento e a primeira rajada de WELCOME/SELF/ROOM_STATE/LOOT_STATE ficam fora da janela.

`PONG.tick` é a média móvel de custo de CPU **do tick daquela sala**, calculada pelo servidor e reportada pelo PONG existente, arredondada a 0,01 ms. A tabela agrega essas amostras; não mede consumo total do processo, memória, tempo de GPU ou taxa de frames.

## Limitações e métricas de cliente

Esta é uma comparação controlada entre duas políticas do build atual, usando a implementação de aquecimento preservada como baseline. Não é uma captura de um commit antigo nem um teste de carga de produção. Foi feita uma janela por modo, em sequência, com a carga e o escalonamento da máquina local; não permite prometer o mesmo custo em outro hardware. O intervalo nominal do servidor é 20 Hz, mas a taxa real observada de snapshots do aquecimento foi 15,85/s nesta execução.

Este script não abre navegador. As métricas de renderização abaixo foram capturadas separadamente em uma sessão real; não foram inferidas das medições de rede ou do servidor.

Os testes `tests/prematch.multiplayer.test.ts` complementam a medição: tentativas de movimento e disparo no lobby não produzem snapshots nem eventos, os bots só viram participantes reais no Draft, e nenhum combate começa antes de preparação, OVNI e pouso.

## Mundo atrás das telas de preparação

Dados: [prematch-render-benchmark.json](prematch-render-benchmark.json). O mundo atrás dos menus já era só decorativo (nenhum bot, nenhuma IA, nenhum combate), mas era redesenhado a cada quadro, inclusive atrás do Draft, que cobre a tela com um fundo quase opaco e desfoque. Agora `GraaoApp` redesenha o mundo no máximo **4 vezes por segundo** atrás do Draft e da preparação, e **30 vezes por segundo** atrás da lista de salas e do lobby. Menu e personalização continuam no ritmo cheio, porque o personagem é o assunto dessas telas. Redimensionar a janela força um redesenho imediato.

Medição em 18/10/2026: RX 570, canvas 1366 × 768, DPR 1, qualidade HIGH, build de desenvolvimento (cliente sem HMR). O painel do navegador sem foco entregava cerca de 1,5 `requestAnimationFrame` por segundo, então o laço foi pausado e cada tela recebeu 20 quadros de aquecimento e 120 quadros sintéticos a 60 Hz via `app.frame(t)`. O tempo de GPU de cada desenho do mundo veio de `EXT_disjoint_timer_query_webgl2`; `app.coverThrottle` liga e desliga a regra.

| Tela | Mundo desenhado/s (antes → depois) | GPU ms por segundo | CPU ms por quadro |
|---|---:|---:|---:|
| Menu | 60 → 60 | 263 → 275 | 8,2 → 8,0 |
| Salas disponíveis | 60 → 30 | 272 → 135 | 10,4 → 4,0 |
| Lobby | 60 → 30 | 305 → 183 | 9,1 → 5,4 |
| Draft | 60 → 4 | 259 → 25 | 6,8 → 0,8 |

Cada desenho do mundo tem 134 draw calls nessas telas. Limites: uma execução numa máquina; o custo do compositor para o desfoque do Draft não está incluído; CPU é só JavaScript. O F3 mostra “mundo desenhado/s”.

## Renderizador no navegador

Dados brutos: [renderer-benchmark.json](renderer-benchmark.json). Uma aba do navegador integrado, 1366 × 768, qualidade HIGH, 120 frames consecutivos por modo, no mesmo carregamento. Leitura de `GraaoApp.frameMs`, `renderer.info` e intervalos de `requestAnimationFrame` pelo DevTools. A aba adicional do teste multiplayer estava fechada.

| Métrica | Aquecimento legado: 2 humanos + 8 bots | Lobby novo: 1 humano + 9 bots previstos |
|---|---:|---:|
| CPU por quadro: média / p95 | 6,883 / 9,9 ms | 4,817 / 6,6 ms |
| Intervalo entre frames: média / p95 | 16,642 / 19,1 ms | 16,611 / 18,7 ms |
| Draw calls | 162 | 121 |
| Triângulos | 1.222.093 | 771.042 |
| Geometrias / texturas mantidas pelo renderizador | 78 / 16 | 78 / 16 |
| Heap JavaScript observado | 192.254.615 bytes | 145.531.905 bytes |
| Remotos apresentados | 9 | 0 |

Esta comparação mede o comportamento completo de cada tela: a câmera de jogo no aquecimento e a câmera decorativa no lobby têm enquadramentos diferentes. Portanto, a redução de draw calls não pode ser atribuída somente aos bots. Os recursos mantidos no cache são reaproveitados; as contagens iguais não representam bytes de VRAM. O heap é uma observação pontual afetada pelo coletor de lixo, sem conclusão causal sobre economia de memória. Não foi medido tempo de GPU. O intervalo de aproximadamente 16,6 ms indica que ambas as amostras acompanharam a cadência de 60 Hz.

O carregamento inicial da mesma sessão foi 3.283 ms. Outras inicializações observadas no teste tiveram 2.315 e 3.000 ms; a diferença inclui cache e carga da máquina, sem baseline histórico que permita atribuí-la ao redesign. Na jornada real com dois clientes, a preparação do anfitrião levou **469 ms**, incluindo verificação dos recursos, montagem do elenco oculto, compilação e frames de apresentação, antes do ACK ao servidor. A liberação do OVNI continuou condicionada ao ACK de ambos. Não há temporizador artificial para simular carregamento.
