# Controles e conforto

As configurações agora separam Vídeo, Áudio, Controles e Teclas, sem rolagem. As 18 ações de jogo podem ser remapeadas. TAB (placar), ESC (opções), setas do espectador e teclas reservadas permanecem fixas. A captura rejeita conflitos, ESC cancela somente a captura e Restaurar teclas recupera os padrões.

Volume geral, efeitos e ambiente possuem controles independentes. Efeitos inclui armas, magias, interface e ações na água. Ambiente inclui vento, mar e sons contínuos. A intensidade do tremor pode ser desligada sem modificar recuo, mira ou regras de combate.

Preferências são normalizadas ao carregar dados locais ou do perfil. Perfis antigos recebem os valores padrão para os novos campos; mudanças realizadas durante o carregamento não são sobrescritas por uma resposta antiga da nuvem. Atalhos e dicas do HUD acompanham as escolhas atuais.

## Validação

- 74 testes focados: input/atalhos, migração de preferências, mixagem e câmera.
- Typecheck do cliente e build completos aprovados.
- Navegador: conflito Pular/R rejeitado, ESC preservou o diálogo, Pular/J funcionou em treino (subida observada >1 m), Arma 1/T apareceu no HUD.
- Preferências salvas no perfil e recuperadas após recarregar; padrões restaurados ao terminar o teste.
- Layout sem controles fora da tela em 1366×768, 390×844 e 844×390. Teclas paginam seis ações, ou três em telas baixas.
- Capturas e medições em `screenshots/settings-*.png` e `settings-comfort-checks.json`.
