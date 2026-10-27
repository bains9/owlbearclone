// Copied from Dungeon (src/render/library.ts) by scripts/sync-dungeon-library.mjs, Dungeon c3dcca5. Change it there and run the script again.
import type { PropDef } from "./propkit";
import { FURNITURE_PROPS } from "./props-furniture";
import { CONTAINER_PROPS } from "./props-containers";
import { KITCHEN_PROPS } from "./props-kitchen";
import { NATURE_PROPS } from "./props-nature";
import { CAMP_PROPS } from "./props-camp";
import { DUNGEON_PROPS } from "./props-dungeon";
import { LIGHT_PROPS } from "./props-light";
import { MAGIC_PROPS } from "./props-magic";
import { WORKSHOP_PROPS } from "./props-workshop";
import { SHIP_PROPS } from "./props-ship";
import { FARM_PROPS } from "./props-farm";
import { TEMPLE_PROPS } from "./props-temple";
import { ARMS_PROPS } from "./props-arms";

// The big library (27 October 2026): one file per category, each design in its variants
// (see propvariants.ts). props.ts adds these after the first 135 objects.

export const LIBRARY_PROPS: PropDef[] = [...FURNITURE_PROPS, ...CONTAINER_PROPS, ...KITCHEN_PROPS, ...NATURE_PROPS, ...CAMP_PROPS, ...DUNGEON_PROPS, ...LIGHT_PROPS, ...MAGIC_PROPS, ...WORKSHOP_PROPS, ...SHIP_PROPS, ...FARM_PROPS, ...TEMPLE_PROPS, ...ARMS_PROPS];
