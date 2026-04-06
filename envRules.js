"use strict";

function getThresholds(cropRules) {
  return {
    optimalMin: cropRules.optimalMoisture - 5,
    optimalMax: cropRules.optimalMoisture + 5,
    low: cropRules.optimalMoisture - 10,
    high: cropRules.maxMoisture
  };
}

function getEnvironmentStatus(state, thresholds) {
  if (state.soilMoisture < thresholds.low) {
    return "Dry ⚠️";
  }

  if (state.soilMoisture > thresholds.high) {
    return "Overwatered ❌";
  }

  return "Optimal ✅";
}

function getCorrectAction(state, thresholds) {
  if (state.soilMoisture < thresholds.low) {
    return "water";
  }

  if (state.soilMoisture > thresholds.high) {
    return "do_nothing";
  }

  if (state.cropHealth < 60) {
    return "fertilize";
  }

  return "do_nothing";
}

function getReason(state, thresholds) {
  if (state.soilMoisture < thresholds.low) {
    return "Soil moisture is too low";
  }

  if (state.soilMoisture > thresholds.high) {
    return "Soil is overwatered";
  }

  if (state.cropHealth < 60) {
    return "Crop health is low";
  }

  return "Conditions are optimal";
}

function normalizeScore(score) {
  return Math.max(0, Math.min(1, score / 400));
}

module.exports = {
  getThresholds,
  getEnvironmentStatus,
  getCorrectAction,
  getReason,
  normalizeScore
};
