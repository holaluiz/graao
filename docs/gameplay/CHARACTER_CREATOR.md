# Character creator

Realtime Three.js character + DOM panel (`apps/client/src/ui/Creator.ts`).

- Tabs: Body (+ skin), Face, Hair (+ hair color), Top (+ color), Bottom (+ color), Shoes (+ color), Extra.
- "Surprise me" randomizes. Drag on the character rotates it, the wheel zooms.
- Every change is instant: parts rebuild from cached geometry (merge only); colors are palette updates.
- Appearance persists in localStorage today (Supabase later) and replicates to the room (`APPEARANCE_UPDATE`).

Content: 2 bodies, 3 faces, 6 skin tones, 4 hairstyles, 8 hair colors, 4 tops, 4 bottoms, 3 shoes, 12 fabric colors,
3 accessories + none. Target time for a first character: 30–90 s.
