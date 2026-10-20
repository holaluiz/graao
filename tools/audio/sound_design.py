"""Sound design do graao: todos os efeitos do jogo, feitos de gravações CC0 em camadas com síntese.

Fontes (assets/audio/fontes/, fora do git; origem e licença em docs/audio/SOUND_DESIGN.md): The Free Firearm Sound
Library (tiros reais), os pacotes de áudio da Kenney (passos, impactos, pano e metal, interface, ficção científica), os
golpes de ar de qubodup e a água e gosma de rubberduck. Tudo CC0. Cada receita recorta, filtra, empilha camadas
(o soco grave, o brilho, a cauda), põe espaço (reverb por convolução, ecos de vale) e devolve uma variação; a saída é
nivelada pela sonoridade de curto prazo do papel do som, e não pelo pico.

Uso (Python do sistema, com numpy e scipy; ffmpeg no PATH):
  python -I tools/audio/sound_design.py            gera todos em apps/client/public/assets/v1/audio/sfx/
  python -I tools/audio/sound_design.py fire.      só os que começam assim

Gera também apps/client/src/audio/sfxBank.ts (nome → variações e ganho), que o GRAAudioManager lê. A semente de cada
variação é fixa: rodar de novo dá os mesmos sons.
"""
import hashlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

from som import (  # noqa: E402
    TAXA, ajustar_nivel, cliques, autopan, baque, banda, camada, cauda, comprimir, decair, deslizar, dur,
    envelope_pontos, estalo, eq, evento, fade, fim, gravar_mp3, graos, graves, inicio, kalimba, largura, ler,
    marimba, mixar, mono, nivel, normalizar, pa, panorama, parciais, pb, pico, recorte, reverb, reverso, ruido,
    saturar, seg, seno, sino, sopro, tom, tremolo, db,
)

RAIZ = Path(__file__).resolve().parents[2]
FONTES = RAIZ / "assets" / "audio" / "fontes"
SAIDA = RAIZ / "apps" / "client" / "public" / "assets" / "v1" / "audio" / "sfx"
BANCO_TS = RAIZ / "apps" / "client" / "src" / "audio" / "sfxBank.ts"

K_IMPACTO = FONTES / "kenney_impact-sounds" / "Audio"
K_RPG = FONTES / "kenney_rpg-audio" / "Audio"
K_SCIFI = FONTES / "kenney_sci-fi-sounds" / "Audio"
K_UI = FONTES / "kenney_interface-sounds" / "Audio"
AGUA = FONTES / "water-splash-slime-sfx"
GOLPES = FONTES / "swoshes"
ARMAS = FONTES / "firearm" / "Prepared SFX Library"


# ------------------------------------------------------------------ fontes
def imp(nome, k=0):
    return ler(K_IMPACTO / f"{nome}_{k % 5:03d}.ogg")


def rpg(nome):
    return ler(K_RPG / f"{nome}.ogg")


def scifi(nome, k=0, n=5):
    return ler(K_SCIFI / f"{nome}_{k % n:03d}.ogg")


def ui(nome, k=1):
    return ler(K_UI / f"{nome}_{k:03d}.ogg")


def agua(nome):
    return ler(AGUA / f"{nome}.ogg")


def golpe(k):
    return ler(GOLPES / f"swosh-{k:02d}.flac")


def arma(pasta, arquivo):
    return ler(ARMAS / pasta / arquivo)


# Golpes de ar de bambu por duração (s): curtos ≈ 0,2–0,3, médios ≈ 0,4–0,5, longos ≈ 0,7–1,5.
CURTOS = [1, 6, 9, 10, 22, 25, 36, 42, 43, 8, 11, 12]
MEDIOS = [3, 5, 13, 14, 15, 16, 20, 26]
LONGOS = [28, 31, 32, 35, 41, 24, 29, 33, 34, 38]


# ------------------------------------------------------------------ registro
@dataclass
class Receita:
    nome: str
    fn: object
    n: int
    alvo: float
    ganho: float


RECEITAS = {}


def som(nome, n=1, alvo=-16.0, ganho=1.0):
    """Registra uma receita: `n` variações niveladas em `alvo` dB (sonoridade de curto prazo, ver som.nivel)."""
    def deco(fn):
        RECEITAS[nome] = Receita(nome, fn, n, alvo, ganho)
        return fn
    return deco


# ------------------------------------------------------------------ peças compartilhadas
def espaco_externo(x, rt60, molhado_db, brilho=5000, ecos_=(), pre=0.016):
    """Ar livre: reverb curto e claro mais as reflexões dos morros [(atraso, dB, corte, pan)]."""
    out = reverb(x, rt60, molhado_db, brilho, pre)
    # A reflexão volta sem o grave do soco (senão o eco dobra o "tum") e sem os agudos que o ar come.
    refl = [camada(panorama(pb(pa(mono(x), 280), corte), p), atraso, g) for atraso, g, corte, p in ecos_]
    return mixar(camada(out), *refl) if refl else out


def tiro(bruto, k, r, corpo=0.22, corte_alto=None, sat=1.6, soco=(110, 0.06, -6.0), estalo_db=None,
         rt60=0.9, molhado_db=-13.0, brilho=5000, ecos_=(), pa_hz=60):
    """Um disparo: o tiro seco gravado, saturado, com o soco grave por baixo, um estalo opcional e o ar livre."""
    s = pa(cauda(evento(bruto, k, corpo + 0.05, relativo=0.6, separacao=0.4), corpo, min(0.06, corpo * 0.4)), pa_hz)
    if corte_alto:
        s = pb(s, corte_alto)
    s = saturar(normalizar(s, 0), sat)
    camadas = [camada(s)]
    if soco:
        f, tau, g = soco
        camadas.append(camada(baque(f, f * 0.42, tau, tau * 5), 0, g))
    if estalo_db is not None:
        camadas.append(camada(estalo(r, 0.01, 3500, 0.0018), 0, estalo_db))
    seco = comprimir(mixar(*camadas), -12, 3.0, 0.002, 0.05)
    return espaco_externo(seco, rt60, molhado_db, brilho, ecos_)


def acorde(notas, r, instrumento=marimba, passo=0.0, segundos=1.2, tau=0.4, ganhos=None):
    """Notas (Hz) tocadas com `passo` s entre elas (0 = juntas)."""
    ganhos = ganhos or [0.0] * len(notas)
    return mixar(*[camada(instrumento(f, segundos, tau, r), i * passo, g) for i, (f, g) in enumerate(zip(notas, ganhos))])


def brilho_magico(segundos, r, quantos=16, f_min=2500, f_max=8500, curva=1.4):
    return graos(segundos, r, quantos, f_min, f_max, (0.015, 0.06), curva, (0.2, 0.7))


# Notas (Hz).
C4, D4, E4, F4, G4, A4, B4 = 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88
C5, D5, E5, F5, G5, A5, B5 = 523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77
C6, D6, E6, G6, C7 = 1046.5, 1174.66, 1318.51, 1567.98, 2093.0
Eb4, Gs5, Cs5, Cs6 = 311.13, 830.61, 554.37, 1108.73


# ================================================================== armas
@som("fire.pistol", n=4, alvo=-14)
def tiro_pistola(k, r):
    # Pistola Tática: 9 mm estalado (Walther PPQ, um .45 de vez em quando), slide metálico e um vale curto.
    bruto = arma("1911", "A_42P.wav") if k == 3 else arma("Walther PPQ", "X_39P.wav")
    x = tiro(bruto, k, r, corpo=0.2, sat=1.8, soco=(150, 0.03, -10), estalo_db=-14, rt60=0.75, molhado_db=-14,
             ecos_=[(0.09, -17, 3500, -0.5), (0.21, -22, 2200, 0.6)])
    mola = cauda(pa(rpg("metalLatch"), 2500), 0.08)
    return mixar(camada(x), camada(mola, 0.012, -20))


@som("fire.smg", n=5, alvo=-15)
def tiro_submetralhadora(k, r):
    # Submetralhadora: tiros secos e curtos (11 por segundo: o corpo para antes do "clack" do ferrolho, aos 80 ms, e a
    # cauda é só o ar, para a rajada não embolar).
    bruto = arma("Carl Gustav M45", "G_31P.wav") if k < 3 else arma("PPSh", "P_30P.wav")
    return tiro(bruto, k, r, corpo=0.075, sat=2.0, soco=(170, 0.02, -11), estalo_db=-16, rt60=0.45, molhado_db=-18,
                ecos_=[(0.08, -26, 3000, 0.4)])


@som("fire.rifle", n=4, alvo=-13.5)
def tiro_fuzil(k, r):
    # Fuzil Kalash: 7,62 encorpado com estalo, soco médio e o eco do vale.
    return tiro(arma("AK-47", "C_28P.wav"), k, r, corpo=0.24, sat=1.7, soco=(105, 0.045, -9), estalo_db=-12, rt60=1.0,
                molhado_db=-12, ecos_=[(0.12, -15, 3000, -0.5), (0.27, -20, 2000, 0.6), (0.5, -26, 1300, -0.2)])


@som("fire.sniper", n=4, alvo=-12)
def tiro_precisao(k, r):
    # Fuzil de Precisão: o estalo supersônico, um soco fundo e o vale inteiro respondendo.
    x = tiro(arma("Mosin Nagant", "M_21P.wav"), k, r, corpo=0.32, sat=1.5, soco=(75, 0.07, -9), estalo_db=-8,
             rt60=1.8, molhado_db=-10, brilho=4200,
             ecos_=[(0.16, -13, 2800, -0.6), (0.38, -17, 1800, 0.7), (0.71, -22, 1200, -0.3), (1.1, -28, 900, 0.3)])
    return x


@som("fire.rocket", n=3, alvo=-12.5)
def tiro_foguete(k, r):
    # Lança-Foguetes: o "tum" da saída, o chiado do motor indo embora e um sopro grave.
    motor = recorte(scifi("thrusterFire", k), 0.4 + 0.3 * k, 0.9)
    motor = envelope_pontos(pb(pa(motor, 300), 5000, 4), [(0, 0), (0.03, 1), (0.25, 0.7), (0.9, 0)])
    ar = sopro(0.7, r, 2600, 500, 0.9, [(0, 0), (0.02, 1), (0.7, 0)])
    seco = mixar(camada(baque(80, 30, 0.1, 0.5)), camada(cauda(imp("impactSoft_heavy", k), 0.4), 0, -3),
                 camada(motor, 0.01, -2), camada(ar, 0, -9), camada(estalo(r, 0.015, 1500, 0.004), 0, -10))
    return espaco_externo(comprimir(seco, -12, 3), 1.4, -11, 4000, [(0.15, -15, 1800, -0.5), (0.4, -21, 1200, 0.5)])


@som("fire.petal", n=4, alvo=-13.5)
def tiro_petalas(k, r):
    # Rajada de Pétalas: o corpo de uma escopeta, amaciado, e uma revoada de pétalas (golpe de ar, papel, brilho).
    bruto = arma("Nova", "O_21P.wav") if k < 2 else arma("CD", "H_21P.wav")
    corpo = tiro(bruto, k, r, corpo=0.26, corte_alto=4200, sat=1.4, soco=(95, 0.05, -8), rt60=1.0, molhado_db=-13,
                 ecos_=[(0.12, -17, 2500, 0.5), (0.3, -23, 1500, -0.5)])
    revoada = mixar(camada(tom(golpe(CURTOS[k]), 1.15), 0.008, -7),
                    camada(cauda(pa(rpg("bookFlip3"), 1200), 0.18), 0.02, -8),
                    camada(brilho_magico(0.35, r, 8, 2500, 6000), 0.02, -21))
    return mixar(camada(corpo), camada(largura(revoada, 0.4)))


@som("fire.sunbeam", n=4, alvo=-14)
def tiro_raio_de_sol(k, r):
    # Raio de Sol: um "piu" quente de luz (glissando saturado), faíscas, a textura de um laser e um soquinho.
    f0 = 2300 * (1 + 0.04 * (k - 1.5))
    piu = saturar(seno(0.12, f0, 650, 0.045, 0.0008) + 0.35 * seno(0.12, f0 * 2, 1300, 0.03, 0.0008), 2.2)
    laser = pb(cauda(scifi("laserSmall", k), 0.2), 6000)
    x = mixar(camada(piu), camada(laser, 0, -7), camada(brilho_magico(0.16, r, 10, 4000, 9000, 2.0), 0, -12),
              camada(baque(190, 70, 0.025, 0.12), 0, -9))
    return reverb(comprimir(x, -14, 3), 0.6, -16, 7000)


@som("fire.far", n=6, alvo=-14)
def tiro_distante(k, r):
    # Um tiro do outro lado do morro: a gravação a meia distância, abafada, longa, com o vale devolvendo duas vezes.
    fontes = [("Walther PPQ", "X_31P.wav", 0), ("Walther PPQ", "X_31P.wav", 1), ("AK-47", "C_31P.wav", 0),
              ("Tikka", "W_24P.wav", 0), ("Tikka", "W_24P.wav", 1), ("Nova", "O_17P.wav", 0)]
    pasta, arquivo, i = fontes[k]
    s = pb(pa(evento(arma(pasta, arquivo), i, 0.9, relativo=0.6, separacao=0.4), 70), 2200)
    s = mixar(camada(s), camada(baque(70, 40, 0.09, 0.4), 0, -10))
    return espaco_externo(s, 2.2, -6, 1800, [(0.22, -9, 1200, -0.6), (0.55, -14, 900, 0.6)])


# ------------------------------------------------------------------ manejo
@som("reload", n=3, alvo=-21)
def recarga_sai(k, r):
    # O pente sai: o botão, o metal deslizando e a mão no cinto.
    return mixar(camada(cauda(pa(rpg("metalClick"), 900), 0.12)),
                 camada(cauda(tom(imp("impactTin_medium", k), 1.25), 0.12), 0.03, -8),
                 camada(cauda(rpg("clothBelt"), 0.22), 0.08, -12))


@som("reload.in", n=3, alvo=-19)
def recarga_entra(k, r):
    # O pente entra: um "clack" firme com o corpo do metal.
    return mixar(camada(cauda(rpg("metalLatch"), 0.12)),
                 camada(cauda(tom(imp("impactMetal_light", k), 1.3), 0.15), 0.004, -6),
                 camada(baque(320, 160, 0.015, 0.06), 0, -12))


@som("reload.end", n=2, alvo=-19)
def recarga_ferrolho(k, r):
    # O ferrolho: puxa e solta (dois metais), com o couro da mão.
    trava = rpg("metalLatch")
    return mixar(camada(cauda(tom(trava, 0.88 + 0.05 * k), 0.12)), camada(cauda(tom(trava, 1.15), 0.12), 0.075, -2),
                 camada(cauda(rpg("beltHandle1"), 0.2), 0.0, -12))


@som("empty", n=3, alvo=-22)
def sem_municao(k, r):
    # O gatilho em seco: um clique miúdo de mola.
    return mixar(camada(cauda(pa(rpg("metalClick"), 1500), 0.07)),
                 camada(cauda(tom(imp("impactTin_medium", k + 2), 2.0), 0.05), 0.0, -12))


@som("switch", n=3, alvo=-21)
def troca_arma(k, r):
    # Trocar de arma: o pano, a mão na empunhadura e o metal assentando.
    return mixar(camada(cauda(rpg(f"cloth{1 + k}"), 0.25), 0, -4),
                 camada(cauda(rpg("handleSmallLeather"), 0.2), 0.04, -6),
                 camada(cauda(tom(rpg("metalLatch"), 1.1 + 0.05 * k), 0.12), 0.13, -3))


@som("loot.equip", n=2, alvo=-19)
def equipar(k, r):
    # Arma nova na mão: o couro, a trava e o peso do metal.
    return mixar(camada(cauda(rpg(f"clothBelt{'' if k == 0 else '2'}"), 0.3), 0, -6),
                 camada(cauda(rpg("metalLatch"), 0.12), 0.15),
                 camada(cauda(tom(imp("impactMetal_light", k), 1.2), 0.2), 0.16, -9))


# ------------------------------------------------------------------ acertos
@som("hit.body", n=4, alvo=-16)
def acerto_corpo(k, r):
    # Hitmarker: um "tec" brilhante por cima de um tapa curto (precisa atravessar o tiroteio).
    tapa = cauda(pa(imp("impactPunch_medium", k), 250), 0.12)
    tec = seno(0.06, 2100 + 60 * k, 1800, 0.012, 0.0005)
    return mixar(camada(tapa, 0, -3), camada(tec, 0, -6), camada(estalo(r, 0.008, 4000, 0.0015), 0, -10),
                 camada(cauda(pa(imp("impactGeneric_light", k), 800), 0.08), 0, -9))


@som("hit.crit", n=3, alvo=-14)
def acerto_critico(k, r):
    # Na cabeça: o mesmo tapa e um "plim" de metal que fica soando.
    tapa = cauda(pa(imp("impactPunch_medium", k + 1), 300), 0.1)
    plim = mixar(camada(sino(2350, 0.45, 0.12, 0.6)), camada(sino(3520, 0.4, 0.08, 0.4), 0, -8))
    return mixar(camada(tapa, 0, -6), camada(plim, 0.004), camada(cauda(tom(imp("impactMetal_light", k), 1.5), 0.2), 0, -10),
                 camada(estalo(r, 0.008, 5000, 0.0015), 0, -9))


@som("hit.shield", n=4, alvo=-16)
def acerto_escudo(k, r):
    # No escudo: vidro tocado, um tom cristalino e poeira de brilho.
    vidro = cauda(tom(imp("impactGlass_light", k), 1.2), 0.18)
    return mixar(camada(vidro), camada(sino(1250 + 40 * k, 0.25, 0.06, 0.5), 0, -10),
                 camada(brilho_magico(0.15, r, 6, 4000, 9000), 0, -14))


def estilhaco(r, segundos=0.7, quantos=42, f_min=2000, f_max=6500):
    """Cristal quebrando em cacos (do antigo SFX_GF_Escudo_Quebra)."""
    cacos = graos(segundos * 0.6, r, quantos, f_min, f_max, (0.025, 0.06), 1.8, (0.45, 1.0))
    queda = seno(segundos, 1200, 400, 0.25, 0.01) + 0.3 * seno(segundos, 1200 * 2.76, 400 * 2.76, 0.12, 0.01)
    return mixar(camada(cacos), camada(queda, 0.02, -8))


@som("hit.shieldBreak", n=2, alvo=-13)
def quebra_escudo(k, r):
    x = mixar(camada(cauda(imp("impactGlass_heavy", k), 0.3)), camada(cauda(imp("impactGlass_medium", k + 2), 0.4), 0.01, -4),
              camada(estilhaco(r), 0, -4), camada(baque(95, 60, 0.06, 0.25), 0, -6))
    return reverb(x, 0.9, -14, 7000)


@som("hit.elim", n=2, alvo=-12)
def eliminacao(k, r):
    # Eliminou: um baque fundo, dois toques de kalimba subindo e brilho (inconfundível no meio da briga).
    notas = mixar(camada(kalimba(G5, 1.0, 0.35, r)), camada(kalimba(C6, 1.2, 0.45, r), 0.075),
                  camada(sino(G6, 0.9, 0.3, 0.5), 0.075, -12))
    x = mixar(camada(baque(120, 45, 0.12, 0.6)), camada(cauda(imp("impactSoft_heavy", k), 0.4), 0, -6),
              camada(notas, 0, -2), camada(brilho_magico(0.5, r, 18, 3000, 8000), 0.06, -12))
    return reverb(x, 1.2, -11, 6000)


@som("hurt.health", n=4, alvo=-13)
def dano_vida(k, r):
    # Levei na carne: um soco abafado com peso (saturado: incomoda de propósito).
    soco = pb(cauda(imp("impactPunch_heavy", k), 0.3), 2500)
    return saturar(normalizar(mixar(camada(soco), camada(baque(120, 55, 0.08, 0.3), 0, -3)), 0), 1.6)


@som("hurt.shield", n=3, alvo=-13)
def dano_escudo(k, r):
    vidro = pb(cauda(imp("impactGlass_medium", k), 0.3), 3500)
    return mixar(camada(vidro), camada(baque(160, 80, 0.05, 0.2), 0, -6))


@som("hurt.shieldBreak", n=2, alvo=-12)
def dano_quebra_escudo(k, r):
    # O meu escudo quebrando: o mesmo cristal, mais grave e com um peso por baixo (quem atira ouve o claro).
    x = mixar(camada(cauda(tom(imp("impactGlass_heavy", k), 0.85), 0.35)),
              camada(cauda(tom(imp("impactGlass_medium", k + 1), 0.8), 0.4), 0.01, -5),
              camada(pb(estilhaco(r, 0.7, 34, 1500, 4500), 6000), 0, -6), camada(baque(130, 45, 0.15, 0.5), 0, -1))
    return reverb(x, 1.0, -14, 4500)


# ------------------------------------------------------------------ mãos vazias
@som("melee.swing", n=6, alvo=-18)
def soco_ar(k, r):
    return cauda(pa(golpe(CURTOS[k]), 140), 0.34)


@som("melee.hit", n=4, alvo=-14)
def soco_acerta(k, r):
    # O soco acertando: o impacto, um grave de desenho animado e o tapa seco por cima.
    return mixar(camada(cauda(imp("impactPunch_heavy", k + 2), 0.3)), camada(baque(170, 60, 0.06, 0.3), 0, -4),
                 camada(estalo(r, 0.015, 1800, 0.004), 0, -8), camada(cauda(imp("impactSoft_medium", k), 0.12), 0, -7))


@som("melee.wall", n=3, alvo=-16)
def soco_parede(k, r):
    # Dedos na pedra: um toque surdo.
    return mixar(camada(cauda(imp("impactGeneric_light", k), 0.12)), camada(cauda(tom(imp("impactWood_light", k), 0.8), 0.12), 0, -6),
                 camada(baque(260, 140, 0.03, 0.12), 0, -8))


# ================================================================== magias
@som("ab.orb", n=3, alvo=-13)
def magia_orbe(k, r):
    # Orbe: um "fwum" de luz subindo, a vibração de um campo de força e faíscas.
    sobe = seno(0.3, 480, 1500, None, 0.01)
    sobe = decair(saturar(sobe + 0.3 * seno(0.3, 960, 3000, None, 0.01), 1.5), 0.11, 0.012)
    campo = pa(cauda(scifi("forceField", k), 0.35), 300)
    x = mixar(camada(tom(golpe(MEDIOS[k]), 1.2), 0, -5), camada(sobe, 0, -3), camada(campo, 0, -11),
              camada(brilho_magico(0.3, r, 14), 0.03, -10))
    return reverb(x, 0.8, -12, 7000)


@som("ab.dash", n=3, alvo=-14)
def magia_disparada(k, r):
    # Disparada: um golpe de ar forte, a rajada passando e um peso no arranque.
    ar = sopro(0.36, r, 400, 2600, 0.9, [(0, 0), (0.04, 1), (0.36, 0)])
    x = mixar(camada(tom(golpe(MEDIOS[k + 3]), 0.85)), camada(ar, 0, -5), camada(baque(90, 45, 0.06, 0.3), 0, -10))
    return largura(x, 0.35)


@som("ab.pollen", n=3, alvo=-14)
def magia_polen(k, r):
    # Pólen: um sopro macio que se abre em poeira brilhante.
    puff = sopro(0.28, r, 1500, 650, 0.8, [(0, 0), (0.02, 1), (0.28, 0)], "rosa")
    po = graos(0.45, r, 28, 2500, 7000, (0.012, 0.045), 1.3, (0.15, 0.6))
    return reverb(mixar(camada(puff, 0, -2), camada(po, 0.02, -5), camada(tom(agua("bubble_03"), 1.6), 0, -16)), 0.9, -12, 8000)


@som("ab.shield", n=2, alvo=-13)
def magia_escudo(k, r):
    # Escudo: o campo de força ligando e um acorde de vidro em quintas.
    campo = pa(cauda(scifi("forceField", k + 2), 0.9), 200)
    vidro = acorde([C5, G5, D6, G6], r, lambda f, s, t, _r: sino(f, s, t, 0.7), 0.03, 1.2, 0.45, [0, -3, -6, -9])
    x = mixar(camada(campo, 0, -6), camada(vidro, 0, -2), camada(cauda(imp("impactGlass_light", k), 0.2), 0, -9))
    return reverb(x, 1.3, -10, 7000)


@som("ab.seed", n=3, alvo=-14)
def magia_semente(k, r):
    # Semente: o arremesso, um "toc" de madeira e um estalinho.
    return mixar(camada(tom(golpe(CURTOS[k + 4]), 1.3), 0, -8), camada(cauda(tom(imp("impactWood_light", k), 1.4), 0.15)),
                 camada(seno(0.06, 620, 300, 0.015, 0.0008), 0.005, -8))


@som("ab.gust", n=3, alvo=-14)
def magia_rajada(k, r):
    # Rajada: um golpe de ar longo e grave, o vento empurrando e um ronco no chão.
    vento = sopro(0.7, r, 2400, 380, 0.7, [(0, 0), (0.06, 1), (0.7, 0)])
    x = mixar(camada(tom(golpe(LONGOS[k]), 0.8)), camada(vento, 0, -3), camada(baque(80, 40, 0.15, 0.6), 0, -10))
    return autopan(x, 0.9, 0.5, k)


@som("ab.sap", n=4, alvo=-14)
def magia_seiva(k, r):
    # Seiva: gosma de verdade e um "blorp" grave.
    return mixar(camada(cauda(agua(f"slime_{[1, 4, 7, 10][k]:02d}"), 0.45)), camada(seno(0.2, 260, 120, 0.07, 0.003), 0, -6),
                 camada(tom(agua("bubble_02"), 0.9), 0.04, -12))


@som("ab.heal", n=2, alvo=-14)
def magia_cura(k, r):
    # Cura: kalimba em arpejo maior, um brilho no alto e um ar suave.
    notas = [G4, B4, D5, G5] if k == 0 else [A4, Cs5, E5, A5]
    arp = acorde(notas, r, kalimba, 0.07, 1.4, 0.5, [0, -1, -2, -3])
    ar = sopro(0.9, r, 3000, 6000, 2.0, [(0, 0), (0.2, 1), (0.9, 0)])
    x = mixar(camada(arp), camada(sino(notas[-1] * 2, 0.9, 0.3, 0.4), 0.25, -14), camada(ar, 0, -20),
              camada(brilho_magico(0.8, r, 12, 3000, 8000, 1.0), 0.05, -16))
    return reverb(x, 1.6, -8, 6500)


@som("ab.meteor", n=2, alvo=-13)
def magia_meteoro(k, r):
    # Meteoro (o anúncio): um rugido de fogo subindo até a queda.
    fogo = envelope_pontos(pa(recorte(scifi("thrusterFire", k + 1), 0.6, 1.15), 300), [(0, 0), (0.95, 1), (1.15, 0.5)])
    motor = envelope_pontos(deslizar(recorte(scifi("spaceEngineLow", k), 0.5, 1.6), 0.7, 1.4), [(0, 0), (0.9, 1), (1.1, 0.3)])
    ar = sopro(1.1, r, 300, 2400, 0.8, [(0, 0), (1.0, 1), (1.1, 0)])
    rumor = envelope_pontos(pb(ruido(1.1, r, "marrom"), 200), [(0, 0), (1.0, 1), (1.1, 0)])
    x = mixar(camada(fogo), camada(motor, 0, -4), camada(ar, 0, -5), camada(rumor, 0, -8))
    return reverb(x, 1.0, -14, 4000)


@som("ab.cyclone", n=2, alvo=-13)
def magia_ciclone(k, r):
    # Ciclone: o vento girando em volta (panorama circular), golpes de ar e o redemoinho de pétalas.
    vento = autopan(sopro(0.9, r, 900, 3400, 1.4, [(0, 0), (0.1, 1), (0.75, 0.9), (0.9, 0)]), 3.2, 0.85, k)
    giro = tremolo(pb(pa(recorte(scifi("engineCircular", k), 0.3, 0.9), 300), 4000), 7.0, 0.5)
    golpes = [camada(panorama(tom(golpe(CURTOS[i + 2 * k]), 1.1), (-1) ** i * 0.7), i * 0.22, -6) for i in range(3)]
    x = mixar(camada(vento), camada(fade(giro, 0.1, 0.2), 0, -10), *golpes, camada(brilho_magico(0.9, r, 14, 2500, 6000, 1.0), 0, -15))
    return reverb(x, 0.8, -14, 6000)


@som("ab.lance", n=2, alvo=-13)
def magia_lanca(k, r):
    # Lança: a carga zumbindo e subindo, e o disparo (laser grande, estalo, soco).
    carga = envelope_pontos(deslizar(pa(cauda(scifi("forceField", k + 1), 0.95), 200), 0.7, 1.6), [(0, 0.1), (0.6, 1), (0.66, 0)])
    zumbido = envelope_pontos(saturar(seno(0.7, 180, 900, None, 0.02) + 0.4 * seno(0.7, 360, 1800, None, 0.02), 1.8),
                              [(0, 0), (0.62, 1), (0.68, 0)])
    solta = mixar(camada(cauda(scifi("laserLarge", k), 0.45)), camada(estalo(r, 0.012, 2500, 0.003), 0, -4),
                  camada(baque(200, 60, 0.05, 0.25), 0, -4))
    x = mixar(camada(carga, 0, -4), camada(zumbido, 0, -12), camada(solta, 0.68))
    return reverb(x, 0.9, -12, 6000)


@som("ab.impact", n=3, alvo=-15)
def magia_impacto(k, r):
    return mixar(camada(cauda(imp("impactSoft_medium", k), 0.12)), camada(seno(0.06, 1400, 900, 0.02), 0, -8),
                 camada(brilho_magico(0.2, r, 8), 0, -11), camada(cauda(imp("impactGlass_light", k + 2), 0.12), 0, -13))


@som("ab.area", n=3, alvo=-12)
def magia_area(k, r):
    # Área: uma explosão macia (abafada), um soco grave e o ar se espalhando.
    x = mixar(camada(pb(cauda(scifi("explosionCrunch", k), 0.5), 2800), 0, -2), camada(baque(150, 55, 0.1, 0.4)),
              camada(sopro(0.32, r, 2500, 500, 0.9, [(0, 1), (0.32, 0)]), 0, -9))
    return reverb(x, 0.7, -14, 4000)


@som("ab.boom", n=2, alvo=-11)
def magia_explosao(k, r):
    # O meteoro chega: grave de explosão, estilhaços, um sub enorme, pedras caindo e o eco do vale.
    x = mixar(camada(cauda(scifi("lowFrequency_explosion", k, 2), 1.2)), camada(cauda(scifi("explosionCrunch", k + 2), 0.75), 0, -4),
              camada(baque(110, 32, 0.2, 1.0), 0, -6), camada(pb(cauda(imp("impactMining", k), 0.6), 3000), 0.08, -10))
    x = comprimir(saturar(normalizar(x, 0), 1.4), -10, 3)
    return espaco_externo(x, 1.8, -8, 3500, [(0.2, -12, 1500, -0.5), (0.5, -17, 1000, 0.5)])


@som("ab.warn", n=1, alvo=-14)
def magia_aviso(k, r):
    # Aviso de magia caindo aqui: dois toques claros de sino descendo (o mesmo sempre, para reconhecer).
    x = mixar(camada(sino(990, 0.35, 0.1, 0.5)), camada(sino(740, 0.45, 0.13, 0.5), 0.11))
    return reverb(x, 0.6, -16, 6000)


@som("ab.denied", n=2, alvo=-18)
def magia_negada(k, r):
    return cauda(ui("error", 5 + k), 0.3)


@som("ult.ready", n=1, alvo=-13)
def supremo_pronto(k, r):
    # Supremo pronto: um brilho que cresce de trás para frente e um acorde maior que se abre.
    acord = acorde([E5, Gs5, B5, E6], r, kalimba, 0.075, 1.4, 0.55, [0, -1, -2, -3])
    sobe = envelope_pontos(sopro(0.5, r, 1500, 7000, 1.5), [(0, 0), (0.45, 1), (0.5, 0)])
    x = mixar(camada(sobe, 0, -8), camada(acord, 0.42), camada(brilho_magico(0.9, r, 16), 0.5, -12))
    return reverb(x, 1.5, -9, 7000)


# ================================================================== partida e interface
@som("ui.click", n=3, alvo=-20)
def ui_clique(k, r):
    return cauda(ui("select", 1 + k) if k < 2 else ui("click", 5), 0.06)


@som("ui.ready", n=1, alvo=-18)
def ui_pronto(k, r):
    return mixar(camada(cauda(ui("confirmation", 1), 0.35)), camada(sino(G6, 0.3, 0.1, 0.3), 0.06, -16))


@som("ui.swap", n=3, alvo=-18)
def ui_troca_roupa(k, r):
    # Troca de peça no criador: o pano e um "pop" macio.
    return mixar(camada(cauda(rpg(f"cloth{1 + k}"), 0.25), 0, -3), camada(cauda(ui("pluck", 1 + k % 2), 0.12), 0.05, -4))


@som("countdown", n=1, alvo=-14)
def contagem(k, r):
    return reverb(mixar(camada(marimba(A5, 0.5, 0.18, r)), camada(sino(A5 * 2, 0.3, 0.08, 0.3), 0, -12)), 0.6, -16)


@som("go", n=1, alvo=-12)
def valendo(k, r):
    # Valendo: um acorde aberto na marimba e um golpe de ar subindo.
    acord = acorde([A4, E5, A5, Cs6], r, marimba, 0.0, 0.9, 0.35, [0, -2, -3, -5])
    x = mixar(camada(acord), camada(sopro(0.4, r, 800, 5000, 1.2, [(0, 0), (0.05, 1), (0.4, 0)]), 0, -10),
              camada(baque(140, 70, 0.08, 0.3), 0, -8))
    return reverb(x, 1.2, -10, 6000)


@som("victory", n=1, alvo=-12)
def vitoria(k, r):
    # Vitória: um tema curto de marimba subindo até o dó agudo, com o acorde final e brilho.
    melodia = [(C5, 0.0), (E5, 0.12), (G5, 0.24), (C6, 0.36), (G5, 0.6), (C6, 0.72)]
    tema = mixar(*[camada(marimba(f, 1.2, 0.4, r), t, -1 if i < 4 else 0) for i, (f, t) in enumerate(melodia)])
    final = acorde([C5, E5, G5, C6, E6], r, kalimba, 0.0, 1.6, 0.7, [-4, -6, -6, -5, -9])
    x = mixar(camada(tema), camada(final, 0.72), camada(brilho_magico(1.2, r, 20), 0.72, -14),
              camada(acorde([C4 / 2, C4], r, marimba, 0, 1.4, 0.5), 0.72, -8))
    return reverb(x, 1.6, -9, 6500)


@som("defeat", n=1, alvo=-13)
def derrota(k, r):
    # Derrota: quatro notas descendo em menor, lentas, e um acorde baixo que se apaga.
    melodia = [(G4, 0.0), (F4, 0.22), (Eb4, 0.44), (C4, 0.7)]
    tema = mixar(*[camada(marimba(f, 1.3, 0.45, r), t) for f, t in melodia])
    final = acorde([C4 / 2, G4 / 2, Eb4], r, marimba, 0.0, 1.8, 0.7, [-6, -9, -9])
    return reverb(mixar(camada(tema), camada(final, 0.7)), 1.8, -8, 3500)


@som("death", n=2, alvo=-12)
def morte(k, r):
    # Morri: um baque abafado e pesado, o pigmento rachando como vidro fosco e um tom caindo no escuro.
    queda = seno(0.9, 300, 60, 0.3, 0.005) + 0.3 * seno(0.9, 450, 90, 0.2, 0.005)
    racha = pb(cauda(tom(imp("impactGlass_medium", k), 0.7), 0.5), 2500)
    x = mixar(camada(cauda(tom(imp("impactSoft_heavy", k), 0.8), 0.6)), camada(baque(90, 35, 0.2, 0.8), 0, -2),
              camada(racha, 0.02, -6), camada(queda, 0.05, -8),
              camada(envelope_pontos(pb(ruido(1.0, r, "rosa"), 900), [(0, 0), (0.05, 1), (1.0, 0)]), 0.0, -16))
    return reverb(pb(x, 5000), 1.8, -9, 2500)


@som("draft.lock", n=2, alvo=-17)
def draft_trava(k, r):
    # Carta pressionada no papel e um sininho.
    return mixar(camada(cauda(rpg(f"bookPlace{1 + k}"), 0.2)), camada(sino(E6, 0.35, 0.1, 0.4), 0.02, -6))


@som("draft.reveal", n=1, alvo=-15)
def draft_revela(k, r):
    # Cartas virando: o papel e uma quinta aberta.
    return reverb(mixar(camada(cauda(rpg("bookFlip1"), 0.5), 0, -2), camada(marimba(D5, 0.8, 0.3, r), 0.06, -4),
                        camada(marimba(A5, 0.9, 0.32, r), 0.12, -5)), 1.0, -12)


@som("draft.lost", n=1, alvo=-16)
def draft_perdeu(k, r):
    # Outro levou: duas notas descendo e uma subida esperançosa (escolha de novo).
    return reverb(mixar(camada(marimba(E5, 0.5, 0.2, r)), camada(marimba(C5, 0.5, 0.22, r), 0.13),
                        camada(marimba(G5, 0.6, 0.25, r), 0.3, -4)), 0.9, -13)


@som("draft.tick", n=1, alvo=-20)
def draft_tique(k, r):
    return cauda(ui("tick", 4), 0.06)


@som("xp", n=1, alvo=-18)
def experiencia(k, r):
    return mixar(camada(sino(E6, 0.25, 0.07, 0.4)), camada(sino(B5 * 2, 0.3, 0.08, 0.4), 0.06, -2),
                 camada(brilho_magico(0.2, r, 5, 5000, 9000), 0.04, -14))


@som("levelup", n=1, alvo=-12)
def subiu_nivel(k, r):
    # Subiu de nível: fanfarra de marimba subindo uma oitava, sino por cima e um golpe de ar.
    arp = mixar(*[camada(marimba(f, 1.0, 0.35, r), i * 0.07) for i, f in enumerate([C5, E5, G5, C6, E6])])
    x = mixar(camada(arp), camada(sino(G6, 1.0, 0.35, 0.5), 0.35, -8),
              camada(sopro(0.5, r, 900, 6000, 1.3, [(0, 0), (0.3, 1), (0.5, 0)]), 0, -12),
              camada(brilho_magico(0.8, r, 18), 0.3, -12))
    return reverb(x, 1.4, -9, 7000)


# ------------------------------------------------------------------ saque
@som("loot.near", n=1, alvo=-20)
def saque_perto(k, r):
    return reverb(mixar(camada(sino(G6, 0.4, 0.15, 0.3)), camada(sino(C7, 0.5, 0.18, 0.3), 0.09, -2)), 1.0, -10, 8000)


@som("loot.open", n=2, alvo=-16)
def bau_abre(k, r):
    # Baú: o trinco, a dobradiça rangendo e a tampa batendo de leve.
    return mixar(camada(cauda(rpg("metalLatch"), 0.1), 0, -3), camada(cauda(rpg(f"creak{1 + k}"), 0.45), 0.04, -4),
                 camada(cauda(imp("impactWood_medium", k), 0.25), 0.36, -4))


@som("loot.reveal", n=1, alvo=-15)
def saque_revela(k, r):
    arp = mixar(*[camada(kalimba(f, 1.0, 0.4, r), i * 0.055) for i, f in enumerate([C5, E5, G5, C6])])
    return reverb(mixar(camada(arp), camada(brilho_magico(0.5, r, 16, 4000, 9000), 0.1, -10)), 1.2, -10, 7000)


@som("loot.pickup", n=3, alvo=-17)
def saque_pega(k, r):
    return mixar(camada(cauda(ui("drop", 2 + k % 2), 0.15)), camada(sino(C6 * (1 + 0.06 * k), 0.15, 0.04, 0.3), 0.02, -9))


@som("loot.ammo", n=2, alvo=-17)
def saque_municao(k, r):
    # Balas chacoalhando para dentro da bolsa.
    moedas = cauda(recorte(rpg("handleCoins" if k == 0 else "handleCoins2"), 0.0, 0.3), 0.3)
    return mixar(camada(pb(moedas, 7000)), camada(cauda(rpg("metalClick"), 0.08), 0.14, -6))


@som("loot.use", n=2, alvo=-17)
def saque_usa(k, r):
    # Destampar: um "pop" e o líquido.
    return mixar(camada(seno(0.07, 600, 900, 0.02, 0.001)), camada(estalo(r, 0.008, 2000, 0.002), 0, -6),
                 camada(tom(agua(f"bubble_0{1 + k}"), 1.2), 0.03, -6))


@som("loot.useDone", n=1, alvo=-16)
def saque_usou(k, r):
    return reverb(acorde([C5, G5, C6], r, kalimba, 0.07, 1.0, 0.4, [0, -1, -4]), 1.0, -11)


@som("loot.full", n=1, alvo=-17)
def saque_cheio(k, r):
    return mixar(camada(cauda(ui("bong", 1), 0.15)), camada(cauda(ui("back", 2), 0.1), 0.1, -3))


# ------------------------------------------------------------------ nave, movimento e água
@som("ufo.open", n=1, alvo=-15)
def nave_abre(k, r):
    porta = pb(cauda(scifi("doorOpen", 0, 3), 0.55), 9000)
    return reverb(mixar(camada(porta, 0, -2), camada(sino(D5, 0.5, 0.2, 0.4), 0.05, -6), camada(sino(A5, 0.7, 0.25, 0.4), 0.2, -6)), 1.0, -11)


@som("ufo.jump", n=2, alvo=-14)
def nave_pulo(k, r):
    # A escotilha e o ar passando.
    ar = sopro(0.8, r, 500, 2400, 0.8, [(0, 0), (0.08, 1), (0.8, 0)])
    return mixar(camada(pb(cauda(scifi("doorClose", k, 3), 0.25), 6000), 0, -4), camada(ar, 0.03), camada(tom(golpe(LONGOS[k + 4]), 0.9), 0.03, -6))


@som("land", n=2, alvo=-13)
def pouso(k, r):
    # Chegou ao chão vindo da nave: um baque pesado e a poeira.
    return mixar(camada(cauda(imp("impactSoft_heavy", k + 1), 0.45)), camada(baque(130, 45, 0.1, 0.4), 0, -3),
                 camada(cauda(imp("footstep_snow", k), 0.3), 0.01, -6),
                 camada(sopro(0.4, r, 1600, 300, 0.7, [(0, 1), (0.4, 0)], "rosa"), 0, -12))


@som("land.water", n=2, alvo=-13)
def pouso_agua(k, r):
    return mixar(camada(cauda(agua("splash_04" if k == 0 else "splash_01"), 1.0)), camada(baque(220, 80, 0.07, 0.3), 0, -8),
                 camada(cauda(agua("splash_02"), 0.7), 0.05, -6))


@som("splash", n=3, alvo=-15)
def respingo(k, r):
    return mixar(camada(cauda(agua(f"splash_0{[2, 3, 6][k]}"), 0.6)), camada(tom(agua("bubble_02"), 1.1), 0.06, -12))


@som("swim.stroke", n=4, alvo=-19)
def bracada(k, r):
    s = pb(cauda(recorte(agua(f"splash_{[5, 7, 9, 11][k]:02d}"), 0.0, 0.5), 0.4), 4500)
    return fade(s, 0.03, 0.15)


@som("wade", n=4, alvo=-20)
def vadear(k, r):
    return pb(cauda(agua(f"splash_{[6, 8, 10, 12][k]:02d}"), 0.22), 5000)


@som("jump.air", n=3, alvo=-18)
def pulo_ar(k, r):
    # Pulo duplo: o ar chutado para baixo (um golpe curto mais agudo e um sopro).
    return mixar(camada(tom(golpe(CURTOS[k + 6]), 1.35)), camada(sopro(0.22, r, 500, 2000, 0.8, [(0, 0), (0.03, 1), (0.22, 0)]), 0, -6))


@som("gasp", n=2, alvo=-19)
def folego(k, r):
    # Puxando o ar ao subir: ruído com formantes de "ha" subindo de abertura.
    base = ruido(0.4, r, "rosa")
    voz = sum(eq(banda(base, f * 0.8, f * 1.25), f, 6, 4) * g for f, g in [(700 + 40 * k, 1.0), (1220, 0.6), (2600, 0.3)])
    return envelope_pontos(voz, [(0, 0), (0.08, 1), (0.25, 0.6), (0.4, 0)])


# ------------------------------------------------------------------ Tormenta
@som("tormenta.warn", n=1, alvo=-16)
def tormenta_aviso(k, r):
    # Vai mexer: um gongo grave e macio e o papel arrastando (discreto, não é alarme).
    gongo = parciais_gongo(196, 1.4)
    return reverb(mixar(camada(gongo), camada(pb(cauda(rpg("bookFlip1"), 0.6), 5000), 0.05, -10)), 1.6, -10, 3500)


def parciais_gongo(f, segundos):
    return parciais(segundos, f, [(1, 1), (1.5, 0.35), (2.0, 0.25), (2.76, 0.15), (3.4, 0.06)], 0.6, 0.02, 0.985)


@som("tormenta.tick", n=1, alvo=-17)
def tormenta_tique(k, r):
    return mixar(camada(cauda(tom(imp("impactWood_light", 1), 1.6), 0.08)), camada(seno(0.05, 820, 760, 0.012), 0, -8))


@som("tormenta.shrink", n=1, alvo=-15)
def tormenta_fecha(k, r):
    # A borda começa a andar: uma onda grave descendo, papel rasgando por cima e um ronco.
    desce = seno(1.5, 220, 120, None, 0.08) * np.exp(-np.arange(seg(1.5)) / TAXA / 0.7)
    rasgo = envelope_pontos(banda(ruido(1.0, r), 1500, 5000), [(0, 0), (0.15, 1), (0.6, 0.6), (1.0, 0)])
    x = mixar(camada(desce), camada(rasgo, 0.1, -10), camada(cauda(rpg("bookFlip2"), 0.4), 0.15, -6),
              camada(envelope_pontos(pb(ruido(1.4, r, "marrom"), 160), [(0, 0), (0.3, 1), (1.4, 0)]), 0, -6))
    return reverb(x, 1.8, -10, 3000)


@som("tormenta.final", n=1, alvo=-14)
def tormenta_final(k, r):
    x = mixar(*[camada(parciais_gongo(f, 1.4), i * 0.24) for i, f in enumerate([G4, Eb4, C4])],
              camada(envelope_pontos(pb(ruido(1.6, r, "marrom"), 300), [(0, 0), (0.3, 1), (1.6, 0)]), 0, -8))
    return reverb(x, 2.0, -8, 3000)


@som("tormenta.enter", n=1, alvo=-15)
def tormenta_entra(k, r):
    # Saindo da cor: o ar abafando de repente e um baque.
    ar = sopro(0.6, r, 2200, 260, 0.7, [(0, 0), (0.05, 1), (0.6, 0)], "rosa")
    return reverb(mixar(camada(ar), camada(baque(150, 70, 0.1, 0.4), 0, -4), camada(tom(reverso(golpe(MEDIOS[0])), 0.7), 0, -10)), 1.2, -12, 2000)



@som("tormenta.exit", n=1, alvo=-17)
def tormenta_sai(k, r):
    # A cor de volta: um brilho de ar subindo.
    return reverb(mixar(camada(sopro(0.35, r, 1200, 4200, 1.0, [(0, 0), (0.05, 1), (0.35, 0)])), camada(kalimba(C5, 0.6, 0.25, r), 0.04, -6),
                        camada(kalimba(E5, 0.6, 0.25, r), 0.1, -8)), 1.0, -12)


@som("tormenta.hurt", n=3, alvo=-15)
def tormenta_dano(k, r):
    # Pigmento raspado: um risco seco e um toque surdo.
    return mixar(camada(cauda(ui("scratch", [1, 2, 5][k]), 0.2)), camada(baque(140, 70, 0.05, 0.2), 0, -4))


# ------------------------------------------------------------------ criaturas
@som("creep.windup", n=2, alvo=-14)
def criatura_prepara(k, r):
    # O aviso de que vai bater: um ronco de pedra subindo.
    ronco = deslizar(pb(recorte(scifi("spaceEngineLow", k + 2), 0.3, 0.8), 900), 0.6, 1.1)
    x = mixar(camada(envelope_pontos(ronco, [(0, 0), (0.35, 1), (0.45, 0)])),
              camada(envelope_pontos(sopro(0.45, r, 300, 1100, 1.0, cor="marrom"), [(0, 0), (0.4, 1), (0.45, 0)]), 0, -6))
    return saturar(normalizar(x, 0), 2.0)


@som("creep.hit", n=3, alvo=-14)
def criatura_apanha(k, r):
    # Barro e pedra levando um golpe: um toque esfarelado.
    return mixar(camada(cauda(imp("impactMining", k), 0.18)), camada(cauda(imp("impactPlank_medium", k), 0.12), 0, -6),
                 camada(baque(220, 110, 0.04, 0.15), 0, -8))


@som("creep.die", n=2, alvo=-14)
def criatura_morre(k, r):
    # Desmorona: pedras caindo e um "puf".
    pedras = [camada(cauda(tom(imp("impactGeneric_light", i + k), 0.8 + 0.1 * i), 0.1), 0.05 + i * 0.05 + 0.02 * r.random(), -3 - 2 * i) for i in range(5)]
    return reverb(mixar(camada(cauda(imp("impactMining", k + 2), 0.5)), *pedras, camada(baque(220, 80, 0.12, 0.35), 0, -6),
                        camada(sopro(0.4, r, 1200, 300, 0.7, [(0, 1), (0.4, 0)], "rosa"), 0.05, -12)), 0.8, -14, 3500)


# ------------------------------------------------------------------ passos
def passo(x, alvo_corte=None, grave_db=0.0):
    x = pa(inicio(x, 0.02), 70)
    if alvo_corte:
        x = pb(x, alvo_corte)
    if grave_db:
        x = graves(x, 180, grave_db)
    return cauda(x, 0.28)


@som("step.grass", n=5, alvo=-17)
def passo_grama(k, r):
    return passo(imp("footstep_grass", k), grave_db=2)


@som("step.dirt", n=8, alvo=-17)
def passo_terra(k, r):
    return passo(rpg(f"footstep0{k}"), grave_db=1)


@som("step.sand", n=5, alvo=-18)
def passo_areia(k, r):
    # Areia: o "crunch" macio da neve, mais abafado e com o ataque amaciado.
    return fade(passo(imp("footstep_snow", k), 4000, 1), 0.012, 0.05)


@som("step.stone", n=5, alvo=-17)
def passo_pedra(k, r):
    return passo(imp("footstep_concrete", k))


@som("step.wood", n=5, alvo=-17)
def passo_madeira(k, r):
    return passo(imp("footstep_wood", k), grave_db=-2)


@som("step.metal", n=5, alvo=-17)
def passo_metal(k, r):
    # Metal: o passo no concreto e a chapa respondendo.
    chapa = cauda(tom(imp("impactPlate_light", k), 1.1), 0.25)
    return mixar(camada(passo(imp("footstep_concrete", k + 2))), camada(chapa, 0.002, -9))


@som("foley.cloth", n=4, alvo=-24)
def roupa(k, r):
    # O pano e o equipamento balançando na corrida (camada dos passos em disparada).
    return fade(cauda(rpg(f"cloth{1 + k}"), 0.22), 0.01, 0.08)


# ------------------------------------------------------------------ mundo (portas, caixas)
@som("door.open", n=2, alvo=-15)
def porta_abre(k, r):
    return cauda(rpg(f"doorOpen_{1 + k}"), 1.3)


@som("door.close", n=4, alvo=-14)
def porta_fecha(k, r):
    return cauda(rpg(f"doorClose_{1 + k}"), 0.7)


@som("crate.hit", n=3, alvo=-14)
def caixa_bate(k, r):
    return mixar(camada(cauda(imp("impactWood_medium", k), 0.25)), camada(cauda(imp("impactPlank_medium", k), 0.2), 0, -5))


@som("crate.break", n=2, alvo=-12)
def caixa_quebra(k, r):
    # Caixa quebrando: o estalo da madeira e as tábuas caindo.
    tabuas = [camada(cauda(tom(imp("impactWood_light", i + k), 0.85 + 0.1 * (i % 3)), 0.15), 0.06 + i * 0.055 + 0.02 * r.random(), -2 - 1.5 * i) for i in range(6)]
    return reverb(mixar(camada(cauda(imp("impactWood_heavy", k), 0.3)), camada(cauda(rpg("chop"), 0.2), 0, -3), *tabuas,
                        camada(baque(180, 70, 0.08, 0.3), 0, -6)), 0.7, -15, 4000)


# ================================================================== saída
def finalizar(x, alvo):
    x = pa(x, 25)
    x = inicio(x, 0.01, 0.001)
    x = fim(x, 0.0006, 0.03)
    x = ajustar_nivel(x, alvo)
    return fade(x, 0, 0.012)


def semente(nome, k):
    return int.from_bytes(hashlib.sha1(f"{nome}#{k}".encode()).digest()[:4], "little")


def gerar(filtro=None):
    sys.stdout.reconfigure(encoding="utf-8")
    SAIDA.mkdir(parents=True, exist_ok=True)
    feitos, linhas, avisos = set(), [], []
    for nome, rc in RECEITAS.items():
        if filtro and not nome.startswith(filtro):
            for k in range(rc.n):
                feitos.add(f"{nome}-{k + 1}.mp3")
            continue
        for k in range(rc.n):
            rnd = np.random.default_rng(semente(nome, k))
            x = finalizar(np.asarray(rc.fn(k, rnd), dtype=np.float64), rc.alvo)
            arquivo = f"{nome}-{k + 1}.mp3"
            gravar_mp3(x, SAIDA / arquivo)
            feitos.add(arquivo)
            linhas.append((arquivo, dur(x), nivel(x), db(pico(x)), "E" if x.ndim == 2 else "M", (SAIDA / arquivo).stat().st_size))
            estalos = cliques(x)
            if estalos:
                avisos.append(f"{arquivo}: possíveis estalos em {[float(t) for t in estalos[:6]]} s")
    # O que não foi gerado agora (receita removida, os antigos SFX_GF_*.wav) sai da pasta.
    if not filtro:
        for f in SAIDA.iterdir():
            if f.is_file() and f.name not in feitos:
                f.unlink()
                print(f"removido {f.name}")
    for arquivo, d, nv, pk, canais, tam in linhas:
        print(f"{arquivo:28s} {d:5.2f}s  nível {nv:6.1f} dB  pico {pk:5.1f} dB  {canais}  {tam / 1024:6.1f} KB")
    total = sum(f.stat().st_size for f in SAIDA.iterdir() if f.is_file())
    print(f"{len(feitos)} arquivos, {total / 1024 / 1024:.2f} MB em {SAIDA}")
    for a in avisos:
        print("AVISO", a)
    escrever_banco()


def escrever_banco():
    linhas = [
        "/**",
        " * Banco de efeitos sonoros: nome → quantas variações (`<nome>-<k>.mp3` em /assets/v1/audio/sfx, k = 1…n) e o",
        " * ganho do arquivo na mixagem.",
        " *",
        " * Gerado por tools/audio/sound_design.py (não editar à mão: mude a receita e rode o script).",
        " */",
        "export const SFX_BANK = {",
    ]
    for nome in sorted(RECEITAS):
        rc = RECEITAS[nome]
        linhas.append(f"  '{nome}': {{ n: {rc.n}, gain: {rc.ganho:g} }},")
    linhas += ["} as const satisfies Record<string, { n: number; gain: number }>;", "", "export type SfxName = keyof typeof SFX_BANK;", ""]
    BANCO_TS.write_text("\n".join(linhas), encoding="utf-8", newline="\n")
    print(f"banco: {BANCO_TS}")


if __name__ == "__main__":
    gerar(sys.argv[1] if len(sys.argv) > 1 else None)
