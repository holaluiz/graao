# Fluxo de preparação de partidas

O fluxo competitivo usa a sala do Colyseus como autoridade. A interface exibe o estado recebido e envia intenções; abrir uma tela, marcar Pronto ou terminar uma animação local não inicia a partida.

## Jornada

`Menu → Salas → Lobby → Ability Draft → Preparação → OVNI → Queda → Combate → Resultados → Lobby`

Personalização é uma tela independente, acessível pelo menu e pelo lobby. Salvar a aparência retorna à origem. No lobby, uma alteração validada pelo servidor também remove o Pronto daquele jogador; a aparência é distribuída aos outros participantes em `ROOM_STATE`.

Treinar sozinho continua separado do fluxo competitivo. A exploração local preserva o mundo, o OVNI e as armas existentes. Treino com bots usa uma sala privada e a mesma preparação autoritativa.

## Estados do servidor

| Estado | Entrada e saída | Simulação e mensagens permitidas |
| --- | --- | --- |
| `LOBBY` (0) | Criação ou retorno dos resultados; o host inicia explicitamente. | Humanos podem entrar, personalizar e alternar Pronto; só o host altera bots. Sem movimento, combate, IA ou snapshots. |
| `ABILITY_DRAFT` (1) | O host congela a composição e instancia os bots previstos. Quatro rodadas selecionam três básicas e um Supremo. | Picks validados pelo servidor, escolhas automáticas dos bots e conclusão por timeout. Sem simulação do mapa. Novos participantes são recusados. |
| `PREPARATION` (5) | Draft concluído; o servidor cria um identificador de preparação e espera os ACKs dos humanos. | Sem combate ou snapshots. Todos os clientes reais precisam carregar os recursos necessários. |
| `UFO` (2) | Todos os ACKs recebidos. | Rota e saltos autoritativos; movimento durante a queda. Ninguém causa dano ou usa habilidades. |
| `MATCH` (3) | Todos pousaram; termina a contagem regressiva. | Combate, IA, habilidades, loot e Tormenta existentes. Último participante de pé vence. |
| `RESULTS` (4) | Servidor calcula o resultado e envia `MATCH_SUMMARY`. | Sem dano. Todos pedem retorno ou termina o prazo; volta ao lobby com Pronto desmarcado. |
| `CLOSED` (6) | Host sai definitivamente. | Aviso aos clientes, encerramento da sala e retorno à navegação. |

Salas hospedadas no navegador usam a mesma classe e os mesmos estados. Quando são públicas, o host anuncia a linha da própria sala na lista ao vivo ([ROOM_BROWSER.md](ROOM_BROWSER.md)); a sala continua sendo a autoridade sobre quem entra.

`FREE_ROAM` (9) permanece apenas para a exploração local e para o opt-in de desenvolvimento/testes `legacyWarmup: true`. Salas competitivas novas iniciam em `LOBBY`. O opt-in é ignorado no servidor de produção.

## Participantes e início

- Capacidade padrão e máxima: **10 participantes**, humanos e bots somados.
- O primeiro humano é o host. A identificação usa `hostSessionId`, não o nome visível.
- No lobby, bots são vagas planejadas: `botsPlanned = min(botsDesired, capacity − humans)`.
- A entrada de outro humano reduz os bots efetivos. Nenhum bot combatente existe no lobby.
- O host pode solicitar de 0 a 9 bots enquanto a fase for `LOBBY`.
- Todos os humanos precisam estar Pronto, presentes e sem reconexão pendente. São necessários pelo menos dois participantes totais.
- Pronto não inicia automaticamente. `START_MATCH` é exclusivo do host e congela a composição antes do Draft.
- Não existe entrada tardia nas fases competitivas seguintes. Reservas de reconexão existentes são preservadas.

As combinações 1 humano + 9 bots, 2 + 8, 5 + 5 e 10 + 0 são verificadas com clientes reais. Um teste com 12 clientes disputando as nove vagas restantes confirma que apenas nove entram.

## Contratos de rede

Protocolo: **9**, cliente: **0.9.0**. As definições e validações vivem em `packages/shared/src/protocol.ts` e `validate.ts`.

| Intenção | Payload | Validação |
| --- | --- | --- |
| `READY` (1) | `{ r: 0 \| 1 }` | Somente Lobby; altera a própria preparação. |
| `APPEARANCE_UPDATE` (2) | `{ appearance }` | Aparência válida, somente Lobby. |
| `DRAFT_PICK` (3) | `{ r: round, a: abilityId }` | Somente Draft; rodada, categoria, posse e disponibilidade válidas. |
| `START_MATCH` (12) | `{}` | Host, Lobby, todos os humanos Pronto e ≥ 2 participantes. |
| `ROOM_SETTINGS` (16) | `{ bots: 0..9 }` | Host, Lobby, inteiro válido. |
| `PREPARED` (17) | `{ id, ok: boolean, error?: string }` | Somente Preparação; participante real e identificador atual. |
| `RETURN_LOBBY` (11) | `{}` | Somente Resultados. |

`ROOM_STATE` mantém o estado de combate existente e acrescenta:

```ts
room: {
  name, visibility, hostSessionId, hostName,
  humans, botsDesired, botsPlanned, capacity, protocol,
  available, canStart, startReason
}
preparation: null | {
  id, deadline,
  ready: number[],   // índices dos humanos que carregaram
  waiting: number[]  // índices ainda pendentes
}
```

O lobby mostra participantes humanos reais mais vagas de bots planejados. Os bots passam a integrar `players` quando o host inicia o Draft. `canStart` e `startReason` explicam por que o início está disponível ou bloqueado.

## Carregamento verdadeiro e recuperação

A preparação não usa uma porcentagem inventada nem um atraso para simular carregamento. O cliente confirma o identificador atual somente depois de os recursos necessários estarem disponíveis. Não deve aguardar o primeiro snapshot: snapshots começam no OVNI.

As etapas da preparação cedem a vez ao navegador com `requestAnimationFrame` **ou** uma mensagem de `MessageChannel`, o que vier primeiro. Antes, uma aba em segundo plano (alguém que trocou de janela durante o Draft) não recebia quadros, não confirmava e prendia a sala até o prazo; isso foi reproduzido no navegador e corrigido: com a aba da convidada escondida, o ACK chegou em cerca de 1 s.

O servidor espera **45 segundos**, por padrão. Um ACK de falha emite `LOAD_FAILED`; o prazo esgotado emite `LOAD_TIMEOUT`. Em ambos os casos, todos retornam ao lobby, os bots instanciados são removidos, as vagas planejadas são restauradas e Pronto é desmarcado. Um ACK antigo ou recebido na fase errada é ignorado.

Avisos da sala (`NOTICE`) aparecem como toast em qualquer tela; o HUD de combate só os mostra durante a partida. Antes, um aviso recebido no lobby ficava guardado no HUD escondido e reaparecia sobre o OVNI da partida seguinte.

## Saída do host e reconexão

A saída voluntária do host fecha a sala para todos. O servidor emite `NOTICE` com `HOST_LEFT`, anuncia `CLOSED` e desconecta os participantes. A interface retorna à navegação com uma mensagem de encerramento.

Uma queda de rede conserva a política existente: a vaga é mantida por até 20 segundos para reconexão. Se o host volta, a sessão é retomada; se o prazo acaba, sua saída definitiva encerra a sala. Não há eleição silenciosa de outro host. O host no navegador também encerra a sala ao sair ou fechar sua página.

## Draft e catálogo MVP

O catálogo tem **30 básicas (8 passivas) e 10 Supremos**, todos visíveis no tabuleiro do Draft ([ABILITY_DRAFT](ABILITY_DRAFT.md)). A exclusividade é individual: nenhuma habilidade se repete na própria build, no máximo uma passiva, e participantes diferentes podem escolher a mesma habilidade.

Bots escolhem no servidor. O prazo de cada rodada é configurável, e escolhas ausentes recebem uma opção válida quando o prazo termina. A UI mantém a build de quatro slots visível durante toda a jornada.

## Verificação e preservação

`tests/prematch.multiplayer.test.ts` exercita descoberta HTTP, ocupação, concorrência de entrada, Pronto, controle do host, congelamento do elenco, picks automáticos, ACK de todos os clientes, timeout/falha, OVNI, partida, resultados e encerramento. `tests/hostRoom.test.ts` verifica a mesma política no Web Worker do host privado.

As suítes anteriores de combate, loot, OVNI, Tormenta, reconexão e persistência mantêm o aquecimento explícito nos helpers de teste. O mundo esférico, os personagens, o rig, as animações, as armas, o loot, a Tormenta e a persistência existentes foram preservados.

Nos estados de pré-partida, o teste observa **zero snapshots e zero eventos de combate** mesmo com tentativas de movimento e disparo. O servidor mantém apenas o relógio de fases e as intenções necessárias; não executa física dos personagens, combate, loot ou IA de combate nesses estados. Métricas do renderizador devem ser consultadas no relatório de validação da interface.
