/* Copy pinned Three.js modules so the Python app also works without npm or a CDN. */
import { copyFile, mkdir } from "node:fs/promises";
await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
for (const [source, target] of [
  ["build/three.module.js", "three.module.js"],
  ["build/three.core.js", "three.core.js"],
  ["examples/jsm/controls/OrbitControls.js", "OrbitControls.js"],
  ["LICENSE", "THREE-LICENSE.txt"],
]) {
  await copyFile(
    new URL(`../node_modules/three/${source}`, import.meta.url),
    new URL(`../vendor/${target}`, import.meta.url),
  );
}
