import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(projectRoot, "public", "data");
const targetDir = join(projectRoot, "public", "assets", "data");
const files = [
  "results.csv",
  "district-precincts.geojson",
  "sources.json",
  "election.json",
  "changelog.json",
  "precinct_demographics.csv",
  "census_block_to_precinct.csv",
  "census_block_group_precinct_crosswalk.csv",
  "census_crosswalk_qa.json",
  "census_data_dictionary.json",
  "wu_precinct_analysis.csv",
  "wu_precinct_analysis.json",
  "wu_precinct_summary.csv",
  "wu_precinct_summary.json",
  "wu_2021_to_2022_precinct_crosswalk.csv",
  "wu_analysis_qa.json",
  "wu_analysis_sources.json",
];

mkdirSync(targetDir, { recursive: true });

for (const file of files) {
  copyFileSync(join(sourceDir, file), join(targetDir, file));
}

console.log(`Synced ${files.length} deployment data assets.`);
