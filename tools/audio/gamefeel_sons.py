"""Sons de game feel do graao, feitos por síntese (ruído filtrado e senos com envelope).

Vieram do protótipo Fractalia (D:/meus documentos/Fortnite/Unreal/gamefeel_sons.py, Docs/GameFeel/
FRACTALIA_AUDIO_FEEDBACK.md §4): originais do projeto, nada de arquivo de terceiro nem do Fortnite. Mono, 44,1 kHz,
16 bits; a semente é fixa, então rodar de novo dá os mesmos arquivos, byte a byte.

Uso (Python do sistema):
  python -I tools/audio/gamefeel_sons.py              gera todos em apps/client/public/assets/v1/audio/sfx/
  python -I tools/audio/gamefeel_sons.py Troca        só um

O cliente usa cada um no lugar do som sintetizado de mesmo papel (apps/client/src/audio/GRAAudioManager.ts, SAMPLES).
"""
import math
import os
import random
import struct
import sys
import wave

TAXA = 44100
PASTA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps", "client", "public", "assets", "v1", "audio", "sfx")


# ------------------------------------------------------------------ peças
def vazio(segundos):
    return [0.0] * int(segundos * TAXA)


def somar(base, pedaco, inicio=0.0, ganho=1.0):
    i0 = int(inicio * TAXA)
    for i, v in enumerate(pedaco):
        j = i0 + i
        if j >= len(base):
            break
        base[j] += v * ganho


def ruido(segundos, rnd):
    return [rnd.uniform(-1.0, 1.0) for _ in range(int(segundos * TAXA))]


def passa_baixa(sinal, corte):
    """Filtro de um polo (suave)."""
    a = math.exp(-2.0 * math.pi * corte / TAXA)
    y, saida = 0.0, []
    for x in sinal:
        y = (1 - a) * x + a * y
        saida.append(y)
    return saida


def passa_alta(sinal, corte):
    baixa = passa_baixa(sinal, corte)
    return [x - b for x, b in zip(sinal, baixa)]


def passa_banda(sinal, centro, q=4.0):
    """Biquad passa-banda (RBJ, ganho de pico constante)."""
    w0 = 2 * math.pi * centro / TAXA
    alfa = math.sin(w0) / (2 * q)
    b0, b2 = alfa, -alfa
    a0, a1, a2 = 1 + alfa, -2 * math.cos(w0), 1 - alfa
    x1 = x2 = y1 = y2 = 0.0
    saida = []
    for x in sinal:
        y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1 = x1, x
        y2, y1 = y1, y
        saida.append(y)
    return saida


def envelope(sinal, tau, ataque=0.002):
    """Sobe em `ataque` s e cai exponencialmente com constante `tau` s."""
    saida = []
    for i, x in enumerate(sinal):
        t = i / TAXA
        e = min(1.0, t / ataque) if ataque > 0 else 1.0
        saida.append(x * e * math.exp(-t / tau))
    return saida


def seno_varrido(segundos, f0, f1, tau, ataque=0.002):
    """Seno com a frequência indo de f0 a f1 (curva exponencial) e queda exponencial."""
    n = int(segundos * TAXA)
    fase, saida = 0.0, []
    for i in range(n):
        t = i / TAXA
        f = f0 * (f1 / f0) ** min(1.0, t / segundos)
        fase += 2 * math.pi * f / TAXA
        e = min(1.0, t / ataque) * math.exp(-t / tau)
        saida.append(math.sin(fase) * e)
    return saida


def normalizar(sinal, pico=0.89, fim=0.01):
    m = max(1e-9, max(abs(x) for x in sinal))
    saida = [x / m * pico for x in sinal]
    n = int(fim * TAXA)
    for i in range(n):
        saida[-1 - i] *= i / n
    return saida


# ------------------------------------------------------------------ os sons
def tiro_leve(rnd):
    s = vazio(0.28)
    somar(s, envelope(passa_alta(ruido(0.05, rnd), 2500), 0.008, 0.0005), 0.0, 0.9)        # estalo seco
    somar(s, seno_varrido(0.12, 180, 115, 0.04), 0.0, 0.6)                                    # corpo curto
    somar(s, envelope(passa_baixa(ruido(0.25, rnd), 1300), 0.07, 0.004), 0.008, 0.28)         # cauda
    return normalizar(s)


def tiro_pesado(rnd):
    s = vazio(0.5)
    somar(s, envelope(passa_alta(ruido(0.06, rnd), 1800), 0.011, 0.0005), 0.0, 0.85)
    somar(s, seno_varrido(0.3, 72, 44, 0.09, 0.001), 0.0, 1.0)                                # baque grave
    somar(s, envelope(passa_baixa(ruido(0.45, rnd), 650), 0.14, 0.006), 0.01, 0.4)            # cauda longa
    return normalizar(s)


def tiro_especial(rnd):
    s = vazio(0.32)
    somar(s, seno_varrido(0.16, 2200, 300, 0.06), 0.0, 0.6)                                   # varredura de energia
    somar(s, seno_varrido(0.16, 4400, 600, 0.04), 0.0, 0.18)                                  # brilho em cima
    somar(s, envelope(passa_banda(ruido(0.1, rnd), 3200, 3.0), 0.03, 0.001), 0.0, 0.5)        # chiado
    somar(s, envelope(passa_baixa(ruido(0.3, rnd), 900), 0.06, 0.01), 0.02, 0.15)
    return normalizar(s)


def golpe(rnd):
    n = int(0.24 * TAXA)
    base = ruido(0.24, rnd)
    saida = []
    # Sopro: o centro do filtro sobe e desce (corte de ar), com janela em seno.
    pedacos = 12
    for k in range(pedacos):
        a, b = k * n // pedacos, (k + 1) * n // pedacos
        t = (a + b) / 2 / n
        centro = 400 + 1100 * math.sin(math.pi * min(1.0, t * 1.2))
        saida.extend(passa_banda(base[a:b], centro, 1.6))
    for i in range(len(saida)):
        t = i / n
        saida[i] *= math.sin(math.pi * min(1.0, t / 0.75)) if t < 0.75 else 0.0
    return normalizar(saida, 0.8)


def troca(rnd):
    s = vazio(0.2)
    for inicio, ping in ((0.0, 1800.0), (0.07, 1450.0)):
        somar(s, envelope(passa_alta(ruido(0.008, rnd), 3000), 0.002, 0.0003), inicio, 0.7)  # clique
        somar(s, seno_varrido(0.06, ping, ping * 0.97, 0.014, 0.0005), inicio, 0.35)          # ressonância metálica
        somar(s, seno_varrido(0.05, ping * 1.52, ping * 1.5, 0.01, 0.0005), inicio, 0.15)
    return normalizar(s, 0.6)


def escudo_quebra(rnd):
    s = vazio(0.85)
    somar(s, envelope(passa_alta(ruido(0.08, rnd), 3000), 0.02, 0.0005), 0.0, 0.7)            # estalo do cristal
    somar(s, seno_varrido(0.2, 95, 60, 0.06, 0.001), 0.0, 0.45)                               # baque
    # Estilhaço: "tins" agudos aleatórios, mais densos no começo.
    for _ in range(42):
        inicio = 0.3 * rnd.random() ** 1.8
        f = rnd.uniform(2000, 6500)
        somar(s, seno_varrido(0.12, f, f * rnd.uniform(0.97, 1.0), rnd.uniform(0.025, 0.06), 0.0005), inicio,
              rnd.uniform(0.1, 0.22))
    # Tom de cristal descendente, com parcial inarmônico (som de sino).
    somar(s, seno_varrido(0.7, 1200, 400, 0.25, 0.01), 0.02, 0.32)
    somar(s, seno_varrido(0.7, 1200 * 2.76, 400 * 2.76, 0.12, 0.01), 0.02, 0.1)
    return normalizar(s)


SONS = {
    "Tiro_Leve": tiro_leve,
    "Tiro_Pesado": tiro_pesado,
    "Tiro_Especial": tiro_especial,
    "Golpe": golpe,
    "Troca": troca,
    "Escudo_Quebra": escudo_quebra,
}


def gravar(nome, amostras):
    os.makedirs(PASTA, exist_ok=True)
    caminho = os.path.join(PASTA, f"SFX_GF_{nome}.wav")
    with wave.open(caminho, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAXA)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1.0, min(1.0, x)) * 32767)) for x in amostras))
    return caminho


def main():
    so = sys.argv[1] if len(sys.argv) > 1 else None
    for i, (nome, funcao) in enumerate(SONS.items()):
        if so and nome != so:
            continue
        amostras = funcao(random.Random(1000 + i))
        caminho = gravar(nome, amostras)
        print(f"{caminho}  {len(amostras) / TAXA:.2f} s")


if __name__ == "__main__":
    main()
