# Sound design do graao

Todos os efeitos do jogo vêm de um **banco de sons** feito de gravações CC0 em camadas com síntese. Antes de 20/10/2026
quase tudo era sintetizado na hora (osciladores e ruído no Web Audio); o sintetizador continua no
`GRAAudioManager` como reserva: toca enquanto o banco carrega e se um arquivo falhar.

- Receitas: `tools/audio/sound_design.py` (uma função por som), sobre `tools/audio/som.py` (filtros, compressor,
  limitador, reverb por convolução, ecos, síntese de sinos, marimba, kalimba e vento).
- Saída: `apps/client/public/assets/v1/audio/sfx/<nome>-<k>.mp3` (248 arquivos, 2,3 MB, MP3 VBR, 48 kHz) e
  `apps/client/src/audio/sfxBank.ts` (gerado: nome → variações e ganho).
- Cliente: `GRAAudioManager` carrega o banco em segundo plano (tiros, acertos e passos primeiro), sorteia uma variação
  sem repetir a anterior, corta o silêncio inicial do decodificador de MP3 e cai no sintetizado até o arquivo chegar.
  Portas e caixas (`WorldAudio`) usam `sampleBuffer`.
- Painel de sons: abra o jogo com `?sons` (ex.: `http://localhost:5173/?sons`). Lista todos os sons por categoria,
  tocados pelo mixer do jogo, com rajadas, passos em cadência, tiros a 25/90/160 m e a chave "Ouvir o som antigo"
  para comparar com o sintetizado.

## Regenerar

```bash
python -I tools/audio/sound_design.py
```

Só um grupo: `python -I tools/audio/sound_design.py fire.` (prefixo). Precisa de numpy, scipy e ffmpeg (com
libmp3lame) no PATH. As sementes são fixas: rodar de novo dá os mesmos sons. O script apaga da pasta o que nenhuma
receita gerou, imprime duração, sonoridade e pico de cada arquivo e avisa de possíveis estalos (picos agudos isolados;
transientes de gravação, como trincos e cascalho, também aparecem e são esperados).

As gravações ficam em `assets/audio/fontes/` (fora do git, 213 MB). Para montar de novo, baixe os pacotes abaixo e
extraia cada um numa pasta com o nome indicado (os `.7z` abrem com `py7zr`).

## Fontes (todas CC0)

| Pasta em `assets/audio/fontes/` | Pacote | Autor | Origem | Uso |
|---|---|---|---|---|
| `firearm/` | The Free Firearm Sound Library (Prepared SFX Library) | Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney | [OpenGameArt](https://opengameart.org/content/the-free-firearm-sound-library) | tiros perto e a meia distância |
| `kenney_impact-sounds/` | Impact Sounds | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) | passos, impactos de soco, vidro, metal, madeira, pedra |
| `kenney_rpg-audio/` | RPG Audio | Kenney | [kenney.nl](https://kenney.nl/assets/rpg-audio) | passos na terra, pano, couro, trincos, portas, papel |
| `kenney_sci-fi-sounds/` | Sci-fi Sounds | Kenney | [kenney.nl](https://kenney.nl/assets/sci-fi-sounds) | explosões, campo de força, motores, lasers |
| `kenney_interface-sounds/` | Interface Sounds | Kenney | [kenney.nl](https://kenney.nl/assets/interface-sounds) | cliques, confirmação, erro, risco |
| `kenney_ui-audio/`, `kenney_digital-audio/`, `kenney_music-jingles/` | UI Audio, Digital Audio, Music Jingles | Kenney | kenney.nl | baixados, ainda não usados |
| `water-splash-slime-sfx/` | 40 CC0 water / splash / slime SFX | rubberduck | [OpenGameArt](https://opengameart.org/content/40-cc0-water-splash-slime-sfx) | água, respingo, gosma (Seiva) |
| `swoshes/` | Swish – bamboo stick weapon swhoshes | qubodup | [OpenGameArt](https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes) | golpes de ar (soco, magias de vento) |

Nenhum exige crédito; o graao credita mesmo assim (esta tabela). Vozes, música e cantos de pássaro não vêm do banco:
os pássaros e os leitos de região continuam sintetizados no `WorldAudio`, e o vento e o mar são `wind.mp3`/`beach.mp3`.

## Como os sons são feitos

- **Tiros**: o disparo seco gravado perto da arma, saturado e comprimido, com um "soco" grave sintético por baixo
  (game feel), às vezes um estalo, e o ar livre: reverb curto e claro mais as reflexões dos morros (passa-faixa, para
  não repetir o grave). Cada arma tem a sua gravação: Pistola = Walther PPQ 9 mm (e um .45), Submetralhadora = Carl
  Gustav M45 e PPSh (corpo cortado em 75 ms, antes do "clack" do ferrolho, para a rajada de 11/s não embolar), Fuzil
  Kalash = AK-47, Fuzil de Precisão = Mosin-Nagant com o vale inteiro respondendo, Lança-Foguetes = baque + motor
  indo embora, Rajada de Pétalas = corpo de escopeta amaciado + revoada (golpe de ar, papel, brilho), Raio de Sol =
  "piu" de luz sintetizado com textura de laser. O tiro distante (`fire.far`) usa as gravações a meia distância,
  abafadas, com reverb longo e eco.
- **Recarga** em três tempos ajustados ao `reloadTime` da arma: pente sai (0), pente entra (50 %), ferrolho (82 %).
  Trocar de arma no meio cala os tempos pendentes.
- **Passos**: gravações por superfície (grama, terra, areia, pedra, madeira, metal = concreto + chapa), 5 a 8
  variações; o pouso toca os dois pés e o peso do corpo; na disparada, metade dos passos leva o pano da roupa.
- **Magias**: uma assinatura por família de apresentação, de gravação + síntese: Orbe (golpe de ar + "fwum" de luz
  subindo + campo de força), Escudo (campo de força + acorde de vidro em quintas), Cura (kalimba em arpejo maior),
  Meteoro (rugido de fogo subindo; a explosão é `ab.boom`), Ciclone (vento girando em volta, panorama circular), Lança
  (carga zumbindo e disparo), Seiva (gosma gravada), Pólen (sopro e poeira brilhante) etc.
- **Morte, acertos e partida**: eliminação com dois toques de kalimba subindo; morte com baque abafado, vidro fosco
  rachando e um tom caindo no escuro; vitória e derrota são temas curtos de marimba (maior subindo, menor descendo).

## Níveis

Cada arquivo sai nivelado pela sonoridade de curto prazo do seu papel (o maior RMS em 50 ms, com peso de presença;
`som.nivel`), e o limitador não pode tirar mais que 3 dB: um som de ataque forte fica abaixo do alvo em vez de ter o
transiente esmagado. Picos ≤ −1 dBFS. Alvos, calibrados pelos sons antigos que o mix já aceitava (o tiro leve antigo
tocava a −16,8 dB efetivos):

| Papel | Alvo (dB) |
|---|---|
| Tiros (próprios) | −15 a −12 (pistola −14, submetralhadora −15, fuzil −13,5, precisão −12) |
| Tiro distante | −14 (o jogo ainda atenua pela distância) |
| Acertos e dano | −16 a −12 |
| Magias | −15 a −13 (explosão −11) |
| Passos | −18 a −17 (o jogo aplica 0,5–1 pelo passo) |
| Manejo de arma | −22 a −19 |
| Interface | −20 a −17 |
| Partida (contagem, vitória) | −14 a −12 |

O ganho de cada nome no `sfxBank.ts` é 1; para mexer na mixagem de um som, mude o alvo ou o `ganho` da receita e
rode o script.

## Catálogo de eventos

| Som | Quando toca | Variações |
|---|---|---|
| `fire.pistol`, `fire.smg`, `fire.rifle`, `fire.sniper`, `fire.rocket`, `fire.petal`, `fire.sunbeam` | tiro de cada arma (o meu; o dos outros por `playShot`) | 3–5 |
| `fire.far` | tiro ouvido de longe (cruza com o tiro em 12–70 m) | 6 |
| `reload`, `reload.in`, `reload.end` | os três tempos da recarga | 2–3 |
| `empty`, `switch`, `loot.equip` | sem munição, trocar de arma, pegar arma | 2–3 |
| `hit.body`, `hit.crit`, `hit.shield`, `hit.shieldBreak`, `hit.elim` | meu acerto (hitmarker), crítico, no escudo, quebrou o escudo, eliminação | 2–4 |
| `hurt.health`, `hurt.shield`, `hurt.shieldBreak`, `death` | levei dano, no meu escudo, meu escudo quebrou, morri | 2–4 |
| `melee.swing`, `melee.hit`, `melee.wall` | soco no ar, acertou, na parede | 3–6 |
| `ab.orb` … `ab.lance` (11 famílias), `ab.impact`, `ab.area`, `ab.boom` | lançar magia; acerto, área e explosão | 2–4 |
| `ab.warn`, `ab.denied`, `ult.ready` | magia vai cair aqui, magia negada, Supremo pronto | 1–2 |
| `step.<superfície>`, `foley.cloth` | passos (andar, correr, disparada, pulo, pouso) | 5–8 |
| `countdown`, `go`, `victory`, `defeat` | contagem, valendo, fim de partida | 1 |
| `ui.click`, `ui.ready`, `ui.swap`, `draft.*`, `xp`, `levelup` | interface, Draft, progressão | 1–3 |
| `loot.*` | saque (perto, baú, recompensa, pegar, munição, usar, cheio) | 1–3 |
| `ufo.open`, `ufo.jump`, `land`, `land.water`, `splash`, `swim.stroke`, `wade`, `jump.air`, `gasp` | nave, pouso, água, pulo duplo | 1–4 |
| `tormenta.*` | aviso, relógio, fechando, final, entrar, sair, dano | 1–3 |
| `creep.windup`, `creep.hit`, `creep.die` | criaturas | 2–3 |
| `door.open`, `door.close`, `crate.hit`, `crate.break` | portas e caixas do mundo (`WorldAudio`) | 2–4 |
