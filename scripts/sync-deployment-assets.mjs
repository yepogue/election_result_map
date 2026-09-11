import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "public", "data");
const targetDir = join(projectRoot, "public", "assets", "data");
const files = ["results.csv", "district-precincts.geojson", "sources.json"];

mkdirSync(targetDir, { recursive: true });

for (const file of files) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
}

console.log(`Synced ${files.length} deployment data assets.`);
