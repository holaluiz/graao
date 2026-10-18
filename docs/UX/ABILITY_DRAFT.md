# Ability Draft — experiência implementada

O draft prepara a combinação de habilidades da partida existente. O host inicia a partida com a sala pronta; os participantes entram juntos no draft, antes da preparação e do combate. O servidor define participantes, rodadas, tempo, prioridade, validação e habilidades finais.

## Estrutura e tempo

São quatro rodadas simultâneas, nesta ordem:

| Rodada | Tipo | Tecla durante a partida |
| --- | --- | --- |
| 1 | Primeira habilidade básica | 1 |
| 2 | Segunda habilidade básica | 2 |
| 3 | Terceira habilidade básica | 3 |
| 4 | Habilidade suprema | 4 |

Cada rodada oferece **45 segundos** para inspecionar e confirmar. A rodada pode terminar antes quando todos os participantes confirmam. Um conflito de prioridade abre uma janela de **20 segundos** para os jogadores que precisam escolher novamente. A revelação dura **1,6 segundo**, seguida da próxima rodada. Esses valores são os padrões de `DRAFT_RULES`; testes e opções internas de sala podem fornecer tempos específicos.

O cronômetro usa `endsAt` e o relógio do servidor. Nos últimos cinco segundos de uma escolha ainda aberta, ele recebe destaque de urgência e os sinais sonoros existentes do jogo. Confirmar cedo permite avançar sem consumir o limite completo.

## Selecionar e confirmar

1. O jogador inspeciona uma carta com o mouse ou foco do teclado. Os detalhes permanecem em um painel próprio, sem depender de tooltip.
2. Clicar na carta, ou usar a tecla numérica correspondente, seleciona uma **prévia local**. Esse gesto ainda não envia `DRAFT_PICK`.
3. A prévia aparece no slot atual da combinação e a carta recebe o estado “Selecionada”.
4. **CONFIRMAR ESCOLHA** envia a seleção ao servidor. Enquanto o envio é aguardado, a ação fica indisponível.
5. Quando o servidor confirma a escolha, a interface mostra “Confirmada” e permite **ALTERAR SELEÇÃO** enquanto a mesma rodada continua aberta para aquele jogador.

Alterar reabre a seleção local. A escolha anterior continua sendo a escolha conhecida pelo servidor até a nova confirmação; uma rodada que já foi resolvida não pode ser alterada. O servidor valida novamente cada envio. A escolha confirmada pode disputar uma habilidade quando a rodada exige propriedade exclusiva.

O teclado numérico seleciona uma carta do catálogo da rodada: 1–8 nas básicas e 1–3 nas supremas. Essa numeração do catálogo não muda o mapeamento final dos quatro slots de combate.

## Combinação e informações

“Sua combinação” mantém quatro slots visíveis durante todo o draft. Cada slot mostra seu tipo, tecla de combate, habilidade quando existente e estado de prévia, confirmação ou espera. O slot da rodada atual recebe destaque. O progresso `n / 4 escolhidas` inclui uma prévia local existente no slot atual; o texto de estado distingue essa prévia das habilidades já confirmadas.

As cartas mostram ícone, nome, categoria, descrição curta, mana e recarga. O painel persistente apresenta descrição, alcance ou aplicação em si mesmo, efeitos numéricos, raio, lentidão, recuperação, movimento e pulsos conforme a definição real da habilidade. Focar uma carta indisponível ainda permite ler seus efeitos.

O catálogo vem do estado do servidor e das definições de `@graao/game-data`. O redesign utiliza os ícones SVG, cores e sinais sonoros existentes. Não adiciona habilidades ou regras de combate.

## Catálogo e propriedade

O catálogo atual contém **8 habilidades básicas e 3 supremas**. A regra de exclusividade é calculada separadamente para cada tipo, conforme o catálogo consegue atender todos os participantes:

- Básicas exclusivas quando `8 >= participantes × 3`: até dois participantes.
- Supremas exclusivas quando `3 >= participantes`: até três participantes.
- Quando o catálogo não comporta escolhas exclusivas, jogadores diferentes podem receber a mesma habilidade. Uma habilidade continua proibida duas vezes na combinação do mesmo jogador.

Portanto, em uma sala de **10 participantes**, ambos os tipos permitem repetição entre jogadores. Isso preserva o catálogo existente e garante três básicas distintas e uma suprema por participante. A interface verifica as próprias habilidades diretamente na combinação do jogador, inclusive quando outro participante possui a mesma habilidade no mapa público de donos.

Quando há exclusividade, a primeira prioridade é sorteada pelo servidor e a ordem gira a cada rodada. Se vários jogadores confirmam a mesma habilidade, quem tem prioridade fica com ela e os outros escolhem novamente entre opções válidas. O estado de conflito informa quem ficou com a habilidade. Cartas tomadas ou já escolhidas não podem ser selecionadas novamente, mas continuam disponíveis para inspeção.

## Participantes e privacidade

A faixa inferior comporta até dez participantes. Cada participante mostra nome, identificação do próprio jogador, status “Escolhendo” ou “Confirmou” e os quatro slots públicos. A contagem informa quantos já confirmaram ou tiveram a habilidade resolvida na rodada.

Uma escolha pendente de outro jogador aparece somente como espera ou confirmação. A interface não deduz nem exibe a habilidade secreta. Somente escolhas públicas já atribuídas pelo servidor aparecem como ícones nos slots dos demais jogadores. Durante revelação e conclusão, os textos da faixa acompanham o estágio recebido.

## Quando o tempo acaba

- **Há uma prévia local válida:** o cliente tenta confirmá-la uma única vez quando faltam até 200 ms no relógio do servidor. A interface explica a confirmação automática. O envio continua sujeito ao recebimento e à validação pelo servidor.
- **Já há uma escolha confirmada:** ela continua valendo. O cliente não repete o mesmo envio automático.
- **Não há seleção válida recebida:** o servidor escolhe uma opção válida automaticamente para quem ainda precisa de habilidade. A revelação identifica essa escolha por tempo esgotado.
- **Uma disputa exige nova escolha:** o servidor fornece o estado de repescagem e a nova janela; uma escolha da janela anterior não é reaproveitada silenciosamente.

O cliente nunca substitui as habilidades finais por conta própria. Se a aba ficar suspensa, a comunicação atrasar ou o prazo vencer antes do envio, a resolução de tempo do servidor continua conduzindo o draft.

## Layout e integração

`apps/client/src/ui/DraftScreen.ts` constrói uma tela DOM/CSS/SVG com cabeçalho, combinação pessoal, catálogo, detalhes e faixa de participantes. `apps/client/src/styles/draft.css` organiza essas áreas em uma única tela, com modos compactos conforme largura e altura, sem contêineres de rolagem. As resoluções principais de revisão são 1366×768, 1440×900 e 1920×1080.

A API de integração foi preservada: `show(on)`, `visible`, `setState(state, me, names)` e `update(serverNow)`. O envio usa o `DRAFT_PICK` existente; a recepção continua usando `DRAFT_STATE` por jogador. O servidor continua responsável por `pick`, `reveal` e `done`, e o jogo prossegue com os loadouts atribuídos por ele.

## Verificação

- `packages/game-core/src/draft.test.ts`: quatro rodadas, prioridade, conflitos, rejeições, escolhas por tempo, remoção de participante e os padrões 45/20/1,6.
- `apps/client/src/ui/DraftScreen.test.ts`: disponibilidade, propriedade compartilhada em dez participantes, proibição de repetição na própria combinação, confirmação de prévia perto do prazo e proteção contra reenvio ou escolha inválida.
- `tests/multiplayer.test.ts`: integração existente de clientes e servidor, incluindo escolhas ocultas, draft e loadouts finais.

Comando da suíte completa: `pnpm exec vitest run --configLoader native --pool threads --silent`.
