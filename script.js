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

const STAGES = ["start", "crop", "guide", "simulation", "result"];
const STAGE_TITLES = {
  start: "Start",
  crop: "Crop Selection",
  guide: "Crop Guide",
  simulation: "Simulation",
  result: "Final Result"
};

const app = document.getElementById("app");
const stageLabel = document.getElementById("stageLabel");
const progressSteps = [...document.querySelectorAll(".progress-step")];

const state = {
  stage: "start",
  selectedCropId: null,
  day: 1,
  score: 0,
  cropHealth: 82,
  moisture: 50,
  temperature: 26,
  history: [],
  lastActionSummary: null
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSelectedCrop() {
  return CROPS[state.selectedCropId];
}

function updateStageUI() {
  stageLabel.textContent = STAGE_TITLES[state.stage];
  progressSteps.forEach((step, index) => {
    const currentIndex = STAGES.indexOf(state.stage);
    step.classList.toggle("active", currentIndex === index);
    step.classList.toggle("complete", currentIndex > index);
  });
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

function getRecommendation(crop, day, moisture, temperature) {
  const [moistureLow, moistureHigh] = crop.moistureRange;
  const fertilizerDue = crop.fertilizerDays.includes(day);

  if (moisture < moistureLow - 10) {
    return {
      action: "Water",
      reason: `${crop.name} is under-watered today. Recover soil moisture before stress lowers crop health.`
    };
  }

  if (fertilizerDue && moisture >= moistureLow - 4) {
    return {
      action: "Add fertilizer",
      reason: `Day ${day} lines up with a nutrient push. Fertilizer is safest while moisture is stable.`
    };
  }

  if (moisture > moistureHigh + 8) {
    return {
      action: "Do nothing",
      reason: "Moisture is already high, so extra water would increase the risk of root damage or waterlogging."
    };
  }

  if (temperature > crop.temperatureRange[1]) {
    return {
      action: "Water",
      reason: "The day is running hot. A controlled watering helps buffer heat-driven moisture loss."
    };
  }

  return {
    action: "Do nothing",
    reason: "Current farm conditions are close to the target range, so preserving balance is the best move."
  };
}

function resetSimulation() {
  const crop = getSelectedCrop();
  const [moistureLow, moistureHigh] = crop.moistureRange;
  state.day = 1;
  state.score = 0;
  state.cropHealth = 82;
  state.moisture = Math.round((moistureLow + moistureHigh) / 2);
  state.temperature = getDailyTemperature(state.selectedCropId, 1);
  state.history = [];
  state.lastActionSummary = null;
}

function getScoreStyling(scoreDelta) {
  return scoreDelta >= 0 ? `+${scoreDelta}` : `${scoreDelta}`;
}

function evaluateAction(action) {
  const crop = getSelectedCrop();
  const [moistureLow, moistureHigh] = crop.moistureRange;
  const [tempLow, tempHigh] = crop.temperatureRange;
  let moistureAfterAction = state.moisture;
  let scoreDelta = 0;
  let healthDelta = 0;
  const notes = [];

  if (action === "water") {
    moistureAfterAction += crop.waterBoost;
    if (state.moisture < moistureLow) {
      scoreDelta += 10;
      healthDelta += 5;
      notes.push("Watering corrected a dry root zone.");
    } else if (state.moisture > moistureHigh) {
      scoreDelta -= 10;
      healthDelta -= 7;
      notes.push("Watering on already wet soil caused stress.");
    } else {
      scoreDelta += 4;
      healthDelta += 1;
      notes.push("Watering kept moisture available for growth.");
    }
  }

  if (action === "fertilize") {
    if (crop.fertilizerDays.includes(state.day) && state.moisture >= moistureLow - 3) {
      scoreDelta += 10;
      healthDelta += 6;
      notes.push("Fertilizer timing matched crop demand.");
    } else if (state.moisture < moistureLow - 6) {
      scoreDelta -= 8;
      healthDelta -= 5;
      notes.push("Fertilizer on dry soil added nutrient stress.");
    } else {
      scoreDelta -= 3;
      notes.push("Fertilizer helped a little, but timing was inefficient.");
    }
  }

  if (action === "wait") {
    if (state.moisture >= moistureLow && state.moisture <= moistureHigh) {
      scoreDelta += 5;
      healthDelta += 2;
      notes.push("Holding steady preserved good field balance.");
    } else {
      scoreDelta -= 5;
      healthDelta -= 3;
      notes.push("No action allowed the imbalance to continue.");
    }
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

  if (state.temperature >= tempLow && state.temperature <= tempHigh) {
    scoreDelta += 2;
    notes.push("Temperature supported healthy crop activity.");
  } else {
    scoreDelta -= 6;
    healthDelta -= 4;
    notes.push("Temperature stress reduced crop efficiency.");
  }

  state.score += scoreDelta;
  state.cropHealth = clamp(state.cropHealth + healthDelta, 0, 100);

  const logEntry = {
    day: state.day,
    action,
    scoreDelta,
    healthAfter: state.cropHealth,
    moistureAfterAction: clamp(Math.round(moistureAfterAction), 0, 100),
    notes
  };

  state.lastActionSummary = logEntry;
  state.history = [logEntry, ...state.history];

  if (state.day === 30) {
    state.moisture = logEntry.moistureAfterAction;
    state.stage = "result";
    render();
    return;
  }

  const nextDay = state.day + 1;
  const overnightLoss = getOvernightMoistureLoss(state.temperature, state.day, state.selectedCropId);
  const naturalRecovery = nextDay % 7 === 0 ? 4 : 0;

  state.day = nextDay;
  state.temperature = getDailyTemperature(state.selectedCropId, nextDay);
  state.moisture = clamp(logEntry.moistureAfterAction - overnightLoss + naturalRecovery, 0, 100);

  render();
}

function getOutcome() {
  const crop = getSelectedCrop();
  const combined = state.score + state.cropHealth;

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

function renderStart() {
  app.innerHTML = `
    <div class="hero-grid">
      <article class="panel-card hero-card">
        <div class="hero-copy">
          <p class="eyebrow">Step 1</p>
          <h2>Start Your Agriculture Journey</h2>
          <p>
            Learn how real crop decisions affect farm outcomes. Soilixa OpenEnv combines crop knowledge,
            daily monitoring, and interactive choices across a 30-day guided simulation.
          </p>
        </div>
        <div class="cta-row">
          <button class="primary" data-action="go-crops">Start</button>
          <button class="secondary" data-action="preview-guide">Preview Learning Flow</button>
        </div>
      </article>

      <aside class="panel-card">
        <h3>What the system teaches</h3>
        <div class="mini-grid">
          <div class="metric">
            <span class="muted">Crop knowledge</span>
            <span class="metric-value">12 tips</span>
          </div>
          <div class="metric">
            <span class="muted">Simulation</span>
            <span class="metric-value">30 days</span>
          </div>
          <div class="metric">
            <span class="muted">Actions</span>
            <span class="metric-value">3 choices</span>
          </div>
        </div>
        <p class="support-copy">
          The platform is built around practical farming guidance first, then turns that knowledge into a decision game.
        </p>
      </aside>
    </div>
  `;
}

function renderCropSelection() {
  const cards = Object.entries(CROPS)
    .map(
      ([id, crop]) => `
        <button class="crop-card ${state.selectedCropId === id ? "selected" : ""}" data-crop="${id}">
          <div>
            <div class="crop-emoji">${crop.emoji}</div>
            <h3>${crop.name}</h3>
            <p class="muted">${crop.climate}</p>
          </div>
          <div>
            <p><strong>Soil:</strong> ${crop.soil}</p>
            <p><strong>Water:</strong> ${crop.waterNeed}</p>
            <p><strong>Ideal temperature:</strong> ${crop.temperatureRange[0]}-${crop.temperatureRange[1]}°C</p>
          </div>
        </button>
      `
    )
    .join("");

  app.innerHTML = `
    <div class="panel-card">
      <p class="eyebrow">Step 2</p>
      <h2>Select a crop to guide the simulation.</h2>
      <p class="muted">Choose the crop first. Soilixa then loads the matching farming guide and daily environmental targets.</p>

      <div class="crop-grid">${cards}</div>

      <div class="button-row" style="margin-top: 1.2rem;">
        <button class="secondary" data-action="go-start">Back</button>
        <button class="primary" data-action="go-guide" ${state.selectedCropId ? "" : "disabled"}>Continue to Crop Guide</button>
      </div>
    </div>
  `;
}

function renderGuide() {
  const crop = getSelectedCrop();
  const points = crop.knowledge
    .map(
      (item, index) => `
        <div class="guide-item">
          <div class="guide-item-number">${index + 1}</div>
          <div>${item}</div>
        </div>
      `
    )
    .join("");

  app.innerHTML = `
    <div class="guide-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 3</p>
        <h2>How to grow ${crop.name} ${crop.emoji}</h2>
        <p class="muted">Read the crop guidance first. The simulation and scoring system are based on these practical rules.</p>
        <div class="guide-list">${points}</div>
      </article>

      <aside class="panel-card">
        <h3>Crop Snapshot</h3>
        <div class="metrics-grid">
          <div class="metric">
            <span class="muted">Water</span>
            <span class="metric-value compact">${crop.waterNeed}</span>
          </div>
          <div class="metric">
            <span class="muted">Soil</span>
            <span class="metric-value compact">${crop.soil}</span>
          </div>
          <div class="metric">
            <span class="muted">Temp</span>
            <span class="metric-value compact">${crop.temperatureRange[0]}-${crop.temperatureRange[1]}°C</span>
          </div>
          <div class="metric">
            <span class="muted">Guide Points</span>
            <span class="metric-value">${crop.knowledge.length}</span>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>OpenEnv framing</h3>
          <p class="muted">
            The 30-day loop will show soil moisture, temperature, crop health, and a daily learning prompt.
            Each action changes score and final crop quality.
          </p>
        </div>

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="go-crops">Choose Another Crop</button>
          <button class="primary" data-action="start-simulation">Start Simulation</button>
        </div>
      </aside>
    </div>
  `;
}

function renderSimulation() {
  const crop = getSelectedCrop();
  const recommendation = getRecommendation(crop, state.day, state.moisture, state.temperature);
  const progress = (state.day / 30) * 100;
  const logs = state.history.length
    ? state.history
        .slice(0, 6)
        .map(
          (entry) => `
            <div class="log-item">
              <strong>Day ${entry.day} · ${entry.action.replace(/^\w/, (c) => c.toUpperCase())}</strong>
              <div class="score-chip">Score ${getScoreStyling(entry.scoreDelta)}</div>
              <p class="muted">Moisture after action: ${entry.moistureAfterAction}% · Crop health: ${entry.healthAfter}%</p>
              <p>${entry.notes[0]}</p>
            </div>
          `
        )
        .join("")
    : `<div class="log-item"><strong>No actions yet</strong><p class="muted">Start with day 1 and respond to the live field conditions.</p></div>`;

  app.innerHTML = `
    <div class="simulation-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 4</p>
        <h2>${crop.name} Simulation · Day ${state.day} / 30</h2>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-fill" style="width: ${progress}%;"></div>
        </div>

        <div class="condition-grid" style="margin-top: 1rem;">
          <div class="condition-card">
            <span class="muted">Soil moisture</span>
            <span class="metric-value">${state.moisture}%</span>
          </div>
          <div class="condition-card">
            <span class="muted">Temperature</span>
            <span class="metric-value">${state.temperature}°C</span>
          </div>
          <div class="condition-card">
            <span class="muted">Crop health</span>
            <span class="metric-value">${state.cropHealth}%</span>
          </div>
          <div class="condition-card">
            <span class="muted">Score</span>
            <span class="metric-value">${state.score}</span>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Daily crop guidance</h3>
          <p>${getGrowthHint(crop, state.day)}</p>
        </div>

        ${
          state.lastActionSummary
            ? `
            <div class="status-card" style="margin-top: 1rem;">
              <h3>Previous action feedback</h3>
              <p>${state.lastActionSummary.notes.join(" ")}</p>
            </div>
          `
            : ""
        }

        <div class="button-row" style="margin-top: 1rem;">
          <button class="primary" data-action="water">Water</button>
          <button class="ghost" data-action="fertilize">Add fertilizer</button>
          <button class="secondary" data-action="wait">Do nothing</button>
        </div>
      </article>

      <aside class="panel-card">
        <h3>AI field recommendation</h3>
        <p><strong>Best action now:</strong> ${recommendation.action}</p>
        <p class="muted">${recommendation.reason}</p>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Scoring system</h3>
          <p class="muted">
            Good decisions typically earn +5 to +10. Poor timing or harmful actions drop the score by -5 to -10.
          </p>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Recent farm log</h3>
          <div class="log-list">${logs}</div>
        </div>
      </aside>
    </div>
  `;
}

function renderResult() {
  const crop = getSelectedCrop();
  const outcome = getOutcome();
  const bestActionCount = state.history.filter((entry) => entry.scoreDelta >= 8).length;
  const stressDays = state.history.filter((entry) => entry.scoreDelta < 0).length;

  app.innerHTML = `
    <div class="result-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 5</p>
        <div class="result-banner">
          <p class="eyebrow">30-day outcome</p>
          <h2 class="result-title">${outcome.badge}</h2>
          <p>${outcome.summary}</p>
        </div>

        <div class="metrics-grid" style="margin-top: 1rem;">
          <div class="metric">
            <span class="muted">Final score</span>
            <span class="metric-value">${state.score}</span>
          </div>
          <div class="metric">
            <span class="muted">Crop health</span>
            <span class="metric-value">${state.cropHealth}%</span>
          </div>
          <div class="metric">
            <span class="muted">Strong days</span>
            <span class="metric-value">${bestActionCount}</span>
          </div>
          <div class="metric">
            <span class="muted">Stress days</span>
            <span class="metric-value">${stressDays}</span>
          </div>
        </div>

        <p class="footnote">
          Soilixa OpenEnv blends agricultural knowledge, AI-style recommendations, and interactive decision learning in one crop lifecycle experience.
        </p>
      </article>

      <aside class="panel-card">
        <h3>${crop.emoji} ${crop.name} season review</h3>
        <p class="muted">
          The final result reflects how well the simulation followed the crop guide across moisture, nutrient timing, and daily balance.
        </p>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Knowledge to remember</h3>
          <p>${crop.knowledge[0]}</p>
          <p>${crop.knowledge[5]}</p>
          <p>${crop.knowledge[10]}</p>
        </div>

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="restart-same">Simulate ${crop.name} Again</button>
          <button class="primary" data-action="restart-all">Choose Another Crop</button>
        </div>
      </aside>
    </div>
  `;
}

function render() {
  updateStageUI();

  if (state.stage === "start") {
    renderStart();
    return;
  }

  if (state.stage === "crop") {
    renderCropSelection();
    return;
  }

  if (state.stage === "guide") {
    renderGuide();
    return;
  }

  if (state.stage === "simulation") {
    renderSimulation();
    return;
  }

  renderResult();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) {
    return;
  }

  const action = button.dataset.action;
  const cropId = button.dataset.crop;

  if (cropId) {
    state.selectedCropId = cropId;
    render();
    return;
  }

  if (action === "go-crops") {
    state.stage = "crop";
    render();
    return;
  }

  if (action === "preview-guide") {
    state.selectedCropId = state.selectedCropId || "tomato";
    state.stage = "guide";
    render();
    return;
  }

  if (action === "go-start") {
    state.stage = "start";
    render();
    return;
  }

  if (action === "go-guide" && state.selectedCropId) {
    state.stage = "guide";
    render();
    return;
  }

  if (action === "start-simulation") {
    resetSimulation();
    state.stage = "simulation";
    render();
    return;
  }

  if (action === "water" || action === "fertilize" || action === "wait") {
    evaluateAction(action);
    return;
  }

  if (action === "restart-same") {
    resetSimulation();
    state.stage = "simulation";
    render();
    return;
  }

  if (action === "restart-all") {
    state.stage = "crop";
    state.lastActionSummary = null;
    render();
  }
});

render();
