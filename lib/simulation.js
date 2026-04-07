"use strict";

const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const CROPS = {
  tomato: {
    name: "Tomato",
    emoji: "🍅",
    soil: "Well-drained soil",
    climate: "Warm daylight crop",
    waterNeed: "Moderate water",
    temperatureRange: [20, 30],
    moistureRange: [45, 68],
    waterBoost: 18,
    fertilizerDays: [6, 13, 20, 27],
    knowledge: [
      "Requires well-drained soil.",
      "Needs moderate water, not excessive soaking.",
      "Requires full sunlight for 6-8 hours.",
      "Ideal temperature stays between 20-30°C.",
      "Avoid overwatering because roots can suffer.",
      "Use organic compost for better growth.",
      "Keep proper spacing between plants.",
      "Monitor pests because tomato is sensitive.",
      "Regular pruning improves yield.",
      "Flowering stage needs extra care.",
      "Avoid water stagnation around roots.",
      "Harvest after fruits turn fully red."
    ]
  },
  rice: {
    name: "Rice",
    emoji: "🌾",
    soil: "Clayey, water-retentive soil",
    climate: "High-water field crop",
    waterNeed: "High water availability",
    temperatureRange: [25, 35],
    moistureRange: [62, 88],
    waterBoost: 14,
    fertilizerDays: [5, 11, 18, 25],
    knowledge: [
      "Requires high water availability.",
      "Grows well in flooded fields.",
      "Needs clayey soil for water retention.",
      "Ideal temperature stays between 25-35°C.",
      "Requires consistent irrigation.",
      "Transplanting is a common method.",
      "Proper field leveling is important.",
      "Sensitive to drought conditions.",
      "Nitrogen fertilizers support growth.",
      "Weed control is essential.",
      "Harvest when grains fully mature.",
      "Needs standing water in early stages."
    ]
  },
  sugarcane: {
    name: "Sugarcane",
    emoji: "🎋",
    soil: "Loamy soil",
    climate: "Warm, long-duration crop",
    waterNeed: "Consistent watering",
    temperatureRange: [24, 34],
    moistureRange: [52, 74],
    waterBoost: 16,
    fertilizerDays: [7, 14, 21, 28],
    knowledge: [
      "Requires a warm climate.",
      "Needs a long growing duration.",
      "Requires consistent watering.",
      "Grows well in loamy soil.",
      "Needs good sunlight.",
      "Requires proper spacing.",
      "Fertilizer improves yield.",
      "Avoid waterlogging.",
      "Needs weed control.",
      "Takes months to mature.",
      "Requires periodic irrigation.",
      "Harvest when stems are thick."
    ]
  }
};

const AGENT_BRIEF = {
  objective: "Maximize crop health and final yield over a 30-day growth cycle.",
  environmentOverview: [
    "Observe soil moisture level each day.",
    "Observe temperature changes across the episode.",
    "Track crop health and day number.",
    "Adapt the decision to the current crop type: Tomato, Rice, or Sugarcane."
  ],
  availableActions: [
    {
      id: "water",
      label: "Water",
      effect: "Increases soil moisture."
    },
    {
      id: "fertilize",
      label: "Fertilize",
      effect: "Improves crop growth when timing is appropriate."
    },
    {
      id: "do_nothing",
      label: "Do nothing",
      effect: "Leaves the field unchanged for the day."
    }
  ],
  rules: [
    "Each action affects the environment state.",
    "Overwatering can damage the crop.",
    "Low moisture can reduce crop health.",
    "Temperature and weather may change daily.",
    "Different crops have different requirements."
  ],
  rewards: [
    "Maintain optimal soil moisture for positive reward.",
    "Improve crop health for positive reward.",
    "Overwatering or poor decisions create negative reward.",
    "Crop damage leads to heavy penalties."
  ],
  episode: {
    totalDays: 30,
    stepDescription: "Each day is one decision step.",
    endCondition: "The episode ends after Day 30."
  },
  strategyGuidelines: [
    "Maintain balance between moisture and crop needs.",
    "Avoid extreme conditions that are too dry or too wet.",
    "Adapt decisions based on crop type.",
    "Learn from rewards to improve future actions."
  ],
  finalGoal: [
    "Maximize final crop health.",
    "Maximize total accumulated reward.",
    "Keep decisions stable across the season."
  ],
  successCriteria: {
    target: ["🌟 Excellent Crop", "👍 Good Crop"],
    avoid: ["❌ Poor Crop"]
  },
  decisionLoop: [
    "Observe the current state.",
    "Choose the best action.",
    "Maximize long-term reward.",
    "Achieve the best possible crop outcome."
  ]
};

const AI_ACTIONS = ["water", "fertilize", "do_nothing"];
const AI_MODEL_PATH = path.join(__dirname, "..", "artifacts", "q_table.json");
const HUMAN_DATA_PATH = path.join(__dirname, "..", "artifacts", "human_play_sessions.jsonl");
let cachedAiPolicy = undefined;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pseudoWave(seed, day, scale) {
  return Math.sin((day + seed) * 0.82) * scale + Math.cos((day + seed * 2) * 0.37) * (scale * 0.4);
}

function getDailyTemperature(cropId, day) {
  const crop = CROPS[cropId];
  const [low, high] = crop.temperatureRange;
  const midpoint = (low + high) / 2;
  return Math.round(clamp(midpoint + pseudoWave(cropId.length, day, 4.2), 18, 38));
}

function getOvernightMoistureLoss(temp, day, cropId) {
  const crop = CROPS[cropId];
  const heatStress = Math.max(0, temp - crop.temperatureRange[1]) * 0.7;
  return Math.round(6 + Math.abs(pseudoWave(day, cropId.length, 2.4)) + heatStress);
}

function getGrowthHint(crop, day) {
  return crop.knowledge[(day - 1) % crop.knowledge.length];
}

function cloneSimulationState(simulation) {
  return JSON.parse(JSON.stringify(simulation));
}

function toLoggedState(simulation) {
  return {
    day: simulation.day,
    cropId: simulation.cropId,
    score: simulation.score,
    cropHealth: simulation.cropHealth,
    moisture: simulation.moisture,
    temperature: simulation.temperature,
    status: simulation.status
  };
}

function getAgentBrief() {
  return JSON.parse(JSON.stringify(AGENT_BRIEF));
}

function normalizeAction(action) {
  if (action === "wait") {
    return "do_nothing";
  }

  return action;
}

function getActionLabel(action) {
  const normalizedAction = normalizeAction(action);
  const match = AGENT_BRIEF.availableActions.find((item) => item.id === normalizedAction);
  return match ? match.label : normalizedAction;
}

function bucketMoisture(simulation) {
  const [low, high] = CROPS[simulation.cropId].moistureRange;

  if (simulation.moisture < low - 10) {
    return "very_dry";
  }

  if (simulation.moisture < low) {
    return "dry";
  }

  if (simulation.moisture <= high) {
    return "optimal";
  }

  if (simulation.moisture <= high + 12) {
    return "wet";
  }

  return "waterlogged";
}

function bucketTemperature(simulation) {
  const [low, high] = CROPS[simulation.cropId].temperatureRange;

  if (simulation.temperature < low) {
    return "cool";
  }

  if (simulation.temperature > high) {
    return "hot";
  }

  return "ideal";
}

function bucketHealth(simulation) {
  if (simulation.cropHealth < 45) {
    return "critical";
  }

  if (simulation.cropHealth < 65) {
    return "weak";
  }

  if (simulation.cropHealth < 85) {
    return "stable";
  }

  return "strong";
}

function encodeSimulationState(simulation) {
  const fertilizerDue = CROPS[simulation.cropId].fertilizerDays.includes(simulation.day) ? "due" : "wait";

  return [
    `crop=${simulation.cropId}`,
    `day=${String(simulation.day).padStart(2, "0")}`,
    `moisture=${bucketMoisture(simulation)}`,
    `temp=${bucketTemperature(simulation)}`,
    `health=${bucketHealth(simulation)}`,
    `fertilizer=${fertilizerDue}`
  ].join("|");
}

function loadAiPolicy() {
  if (cachedAiPolicy !== undefined) {
    return cachedAiPolicy;
  }

  try {
    cachedAiPolicy = JSON.parse(fs.readFileSync(AI_MODEL_PATH, "utf8"));
  } catch (error) {
    cachedAiPolicy = null;
  }

  return cachedAiPolicy;
}

function appendHumanDecision(record) {
  try {
    fs.mkdirSync(path.dirname(HUMAN_DATA_PATH), { recursive: true });
    fs.appendFileSync(HUMAN_DATA_PATH, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    // Human-data collection should not block the gameplay flow.
  }
}

function getHumanDataStats() {
  try {
    const raw = fs.readFileSync(HUMAN_DATA_PATH, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      return {
        path: HUMAN_DATA_PATH,
        entries: 0,
        lastTimestamp: null
      };
    }

    const last = JSON.parse(lines[lines.length - 1]);
    return {
      path: HUMAN_DATA_PATH,
      entries: lines.length,
      lastTimestamp: last.timestamp || null
    };
  } catch (error) {
    return {
      path: HUMAN_DATA_PATH,
      entries: 0,
      lastTimestamp: null
    };
  }
}

function recordHumanDecision({ mode, action, before, after, recommendation, comparisonId = null }) {
  appendHumanDecision({
    timestamp: new Date().toISOString(),
    mode,
    comparisonId,
    cropId: before.cropId,
    action: normalizeAction(action),
    recommendationAction: recommendation ? recommendation.action : null,
    matchedRecommendation: recommendation ? normalizeAction(action) === recommendation.action : null,
    scoreDelta: after.lastActionSummary ? after.lastActionSummary.scoreDelta : null,
    notes: after.lastActionSummary ? after.lastActionSummary.notes : [],
    before: toLoggedState(before),
    after: toLoggedState(after)
  });
}

function getRecommendation(crop, day, moisture, temperature) {
  const [moistureLow, moistureHigh] = crop.moistureRange;
  const fertilizerDue = crop.fertilizerDays.includes(day);

  if (moisture < moistureLow - 10) {
    return {
      action: "water",
      label: "Water",
      reason: `${crop.name} is under-watered today. Recover soil moisture before stress lowers crop health.`
    };
  }

  if (fertilizerDue && moisture >= moistureLow - 4) {
    return {
      action: "fertilize",
      label: "Fertilize",
      reason: `Day ${day} lines up with a nutrient push. Fertilizer is safest while moisture is stable.`
    };
  }

  if (moisture > moistureHigh + 8) {
    return {
      action: "do_nothing",
      label: "Do nothing",
      reason: "Moisture is already high, so extra water would increase the risk of root damage or waterlogging."
    };
  }

  if (temperature > crop.temperatureRange[1]) {
    return {
      action: "water",
      label: "Water",
      reason: "The day is running hot. A controlled watering helps buffer heat-driven moisture loss."
    };
  }

  return {
    action: "do_nothing",
    label: "Do nothing",
    reason: "Current farm conditions are close to the target range, so preserving balance is the best move."
  };
}

function chooseAiAction(simulation) {
  const stateKey = encodeSimulationState(simulation);
  const policy = loadAiPolicy();
  const qValues = policy && policy.qTable ? policy.qTable[stateKey] : null;

  if (qValues) {
    let bestAction = AI_ACTIONS[0];
    let bestValue = Number(qValues[bestAction] ?? 0);

    AI_ACTIONS.slice(1).forEach((action) => {
      const value = Number(qValues[action] ?? 0);
      if (value > bestValue) {
        bestValue = value;
        bestAction = action;
      }
    });

    return {
      action: bestAction,
      label: getActionLabel(bestAction),
      source: "q_table",
      stateKey,
      qValue: bestValue
    };
  }

  const recommendation = getRecommendation(
    CROPS[simulation.cropId],
    simulation.day,
    simulation.moisture,
    simulation.temperature
  );

  return {
    action: recommendation.action,
    label: recommendation.label,
    source: "fallback",
    stateKey,
    qValue: null
  };
}

function getOutcome(score, cropHealth, crop) {
  const combined = score + cropHealth;

  if (combined >= 230) {
    return {
      badge: "🌟 Excellent Crop",
      summary: `${crop.name} finished strong with stable care, healthy growth, and high-yield decisions across the 30-day cycle.`
    };
  }

  if (combined >= 170) {
    return {
      badge: "👍 Good Crop",
      summary: `${crop.name} performed well overall. A few decisions were inefficient, but the crop stayed productive.`
    };
  }

  if (combined >= 110) {
    return {
      badge: "⚠️ Average Crop",
      summary: `${crop.name} survived the season, but inconsistent choices limited final performance and resilience.`
    };
  }

  return {
    badge: "❌ Poor Crop",
    summary: `${crop.name} struggled through the cycle. Moisture, nutrient timing, or temperature stress reduced the result sharply.`
  };
}

function publicCrop(cropId) {
  return {
    id: cropId,
    ...CROPS[cropId]
  };
}

function listCrops() {
  return Object.keys(CROPS).map(publicCrop);
}

function getCrop(cropId) {
  if (!CROPS[cropId]) {
    return null;
  }

  return publicCrop(cropId);
}

function createSimulation(cropId) {
  const crop = CROPS[cropId];
  if (!crop) {
    throw new Error("Unknown crop");
  }

  const [moistureLow, moistureHigh] = crop.moistureRange;

  return {
    id: randomUUID(),
    cropId,
    status: "active",
    day: 1,
    score: 0,
    cropHealth: 82,
    moisture: Math.round((moistureLow + moistureHigh) / 2),
    temperature: getDailyTemperature(cropId, 1),
    history: [],
    lastActionSummary: null
  };
}

function serializeSimulation(simulation) {
  const crop = CROPS[simulation.cropId];
  const response = {
    id: simulation.id,
    status: simulation.status,
    day: simulation.day,
    totalDays: 30,
    score: simulation.score,
    cropHealth: simulation.cropHealth,
    moisture: simulation.moisture,
    temperature: simulation.temperature,
    progressPercent: (simulation.day / 30) * 100,
    crop: publicCrop(simulation.cropId),
    agentBrief: getAgentBrief(),
    growthHint: getGrowthHint(crop, simulation.day),
    recommendation: getRecommendation(crop, simulation.day, simulation.moisture, simulation.temperature),
    history: simulation.history,
    lastActionSummary: simulation.lastActionSummary,
    outcome: null
  };

  if (simulation.status === "complete") {
    response.outcome = getOutcome(simulation.score, simulation.cropHealth, crop);
  }

  return response;
}

function applyAction(simulation, action) {
  if (simulation.status === "complete") {
    throw new Error("Simulation is already complete");
  }

  const normalizedAction = normalizeAction(action);
  const crop = CROPS[simulation.cropId];
  const [moistureLow, moistureHigh] = crop.moistureRange;
  const [tempLow, tempHigh] = crop.temperatureRange;
  let moistureAfterAction = simulation.moisture;
  let scoreDelta = 0;
  let healthDelta = 0;
  const notes = [];

  if (normalizedAction === "water") {
    moistureAfterAction += crop.waterBoost;
    if (simulation.moisture < moistureLow) {
      scoreDelta += 10;
      healthDelta += 5;
      notes.push("Watering corrected a dry root zone.");
    } else if (simulation.moisture > moistureHigh) {
      scoreDelta -= 10;
      healthDelta -= 7;
      notes.push("Watering on already wet soil caused stress.");
    } else {
      scoreDelta += 4;
      healthDelta += 1;
      notes.push("Watering kept moisture available for growth.");
    }
  } else if (normalizedAction === "fertilize") {
    if (crop.fertilizerDays.includes(simulation.day) && simulation.moisture >= moistureLow - 3) {
      scoreDelta += 10;
      healthDelta += 6;
      notes.push("Fertilizer timing matched crop demand.");
    } else if (simulation.moisture < moistureLow - 6) {
      scoreDelta -= 8;
      healthDelta -= 5;
      notes.push("Fertilizer on dry soil added nutrient stress.");
    } else {
      scoreDelta -= 3;
      notes.push("Fertilizer helped a little, but timing was inefficient.");
    }
  } else if (normalizedAction === "do_nothing") {
    if (simulation.moisture >= moistureLow && simulation.moisture <= moistureHigh) {
      scoreDelta += 5;
      healthDelta += 2;
      notes.push("Holding steady preserved good field balance.");
    } else {
      scoreDelta -= 5;
      healthDelta -= 3;
      notes.push("No action allowed the imbalance to continue.");
    }
  } else {
    throw new Error("Unknown action");
  }

  if (moistureAfterAction >= moistureLow && moistureAfterAction <= moistureHigh) {
    scoreDelta += 5;
    healthDelta += 3;
    notes.push("Soil moisture stayed in the target range.");
  } else if (moistureAfterAction < moistureLow - 10 || moistureAfterAction > moistureHigh + 12) {
    scoreDelta -= 10;
    healthDelta -= 7;
    notes.push("Moisture moved too far from the crop's comfort zone.");
  } else {
    scoreDelta -= 4;
    healthDelta -= 2;
    notes.push("Moisture is usable, but not optimal.");
  }

  if (simulation.temperature >= tempLow && simulation.temperature <= tempHigh) {
    scoreDelta += 2;
    notes.push("Temperature supported healthy crop activity.");
  } else {
    scoreDelta -= 6;
    healthDelta -= 4;
    notes.push("Temperature stress reduced crop efficiency.");
  }

  simulation.score += scoreDelta;
  simulation.cropHealth = clamp(simulation.cropHealth + healthDelta, 0, 100);

  const logEntry = {
    day: simulation.day,
    action: normalizedAction,
    actionLabel: getActionLabel(normalizedAction),
    scoreDelta,
    healthAfter: simulation.cropHealth,
    moistureAfterAction: clamp(Math.round(moistureAfterAction), 0, 100),
    notes
  };

  simulation.lastActionSummary = logEntry;
  simulation.history = [logEntry, ...simulation.history];

  if (simulation.day === 30) {
    simulation.moisture = logEntry.moistureAfterAction;
    simulation.status = "complete";
    return simulation;
  }

  const nextDay = simulation.day + 1;
  const overnightLoss = getOvernightMoistureLoss(simulation.temperature, simulation.day, simulation.cropId);
  const naturalRecovery = nextDay % 7 === 0 ? 4 : 0;

  simulation.day = nextDay;
  simulation.temperature = getDailyTemperature(simulation.cropId, nextDay);
  simulation.moisture = clamp(logEntry.moistureAfterAction - overnightLoss + naturalRecovery, 0, 100);

  return simulation;
}

function summarizeRoundHistory(rounds) {
  const manualWins = rounds.filter((entry) => entry.swing > 0).length;
  const aiWins = rounds.filter((entry) => entry.swing < 0).length;
  const ties = rounds.length - manualWins - aiWins;

  return {
    manualWins,
    aiWins,
    ties
  };
}

function runSimulation(mode, cropId, options = {}) {
  const simulation = createSimulation(cropId);
  const steps = [];

  while (simulation.status !== "complete") {
    let action;

    if (mode === "human") {
      if (typeof options.actionProvider === "function") {
        action = options.actionProvider(serializeSimulation(simulation), simulation.day);
      } else if (Array.isArray(options.actions)) {
        action = options.actions[simulation.day - 1];
      } else {
        throw new Error("Human simulation requires an actionProvider or actions array");
      }
    } else if (mode === "ai") {
      action = chooseAiAction(simulation).action;
    } else {
      throw new Error("Unknown simulation mode");
    }

    applyAction(simulation, action);
    steps.push({
      day: simulation.lastActionSummary.day,
      action: simulation.lastActionSummary.action,
      reward: simulation.lastActionSummary.scoreDelta,
      state: {
        day: simulation.day,
        moisture: simulation.moisture,
        temperature: simulation.temperature,
        cropHealth: simulation.cropHealth,
        score: simulation.score,
        status: simulation.status
      }
    });
  }

  return {
    totalScore: simulation.score,
    steps,
    simulation: serializeSimulation(simulation)
  };
}

function createComparison(cropId) {
  return {
    id: randomUUID(),
    cropId,
    status: "active",
    human: createSimulation(cropId),
    ai: createSimulation(cropId),
    rounds: [],
    lastRound: null
  };
}

function applyComparisonAction(comparison, humanAction) {
  if (comparison.status === "complete") {
    throw new Error("Comparison is already complete");
  }

  const humanSnapshot = cloneSimulationState(comparison.human);
  const humanRecommendation = getRecommendation(
    CROPS[humanSnapshot.cropId],
    humanSnapshot.day,
    humanSnapshot.moisture,
    humanSnapshot.temperature
  );
  const aiPreviewDecision = chooseAiAction(humanSnapshot);
  const aiPreviewSimulation = cloneSimulationState(humanSnapshot);
  const aiSeasonDecision = chooseAiAction(comparison.ai);

  applyAction(aiPreviewSimulation, aiPreviewDecision.action);
  applyAction(comparison.human, humanAction);
  applyAction(comparison.ai, aiSeasonDecision.action);

  recordHumanDecision({
    mode: "human-vs-ai",
    action: humanAction,
    before: humanSnapshot,
    after: comparison.human,
    recommendation: humanRecommendation,
    comparisonId: comparison.id
  });

  const round = {
    day: humanSnapshot.day,
    humanAction: getActionLabel(humanAction),
    humanActionId: normalizeAction(humanAction),
    humanDelta: comparison.human.lastActionSummary.scoreDelta,
    humanReason: comparison.human.lastActionSummary.notes[0],
    aiAction: aiPreviewDecision.label,
    aiActionId: aiPreviewDecision.action,
    aiPreviewDelta: aiPreviewSimulation.lastActionSummary.scoreDelta,
    aiPreviewReason: aiPreviewSimulation.lastActionSummary.notes[0],
    aiSeasonDelta: comparison.ai.lastActionSummary.scoreDelta,
    aiSeasonReason: comparison.ai.lastActionSummary.notes[0],
    recommendationReason: humanRecommendation.reason,
    aiSource: aiPreviewDecision.source,
    matchedRecommendation: normalizeAction(humanAction) === humanRecommendation.action,
    swing: comparison.human.lastActionSummary.scoreDelta - aiPreviewSimulation.lastActionSummary.scoreDelta
  };

  comparison.lastRound = round;
  comparison.rounds = [round, ...comparison.rounds];

  if (comparison.human.status === "complete" && comparison.ai.status === "complete") {
    comparison.status = "complete";
  }

  return comparison;
}

function serializeComparison(comparison) {
  return {
    id: comparison.id,
    status: comparison.status,
    cropId: comparison.cropId,
    simulation: serializeSimulation(comparison.human),
    aiSimulation: serializeSimulation(comparison.ai),
    lastComparison: comparison.lastRound,
    comparisonHistory: comparison.rounds,
    summary: summarizeRoundHistory(comparison.rounds)
  };
}

module.exports = {
  getAgentBrief,
  listCrops,
  getCrop,
  chooseAiAction,
  createSimulation,
  serializeSimulation,
  applyAction,
  cloneSimulationState,
  recordHumanDecision,
  getHumanDataStats,
  runSimulation,
  createComparison,
  applyComparisonAction,
  serializeComparison
};
