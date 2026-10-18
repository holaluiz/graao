# Modo espectador após a eliminação

Durante a partida, um participante eliminado passa a acompanhar um sobrevivente. O cartão mostra nome, Vida, Escudo, eliminações e contagem de vivos. As setas ←/→ e os botões alternam jogadores em ordem estável de assento; mudanças no ranking mantêm o alvo atual. TAB continua abrindo o placar e ESC abre as opções.

A seleção considera participação, conexão, saída temporária, estado de vida, eventos de eliminação e existência de um snapshot remoto válido. Se o observado morrer ou sair, a câmera passa ao próximo sobrevivente. Humanos e bots usam o mesmo caminho de apresentação. Se ainda não houver um alvo válido, o cartão informa a espera.

A câmera acompanha a posição interpolada do remoto e permite girar com o mouse quando o ponteiro está capturado. Trocar de alvo limpa o deslocamento vertical e os efeitos da câmera anterior. O corpo local permanece no lugar da morte, com comandos neutros; observar não muda sua posição, vida ou participação. Os widgets de combate locais ficam ocultos durante a observação.

O enquadramento do sobrevivente é mantido enquanto os resultados abrem; o cartão e a navegação de espectador somem. Reviver ou sair da partida limpa a seleção e os atalhos. Mortes no aquecimento continuam usando o respawn existente.

Fontes: `SpectatorDirector.ts`, `SpectatorSelection.ts`, `Spectator.ts`, `spectator.css`, `Input.ts`, `GraaoThirdPersonCamera.ts`, `RemotePlayer.ts` e `NetSession.ts`.

## Verificação local — 18/10/2026

Uma fixture isolada do servidor Colyseus recebeu três clientes SDK e um cliente no navegador. Dano e eliminações controlados no servidor atravessaram os eventos, snapshots e estados normais da sala.

- A eliminação do cliente visual abriu o modo espectador, seguindo Lia com 1 eliminação e 3/4 vivos.
- Dano de 125 em Téo foi apresentado como Vida 75 e Escudo 0.
- Setas e botões trocaram os alvos; TAB mostrou os quatro jogadores; ESC abriu opções e permitiu retornar à observação.
- Eliminar o observado selecionou o próximo; os resultados encerraram o cartão. Uma segunda partida restaurou vida, câmera e controles locais antes de uma nova eliminação.
- A saída do observado na segunda partida selecionou o próximo sobrevivente sem encerrar a observação.
- A posição do cadáver permaneceu junto à posição local, separada do foco remoto. Nenhum erro foi registrado no console durante o fluxo.
- Em 1366 × 768 e 390 × 844, os botões ficaram dentro da tela, sem rolagem. Medidas em [spectator-checks.json](spectator-checks.json).

Os 46 testes focados de seleção, integração da câmera, controles e reinicialização da câmera passaram. Typecheck do cliente, ESLint focado e build de cliente/servidor passaram; permanece o aviso existente de chunks grandes. Esta execução validou o fluxo local com quatro clientes; conexão entre redes físicas diferentes continua fora desta evidência.

Capturas: [desktop](screenshots/spectator-1366.png), [celular](screenshots/spectator-mobile-390.png) e [placar](screenshots/spectator-scoreboard.png).
