// Reach profiles of Dungeondraft's default sprites by short name (design 2.5 item 1): the priors
// that measureObjects starts from. Seeded by WP8 from a hand check of about 20 instances (never
// from the measurement's own output), then extended by scripts/dd/measure-sprites.ts over the
// sample pairs. A name missing here uses its role's ROLE_RADIUS as a circle.

import type { SpriteSizes } from "./measure";

/** No prototype, so a name from a file such as "constructor" finds nothing. */
export const SPRITE_SIZES: SpriteSizes = Object.freeze(Object.create(null) as SpriteSizes);
