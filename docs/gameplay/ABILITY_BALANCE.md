# Balanceamento v2

A fonte executável é `packages/game-data/src/abilities.ts`. A tabela das 40 habilidades está em [ABILITY_CATALOG_V2.md](./ABILITY_CATALOG_V2.md). Valores são baseline de desenvolvimento, sujeitos a testes de confronto.

Referências: Vida 100, escudo normal 100, Mana 100 e regeneração de Mana 8/s. A progressão existente pode elevar máximos de Vida/Mana; cura e regeneração respeitam esses máximos efetivos. Este trabalho preserva dano, cadência e munição das armas.

As básicas ativas usam cooldown de 7–24s. Supremos usam 85–110s. Passivas não gastam Mana nem ocupam a execução manual. Apenas Meteoro Solar possui dano direto de magia (35); seu principal resultado é expulsar inimigos de posições com aviso prévio e empurrão.

Restrições compartilhadas ficam em `ABILITY_RULES`: uma passiva por build, velocidade máxima ×1,3, slow mínimo ×0,3, controle forte até 800ms e recuperação de 1000ms, mínimo de debuff 150ms. Entidades têm teto global 128 e 24 por conjurador; rastros usam amostras de 500ms por 8s, com até 160 pontos; voo tem altura máxima 18m; empurrões são limitados a velocidade 18m/s.

Distância de empurrão é aproximada e depende do controlador/colisões: Anel utiliza impulso tangencial 10m/s, Meteoro 7m/s, Arrastão 15m/s e Maré 12m/s. O controlador radial resolve paredes e terreno. Ajustar esses valores nos dados após medir distância em superfícies diferentes; não prometer deslocamento exato contra obstáculos.

Não há resistência geral à Tormenta. Cura continua limitada por Vida máxima e defesa temporária não absorve o dano ambiental que ignora escudos.
