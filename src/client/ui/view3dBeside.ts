// Where the 3D view sits (ui/View3dLayer.tsx): over the flat map, or beside it while the GM builds
// on a screen wide enough, so what's built shows in 3D as it's put down. Kept apart from the
// components so it's tested without them.

/** The tool that keeps the 3D view when it's picked: building, to check the build by in 3D. */
export function keeps3d(tool: string): boolean {
  return tool === "build";
}

/** Whether the 3D view sits beside the flat map (building, with room for both) rather than over it. */
export function besideBuild(on: boolean, tool: string, stageNarrow: boolean): boolean {
  return on && keeps3d(tool) && !stageNarrow;
}
