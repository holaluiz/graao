# Character creator

Realtime Three.js character + DOM panel (`apps/client/src/ui/Creator.ts`).

- Tabs (each with one or more sections): Corpo (+ tom de pele), Rosto (+ barba e bigode), Cabelo (+ cor, que também
  pinta a barba), Cima, Baixo, Calçados (cada um + cor de tecido), Chapéu (+ cor; na palha e no couro a cor vai na fita
  e nos enfeites), Acessórios (rosto e cabeça · corpo).
- "Surpreenda-me" randomizes; optional slots (barba, chapéu, acessório, extra) stay empty half of the time. Drag on the
  character rotates it, the wheel zooms, and zooming in raises the camera toward the face.
- The camera centers the character in the screen area the panel leaves free (measured from the panel's rect).
- Every change is instant: parts rebuild from cached geometry (merge only); colors are palette updates.
- Appearance persists in localStorage today (Supabase later) and replicates to the room (`APPEARANCE_UPDATE`). Saves
  from an older catalog are upgraded by `migrateAppearance` (missing slots take defaults, `acc.bag` → `extra.bag`).

Content: 2 bodies, 6 faces, 5 beards (incl. none), 8 skin tones, 14 hairstyles, 14 hair colors, 10 tops, 8 bottoms,
7 shoes, 18 fabric colors, 10 hats (incl. none), 6 face accessories (incl. none), 6 body extras (incl. none).

Brazilian pieces: camisa de time (with the 10 on the back), regata, cropped, camisa de chita, camisa xadrez de São João,
corta-vento; bermuda tactel, calça jogger, calça de capoeira (with corda), saia rodada; chinelo, sandália de couro,
chuteira, tênis de mola; chapéu de palha, chapéu de cangaceiro, chapéu de malandro, boné aba reta / pra trás, touca,
bandana, turbante, coroa de flores; black power, cacheado, tranças, dreads, raspadinho na régua, moicano; cordão
dourado, pochete, bandeira nas costas, fitinhas do Bonfim, flor no cabelo, argolas, óculos espelhado.
Target time for a first character: 30–90 s.
