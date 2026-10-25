# Validação mobile — 24/10/2026

O jogo exige orientação horizontal quando os controles de toque estão ativos. No primeiro toque tenta abrir em tela cheia e travar em paisagem; navegadores sem esse suporte mantêm o aviso para girar o aparelho manualmente.

## Alterações

- Canvas e camadas da interface acompanham a área realmente visível (`visualViewport`), inclusive barras do navegador e teclado. Safe areas protegem os controles nas bordas.
- Salas usam paginação conforme a altura disponível. Menu, criação de sala, lobby com dez participantes, personalização e configurações têm layouts compactos em paisagem.
- Ações principais dos diálogos ficam em rodapé persistente, preservando validação nativa e envio de formulários.
- Toque permite movimento e câmera simultâneos, tiro, mira, recarga, troca de arma, habilidades, placar ao segurar, salto do OVNI, mergulho e natação. Interrupções cancelam ações pressionadas.
- Personalização permite girar, aproximar com dois dedos ou botões e selecionar peças/cores mantendo salvar/descartar acessíveis.
- Instalações mobile sem preferência salva começam em qualidade baixa e 30 FPS. Preferências já salvas são respeitadas.
- Dicas de partida e espectador passam a mencionar os controles de toque.

## Verificação

- 120 testes focados passaram: Input, TouchControls, KeyBindings, AbilityController, WeaponController, Scoreboard, Creator, DraftScreen, GameSettings, Viewport e RoomBrowserLayout. Resultado bruto em [mobile-focused-2026-10-24.json](mobile-focused-2026-10-24.json).
- Typecheck completo, lint dos arquivos TypeScript alterados e build client/server passaram.
- Chromium com emulação de ponteiro de toque: menu → treino com nove bots → lobby 10/10 → quatro rodadas do Draft → OVNI → salto → mergulho → combate → espectador → retorno ao lobby.
- Prática sem bots: movimento pelo joystick, câmera por arrasto, seis disparos segurando ATIRAR, mira, recarga, troca de arma e habilidade confirmados na interface.
- Criação de sala privada por formulário e saída da sala confirmadas. Isso verifica o botão de envio movido para o rodapé.
- Em 740×280 e 844×390, medições da lista de salas não encontraram botões ou campos fora da tela nem rolagem do documento. Criação de sala, configurações, personalização e lobby foram conferidos em 740×280. Retrato 390×844 mostra o aviso obrigatório de orientação.
- Capturas em `docs/UX/screenshots/mobile-*.png`: salas, criação, configurações, personalização, lobby, Draft e orientação obrigatória. Os catálogos extensos mantêm rolagem local com a ação de confirmação visível.

## Limites

Validação feita em Chromium no computador, com toque emulado; não substitui teste em Android físico e Safari no iPhone. Bloqueio de orientação depende do navegador e do modo de tela cheia. O placar ao segurar e a posse simultânea dos ponteiros têm testes automatizados; a captura visual do placar durante o gesto não foi obtida. Não foi medido desempenho em hardware de celular.
