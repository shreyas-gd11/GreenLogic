"use strict";

const { FarmEnvironment } = require("./farm");
const { getCrop } = require("./crops");

function run() {
  const requestedCropType = process.argv[2] || "tomato";
  const crop = getCrop(requestedCropType);

  if (!crop) {
    console.error(`Invalid crop type: ${requestedCropType}`);
    console.error("Use one of: tomato, rice, sugarcane");
    process.exit(1);
  }

  const environment = new FarmEnvironment({ cropType: requestedCropType });
  const episode = environment.runEpisode({ mode: "learning" });

  console.log("Soilixa OpenEnv Baseline Inference");
  console.log(`Crop: ${episode.cropType}`);
  console.log(`Score: ${episode.finalScore}`);
  console.log(`Normalized Score: ${episode.normalizedScore.toFixed(2)}`);
  console.log(`Result: ${episode.result}`);
}

run();
