"use strict";

const readline = require("readline");
const { FarmEnvironment } = require("./farm");
const { getCrop } = require("./crops");

const AVAILABLE_CROPS = ["rice", "tomato", "sugarcane"];

function formatReward(reward) {
  return reward >= 0 ? `+${reward}` : `${reward}`;
}

function formatAction(action) {
  if (action === "water") {
    return "WATER";
  }

  if (action === "fertilize") {
    return "FERTILIZE";
  }

  return "DO NOTHING";
}

function promptForCrop() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const options = AVAILABLE_CROPS.map((crop, index) => `${index + 1}. ${crop}`).join("\n");

  return new Promise((resolve) => {
    rl.question(`Choose a crop for the simulator:\n${options}\n> `, (answer) => {
      rl.close();

      const trimmedAnswer = answer.trim().toLowerCase();
      const selectedByIndex = AVAILABLE_CROPS[Number(trimmedAnswer) - 1];
      const selectedCrop = selectedByIndex || (AVAILABLE_CROPS.includes(trimmedAnswer) ? trimmedAnswer : null);

      resolve(selectedCrop);
    });
  });
}

async function run() {
  let requestedCropType = process.argv[2] || null;
  const requestedMode = process.argv[3] || "explain";

  if (!requestedCropType) {
    requestedCropType = await promptForCrop();
  }

  const crop = requestedCropType ? getCrop(requestedCropType) : null;

  if (!requestedCropType || !crop) {
    console.error(`Invalid crop type: ${requestedCropType}`);
    console.error("Use one of: rice, tomato, sugarcane");
    process.exit(1);
  }

  if (requestedMode !== "learning" && requestedMode !== "explain") {
    console.error(`Invalid mode: ${requestedMode}`);
    console.error("Use one of: learning, explain");
    process.exit(1);
  }

  const environment = new FarmEnvironment({ cropType: requestedCropType });
  const episode = environment.runEpisode({ mode: requestedMode });

  console.log("GreenLogic CLI");
  console.log(`Crop: ${episode.cropType}`);
  console.log(`Mode: ${episode.mode}`);
  console.log("----------------------");

  for (const step of episode.steps) {
    console.log(`Day ${step.day}`);
    console.log(
      `Moisture: ${Math.round(step.state.soilMoisture)} | Temp: ${step.state.temperature} | Health: ${step.state.cropHealth}`
    );
    console.log(`AI Action: ${formatAction(step.aiAction)} ${step.isCorrect ? "OK" : "X"}`);
    console.log(`Environment: ${step.environment}`);
    console.log(`Reward: ${formatReward(step.reward)}`);

    if (episode.mode === "explain" && !step.isCorrect) {
      console.log(`Mistake: ${step.reason}`);
      console.log(`Correct Action: ${formatAction(step.correctAction)}`);
      console.log(`Explanation: ${step.explanation}`);
    }

    console.log("----------------------");
  }

  console.log("Simulation Complete");
  console.log(`Final Score: ${episode.finalScore}`);
  console.log(`Normalized Score: ${episode.normalizedScore.toFixed(2)}`);
  console.log(`Result: ${episode.result}`);
}

run();
