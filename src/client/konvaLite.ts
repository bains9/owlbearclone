// Konva with only what the board draws with. board.ts imports "konva" as usual (its types are the
// full Konva's); vite.config.ts points that import here when the page is built, so the page gets
// Konva's core (Stage, Layer, Group, Shape, Animation...) and the shapes the board makes, without
// the filters and the shapes it never uses (Path, TextPath, Transformer, Star, Wedge...): about a
// third of Konva. A shape the board starts using goes in the list below.

import { Konva as Core } from "konva/lib/_CoreInternals";
import { Circle } from "konva/lib/shapes/Circle";
import { Ellipse } from "konva/lib/shapes/Ellipse";
import { Image } from "konva/lib/shapes/Image";
import { Label, Tag } from "konva/lib/shapes/Label";
import { Line } from "konva/lib/shapes/Line";
import { Rect } from "konva/lib/shapes/Rect";
import { Text } from "konva/lib/shapes/Text";

/** The shapes the board makes, as the full Konva has them (Konva.Rect and so on). */
export const KONVA_SHAPES = { Circle, Ellipse, Image, Label, Line, Rect, Tag, Text };

const Konva = Core.Util._assign(Core, KONVA_SHAPES);
export default Konva;
