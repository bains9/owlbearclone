# NPC token icons

From game-icons.net, licensed CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
Downloaded 2026-10-03 with Par's permission, as black-on-transparent SVGs (`scripts/npc-icons/svg/`, named author_icon.svg). `scripts/npc-icons/list.tsv` maps each race and class from the group's own campaign handbook to its icon (author_icon), its colour (a race's head tint, or a class's ring and badge colour), its D&D size (races) and its group. `scripts/npc-icons.mjs` turns the table into `table.ts` here (the races and classes) and the icons into `icons.ts`; the rules are in `npcs.ts`, and the token art (`art.ts`) draws a race's head in its tint on a dark disc, with a ring and a badge in the class's colour and the class's emblem drawn dark on the badge.

The player characters' full-body figures (`figure` lines in list.tsv; `pcArt.ts` draws them in the race's tint with a rim in the class's colour) were downloaded on 2026-10-28 with Par's permission, the same way: cathelineau/swordman, cathelineau/swordwoman, darkzaitzev/running-ninja, darkzaitzev/hooded-assassin, lorc/bowman, lorc/embrassed-energy, lorc/fire-silhouette, lorc/meditation, delapouite/sun-priest, delapouite/fencer and delapouite/high-kick.

Authors: Delapouite, Lorc, Cathelineau, Caro Asercion, DarkZaitzev (https://game-icons.net).

Each icon's page is https://game-icons.net/1x1/<author>/<icon>.html, with the author/icon from list.tsv (the `source` field in `icons.ts`).
