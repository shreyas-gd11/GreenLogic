"use strict";

const { getCorrectAction, getEnvironmentStatus, getReason, getThresholds, normalizeScore } = require("./envRules");

function calculateReward(state, crop) {
  const thresholds = getThresholds(crop);
  let reward = 0;
  let penalized = false;

  if (state.soilMoisture < thresholds.low) {
    reward -= 10;
    penalized = true;
  } else if (state.soilMoisture > thresholds.high) {
    reward -= 10;
    penalized = true;
  } else if (
    state.soilMoisture >= thresholds.optimalMin &&
    state.soilMoisture <= thresholds.optimalMax
  ) {
    reward += 25;
  } else {
    reward += 5;
  }

  if (!penalized && state.cropHealth > 80) {
    reward += 5;
  }

  return reward;
}

function describeEnvironment(state, crop) {
  return getEnvironmentStatus(state, getThresholds(crop));
}

function evaluateDecision(state, aiAction, crop) {
  const thresholds = getThresholds(crop);
  const correctAction = getCorrectAction(state, thresholds);
  const reason = getReason(state, thresholds);
  const isCorrect = aiAction === correctAction;
  const explanation = isCorrect
    ? `AI made the correct choice because ${reason.toLowerCase()}.`
    : `AI made a mistake because ${reason.toLowerCase()}. Correct action is ${correctAction}.`;

  return {
    correctAction,
    isCorrect,
    reason,
    explanation
  };
}

function gradeScore(score) {
  if (score > 200) {
    return "Excellent Crop";
  }

  if (score >= 120) {
    return "Good Crop";
  }

  if (score >= 60) {
    return "Average Crop";
  }

  return "Poor Crop";
}

module.exports = {
  calculateReward,
  describeEnvironment,
  gradeScore,
  evaluateDecision,
  normalizeScore
};
