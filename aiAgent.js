"use strict";

const fs = require("fs");
const path = require("path");
const { getCrop } = require("./crops");
const { getCorrectAction, getReason, getThresholds } = require("./envRules");

const ACTIONS = ["water", "fertilize", "do_nothing"];
const Q_TABLE_PATH = path.join(__dirname, "artifacts", "q_table.json");

let cachedQTable = null;
let qTableLoaded = false;

function loadQTable() {
  if (qTableLoaded) {
    return cachedQTable;
  }

  qTableLoaded = true;

  try {
    const raw = fs.readFileSync(Q_TABLE_PATH, "utf8");
    const payload = JSON.parse(raw);
    cachedQTable = payload.qTable || null;
  } catch (error) {
    cachedQTable = null;
  }

  return cachedQTable;
}

function bucketMoisture(state, cropRules) {
  const [low, high] = cropRules.moistureRange || [cropRules.optimalMoisture - 15, cropRules.maxMoisture - 10];

  if (state.soilMoisture < low - 10) {
    return "very_dry";
  }

  if (state.soilMoisture < low) {
    return "dry";
  }

  if (state.soilMoisture <= high) {
    return "optimal";
  }

  if (state.soilMoisture <= high + 12) {
    return "wet";
  }

  return "waterlogged";
}

function bucketTemperature(state, cropRules) {
  const [low, high] = cropRules.temperatureRange || [25, 35];

  if (state.temperature < low) {
    return "cool";
  }

  if (state.temperature > high) {
    return "hot";
  }

  return "ideal";
}

function bucketHealth(state) {
  if (state.cropHealth < 45) {
    return "critical";
  }

  if (state.cropHealth < 65) {
    return "weak";
  }

  if (state.cropHealth < 85) {
    return "stable";
  }

  return "strong";
}

function encodeStateForQTable(state, cropRules) {
  const fertilizerDue = cropRules.fertilizerDays && cropRules.fertilizerDays.includes(state.day) ? "due" : "wait";

  return [
    `crop=${state.cropType}`,
    `day=${String(state.day).padStart(2, "0")}`,
    `moisture=${bucketMoisture(state, cropRules)}`,
    `temp=${bucketTemperature(state, cropRules)}`,
    `health=${bucketHealth(state)}`,
    `fertilizer=${fertilizerDue}`
  ].join("|");
}

function getBestQTableAction(state, cropRules) {
  const qTable = loadQTable();
  if (!qTable) {
    return null;
  }

  const stateKey = encodeStateForQTable(state, cropRules);
  const values = qTable[stateKey];
  if (!values) {
    return null;
  }

  let bestAction = ACTIONS[0];
  let bestValue = Number(values[bestAction] ?? 0);

  for (const action of ACTIONS.slice(1)) {
    const value = Number(values[action] ?? 0);
    if (value > bestValue) {
      bestValue = value;
      bestAction = action;
    }
  }

  return {
    action: bestAction,
    source: "q_table",
    stateKey,
    qValue: bestValue
  };
}

function applySafetyRules(state, cropRules, decision) {
  const thresholds = getThresholds(cropRules);
  const correctAction = getCorrectAction(state, thresholds);

  if (state.soilMoisture > thresholds.high && decision.action !== "do_nothing") {
    return {
      action: "do_nothing",
      source: "safety_override",
      stateKey: decision.stateKey,
      qValue: decision.qValue
    };
  }

  if (decision.action === "water" && state.soilMoisture >= thresholds.low) {
    return {
      action: correctAction,
      source: "safety_override",
      stateKey: decision.stateKey,
      qValue: decision.qValue
    };
  }

  if (decision.action === "fertilize" && state.cropHealth >= 60) {
    return {
      action: correctAction,
      source: "safety_override",
      stateKey: decision.stateKey,
      qValue: decision.qValue
    };
  }

  return decision;
}

function decideActionWithDetails(state) {
  const crop = getCrop(state.cropType);
  if (!crop) {
    return {
      action: "do_nothing",
      source: "fallback",
      stateKey: null,
      qValue: null
    };
  }

  const qTableDecision = getBestQTableAction(state, crop);
  if (qTableDecision) {
    return applySafetyRules(state, crop, qTableDecision);
  }

  return applySafetyRules(state, crop, {
    action: getCorrectAction(state, getThresholds(crop)),
    source: "heuristic",
    stateKey: null,
    qValue: null
  });
}

function decideAction(state) {
  return decideActionWithDetails(state).action;
}

module.exports = {
  decideAction,
  decideActionWithDetails,
  getCorrectAction: (state, cropRules) => getCorrectAction(state, getThresholds(cropRules)),
  getReason: (state, cropRules) => getReason(state, getThresholds(cropRules)),
  encodeStateForQTable
};
