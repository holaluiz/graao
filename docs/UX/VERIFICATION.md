# Verificação do fluxo pré-partida

## Segunda rodada — salas hospedadas no navegador (18/10/2026, tarde)

Configuração igual ao build publicado: **sem servidor dedicado**, cliente sem HMR (`graao-client-bench`, porta 5176), Supabase Realtime do projeto graao. Três abas do navegador integrado: Luiz (host), Ana (convidada) e Bia (só olhando a lista).

| Teste | Resultado observado |
| --- | --- |
| 1 · Navegador de salas | Luiz criou “Partida da Galera de Sábado à Tarde”, pública, 9 bots, hospedada na própria aba (3,7 s). Bia abriu Salas disponíveis e viu a linha em 0,3 s: “1 humano + 9 bots previstos · 10 / 10 · Aguardando · —”. Ana clicou Entrar e chegou ao lobby em 2,0 s por WebRTC. A linha da Bia mudou sozinha para “2 humanos + 8 bots previstos” 0,4 s depois do clique. |
| 3 · Bots previstos | No lobby, bots eram vagas (`BOT PREVISTO · ENTRA NO DRAFT`), sem personagem no mundo. Ao iniciar o Draft, o elenco congelou em 2 humanos + 8 bots = 10. |
| 4 · Pronto | Ana marcou e desmarcou pelo rodapé, sem ESC. O host viu “Aguardando Luiz confirmar.” e o botão Iniciar Draft desabilitado; depois do Pronto dele, “Todos prontos. Você pode iniciar o Draft.” |
| 5 · Personalização | Ana abriu Personalizar a partir do lobby, trocou a cor da parte de cima para Verde-bandeira e salvou: voltou ao lobby, o Pronto dela foi limpo e o busto dela na tela do Luiz passou a ter a roupa verde (`#1f9a52`). |
| 6 · Draft | Quatro rodadas (básicas 1–3 e Supremo) com prévia, confirmação e a faixa de participantes com avatares; os bots confirmaram sozinhos. |
| Timeout | Com a aba da Ana em segundo plano, a preparação dela travou (“1 de 2”); o prazo devolveu todos ao lobby com “O carregamento demorou demais…”, bots de volta a vagas previstas e Pronto limpo. Causa: as etapas esperavam `requestAnimationFrame`. **Corrigido**; na repetição, com a aba ainda escondida, o ACK dela chegou em cerca de 1 s. |
| 7 · Ordem da partida | Lobby → Draft (8 s) → preparação → OVNI (19 s, salto automático no fim da janela) → queda → pouso → partida → resultados (“DERROTA · Bot 1 venceu · 1:04”) → lobby. Nenhum combate antes do pouso. |
| ESC | Partida: “Opções” com “A partida continua enquanto este menu está aberto. Ninguém pausa no multiplayer.” e **Sair da partida**. |
| 8 · Host sai | Luiz saiu pelo lobby. Ana voltou à lista 0,2 s depois com “Quem criou a sala saiu: a sala fechou.”; a linha sumiu da lista da Bia, que passou ao estado vazio. |
| 9 · Desempenho | Ver [PERFORMANCE.md](PERFORMANCE.md): o mundo atrás do Draft passou de 60 para 4 desenhos/s (GPU 259 → 25 ms/s); atrás da lista e do lobby, de 60 para 30. |

Também observado e corrigido: um aviso recebido no lobby reaparecia no HUD sobre o OVNI da partida seguinte. Agora o HUD só mostra avisos durante a partida.

Capturas: [lista ao vivo](screenshots/room-browser-live-list.jpg), [lista vazia](screenshots/room-browser-empty-live.png), [lista indisponível](screenshots/room-browser-offline.png), [lobby 2 + 8](screenshots/lobby-hosted-2-humans-8-bots.png), [Draft rodada 1](screenshots/draft-hosted-round1-preview.png) e [Draft Supremo](screenshots/draft-hosted-round4-supremo.png). As capturas do painel saem reduzidas (o viewport de 1366 × 768 é encolhido para caber no painel).

Não verificado nesta rodada: duas máquinas ou duas redes reais, TURN, lista com mais de uma página de salas hospedadas e a personalização (que outro trabalho em paralelo estava alterando).

Verificações automatizadas desta rodada:

- `tests/multiplayer.test.ts` falhava em 36 testes no commit `916a753`: as salas passaram a começar em `LOBBY`, mas o arquivo nunca recebeu o `legacyWarmup: true` que os outros testes legados usam. Corrigido; sozinho, o arquivo passa 49/49.
- Suíte completa (30 arquivos, 277 testes): 264 passaram. Falharam 12 testes de `SpectatorDirector.test.ts`, de um modo espectador que outro trabalho estava escrevendo e ainda não tinha commitado, e o teste de suavidade de interpolação a 60 Hz, que mede tempo real e passou com o arquivo rodando sozinho.
- Novos: `roomDirectory.test.ts` (5) e o teste de anúncio da sala hospedada em `hostRoom.test.ts`.
- Typecheck (raiz, cliente e worker), ESLint dos arquivos alterados e `pnpm build` passaram.

## Primeira rodada — servidor dedicado

O teste percorreu menu → navegador público → sala real Colyseus → lobby → personalização → pronto → Draft → preparação com ACK → OVNI → salto → pouso → combate. Dois clientes do navegador integrado usaram o servidor local de desenvolvimento com protocolo 9.

## Evidências observadas

- O cliente A criou uma sala pública com nove bots desejados. O cliente B encontrou a sala na lista real e entrou: a composição mudou de 1 humano + 9 bots previstos para 2 humanos + 8 bots previstos.
- No lobby havia zero remotos 3D e zero snapshots de combate. Marcar pronto não iniciou a partida; o anfitrião precisou acionar Iniciar Draft.
- A personalização mostrou a roupa em prévia sem mudar a aparência salva. Salvar atualizou o servidor e o estado do outro cliente. Descartar outra alteração restaurou o visual salvo. Abertura e salvamento pelo menu e pelo lobby foram exercitados.
- Ambos os clientes concluíram quatro rodadas; bots confirmaram automaticamente. O limite de tempo também completou uma escolha humana sem travar o fluxo. Nenhuma build repetiu a mesma habilidade dentro de si.
- A preparação real do anfitrião registrou 469 ms. O servidor só liberou o OVNI após os dois ACKs. Foram observados nove remotos, salto manual, queda, pouso e combate posterior.
- Segurar TAB abriu o placar com dez participantes, vivos, eliminações, mortes e dano. Soltar fechou o painel. ESC abriu opções mantendo a conexão e o progresso multiplayer.
- Sair pelo anfitrião encerrou a sala; o convidado voltou ao navegador com “A sala foi encerrada pelo anfitrião”.
- Uma segunda execução abriu seis salas públicas reais com nomes longos: paginação de três/cinco linhas e passagem à segunda página foram verificadas. Todas as salas temporárias foram encerradas.

## Layout

[responsive-checks.json](responsive-checks.json) contém leituras de dimensões da página e limites dos botões em 1366 × 768, 1440 × 900 e 1920 × 1080. Menu, lobby de dez lugares, personalização com roupas, Draft e lista preenchida foram verificados. Menu, lobby, personalização e lista também receberam inspeção em 390 × 844. Nenhum controle principal medido ficou fora da janela; a página não excedeu suas dimensões. A inspeção visual complementou essas leituras, inclusive o avatar inteiro sem arma.

Capturas em [screenshots/](screenshots/): menu, lista real, lista com cinco salas, lista estreita, lobby 1+9, personalização desktop/estreita, Draft básico/suprema, configurações, OVNI e placar TAB.

## Verificações automatizadas

- Suíte completa: **24 arquivos, 219 testes passaram**.
- Após os ajustes finais: **36 testes em quatro arquivos passaram**, cobrindo loot, helpers do Draft, pré-partida e host worker.
- `pnpm typecheck`: passou para raiz, cliente e host worker.
- `pnpm build`: cliente, worker e servidor compilados. O aviso existente de chunks grandes permanece.
- `pnpm exec eslint .`: passou. Duas atribuições finais sem uso nos testes de loot foram substituídas por expressões equivalentes.
- `git diff --check`: passou.

As métricas reproduzíveis e suas limitações estão em [PERFORMANCE.md](PERFORMANCE.md). A verificação foi local; deploy público, duas redes físicas, clipes Mixamo externos e comparação com um build histórico não foram certificados por esta execução.

## Correção da prévia de calçados e da câmera

Os controles de visualização passaram para uma faixa separada, fora da área usada para enquadrar o avatar. A câmera consulta colisões sem dissolver objetos e desloca a lente em vez de mover sua posição física para dentro do cenário. Em 390 × 844, 1366 × 768, 1440 × 820 e 1920 × 1080 foram verificados zero fades ativos, câmera a aproximadamente 1 m acima da base do avatar, pés acima dos controles e ausência de botões fora da tela. Dados em [shoe-preview-checks.json](shoe-preview-checks.json); capturas [desktop](screenshots/customization-shoes-clear-1440.png) e [celular](screenshots/customization-shoes-clear-mobile.png).

## Miniaturas reais do catálogo

As ilustrações das peças foram substituídas por fotografias 3D da biblioteca usada pelo avatar. A validação visual local conferiu roupas e estampas, calçados com meias, chapéus largos, rostos, mochilas e bandeiras pelo lado de trás. Trocar Creme por Céu mudou o PNG da camisa; retornar a Creme recuperou o mesmo PNG do cache. A opção Careca mostrou o estado sem peça. O console permaneceu sem erros ou avisos durante essa verificação.

Em 1366 × 768 foram exibidas seis opções e 18 cores; em 390 × 844 e 390 × 667, três opções por página. Nenhum botão saiu da tela ou dos limites do painel de opções, e a página não excedeu o viewport. Medidas em [catalog-3d-checks.json](catalog-3d-checks.json); capturas de [roupas](screenshots/catalog-3d-tops-1366.png), [calçados](screenshots/catalog-3d-shoes-1366.png) e [celular](screenshots/catalog-3d-mobile-390.png).

Os oito testes de `CreatorThumbnails.test.ts` passaram, cobrindo todas as peças nos dois corpos, geometria independente do cache do avatar, peças autoradas e revisão da biblioteca, cores e enquadramento, cancelamento e fechamento do editor. Typecheck do cliente, ESLint dos arquivos alterados e build de cliente/servidor passaram. O aviso preexistente de chunks grandes permanece.
