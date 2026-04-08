const STAGES = ["start", "crop", "guide", "simulation", "result"];
const STAGE_TITLES = {
  start: "Start",
  crop: "Crop Selection",
  guide: "Crop Guide",
  simulation: "Simulation",
  result: "Result"
};

const AI_ACTIONS = ["water", "fertilize", "do_nothing"];
const AI_MODEL_PATH = "/artifacts/q_table.json";
const DEMO_STEP_DELAY_MS = 900;

const app = document.getElementById("app");
const stageLabel = document.getElementById("stageLabel");
const progressSteps = [...document.querySelectorAll(".progress-step")];

const state = {
  stage: "start",
  crops: [],
  agentBrief: null,
  humanData: null,
  selectedCropId: null,
  playMode: null,
  comparisonId: null,
  simulation: null,
  aiSimulation: null,
  comparisonHistory: [],
  lastComparison: null,
  loading: false,
  error: "",
  aiModel: null,
  demoMode: false,
  demoRunning: false,
  demoDecision: null
};

let demoTimer = null;

function getSelectedCrop() {
  return state.crops.find((crop) => crop.id === state.selectedCropId) || null;
}

function getActionLabel(action) {
  if (action === "water") {
    return "Water";
  }

  if (action === "fertilize") {
    return "Add fertilizer";
  }

  return "Do nothing";
}

function updateStageUI() {
  stageLabel.textContent = state.stage === "simulation" || state.stage === "result" ? getModeLabel() : STAGE_TITLES[state.stage];
  progressSteps.forEach((step, index) => {
    const currentIndex = STAGES.indexOf(state.stage);
    step.classList.toggle("active", currentIndex === index);
    step.classList.toggle("complete", currentIndex > index);
  });
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }

  return payload;
}

async function loadAiModel() {
  if (state.aiModel) {
    return state.aiModel;
  }

  const response = await fetch(AI_MODEL_PATH, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Trained Q-table not found. Run `python train.py` to generate it.");
  }

  state.aiModel = await response.json();
  return state.aiModel;
}

async function refreshHumanData() {
  try {
    const { humanData } = await apiRequest("/api/human-data");
    state.humanData = humanData;
  } catch (error) {
    // Keep the existing stats if the refresh fails.
  }
}

function clearDemoTimer() {
  if (demoTimer) {
    window.clearTimeout(demoTimer);
    demoTimer = null;
  }
}

function stopDemoPlayback() {
  clearDemoTimer();
  state.demoRunning = false;
  state.demoDecision = null;
}

function resetDemoMode() {
  stopDemoPlayback();
  state.demoMode = false;
}

function bucketMoisture(simulation) {
  const [low, high] = simulation.crop.moistureRange;

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
  const [low, high] = simulation.crop.temperatureRange;

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
  const fertilizerDue = simulation.crop.fertilizerDays.includes(simulation.day) ? "due" : "wait";

  return [
    `crop=${simulation.crop.id}`,
    `day=${String(simulation.day).padStart(2, "0")}`,
    `moisture=${bucketMoisture(simulation)}`,
    `temp=${bucketTemperature(simulation)}`,
    `health=${bucketHealth(simulation)}`,
    `fertilizer=${fertilizerDue}`
  ].join("|");
}

function chooseAiAction(simulation) {
  const stateKey = encodeSimulationState(simulation);
  const qValues = state.aiModel && state.aiModel.qTable ? state.aiModel.qTable[stateKey] : null;

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

  return {
    action: simulation.recommendation.action,
    label: simulation.recommendation.label,
    source: "fallback",
    stateKey,
    qValue: null
  };
}

function getCurrentSimulation() {
  return state.simulation;
}

function getAiSimulation() {
  return state.aiSimulation;
}

function resetChallengeState() {
  state.comparisonId = null;
  state.simulation = null;
  state.aiSimulation = null;
  state.comparisonHistory = [];
  state.lastComparison = null;
}

function getModeLabel() {
  if (state.playMode === "compare") {
    return "Human vs AI";
  }

  if (state.playMode === "ai") {
    return "Watch AI";
  }

  if (state.playMode === "manual") {
    return "Play Manually";
  }

  return STAGE_TITLES[state.stage];
}

function getComparisonSummary() {
  const manualWins = state.comparisonHistory.filter((entry) => entry.swing > 0).length;
  const aiWins = state.comparisonHistory.filter((entry) => entry.swing < 0).length;
  const ties = state.comparisonHistory.length - manualWins - aiWins;

  return {
    manualWins,
    aiWins,
    ties
  };
}

function getSeasonStats(simulation) {
  return {
    strongDays: simulation.history.filter((entry) => entry.scoreDelta >= 8).length,
    stressDays: simulation.history.filter((entry) => entry.scoreDelta < 0).length,
    wateringDays: simulation.history.filter((entry) => entry.action === "water").length,
    fertilizerDays: simulation.history.filter((entry) => entry.action === "fertilize").length
  };
}

function getRoundVerdict(entry) {
  if (entry.swing > 0) {
    return "Manual move won the round";
  }

  if (entry.swing < 0) {
    return "AI move won the round";
  }

  return "Round tied";
}

function scheduleDemoStep() {
  clearDemoTimer();

  if (!state.demoMode || !state.simulation || state.loading) {
    return;
  }

  if (state.simulation.status === "complete") {
    stopDemoPlayback();
    render();
    return;
  }

  const decision = chooseAiAction(state.simulation);
  state.demoDecision = {
    ...decision,
    day: state.simulation.day
  };
  state.demoRunning = true;
  render();

  demoTimer = window.setTimeout(() => {
    submitAction(decision.action, { trigger: "ai" });
  }, DEMO_STEP_DELAY_MS);
}

async function loadCrops() {
  state.loading = true;
  state.error = "";
  render();

  try {
    const [{ crops }, { agentBrief }, { humanData }] = await Promise.all([
      apiRequest("/api/crops"),
      apiRequest("/api/agent-brief"),
      apiRequest("/api/human-data")
    ]);
    state.crops = crops;
    state.agentBrief = agentBrief;
    state.humanData = humanData;
    state.selectedCropId = state.selectedCropId || (crops[0] && crops[0].id) || null;
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function renderAgentBrief() {
  if (!state.agentBrief) {
    return "";
  }

  const actions = state.agentBrief.availableActions
    .map((action) => `<div class="agent-pill"><strong>${action.label}</strong><span>${action.effect}</span></div>`)
    .join("");

  const rules = state.agentBrief.rules
    .map((rule) => `<li>${rule}</li>`)
    .join("");

  const strategy = state.agentBrief.strategyGuidelines
    .map((item) => `<li>${item}</li>`)
    .join("");

  const loop = state.agentBrief.decisionLoop
    .map((item, index) => `<div class="guide-item"><div class="guide-item-number">${index + 1}</div><div>${item}</div></div>`)
    .join("");

  return `
    <div class="tip-card" style="margin-top: 1rem;">
      <h3>AI Agent Brief</h3>
      <p class="muted"><strong>Objective:</strong> ${state.agentBrief.objective}</p>
      <div class="agent-pill-row">${actions}</div>
      <div class="agent-columns">
        <div>
          <p><strong>Rules</strong></p>
          <ul class="agent-list">${rules}</ul>
        </div>
        <div>
          <p><strong>Strategy</strong></p>
          <ul class="agent-list">${strategy}</ul>
        </div>
      </div>
      <p><strong>Success target:</strong> ${state.agentBrief.successCriteria.target.join(" · ")}</p>
      <p><strong>Avoid:</strong> ${state.agentBrief.successCriteria.avoid.join(" · ")}</p>
      <div class="guide-list" style="margin-top: 0.75rem;">${loop}</div>
    </div>
  `;
}

async function startSimulation() {
  if (!state.selectedCropId) {
    return;
  }

  resetDemoMode();
  resetChallengeState();
  state.playMode = "manual";
  state.loading = true;
  state.error = "";
  render();

  try {
    const { simulation } = await apiRequest("/api/simulations", {
      method: "POST",
      body: JSON.stringify({ cropId: state.selectedCropId })
    });

    state.simulation = simulation;
    state.stage = simulation.status === "complete" ? "result" : "simulation";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function startComparison() {
  if (!state.selectedCropId) {
    return;
  }

  resetDemoMode();
  resetChallengeState();
  state.playMode = "compare";
  state.loading = true;
  state.error = "";
  render();

  try {
    const { comparison } = await apiRequest("/api/comparisons", {
      method: "POST",
      body: JSON.stringify({ cropId: state.selectedCropId })
    });

    loadAiModel().catch(() => null);

    state.comparisonId = comparison.id;
    state.simulation = comparison.simulation;
    state.aiSimulation = comparison.aiSimulation;
    state.lastComparison = comparison.lastComparison;
    state.comparisonHistory = comparison.comparisonHistory;
    state.stage = comparison.simulation.status === "complete" ? "result" : "simulation";
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function startAIFarm(cropId = state.selectedCropId) {
  if (!cropId) {
    return;
  }

  resetDemoMode();
  resetChallengeState();
  state.playMode = "ai";
  state.loading = true;
  state.error = "";
  render();

  try {
    await loadAiModel();
    const { simulation } = await apiRequest("/api/simulations", {
      method: "POST",
      body: JSON.stringify({ cropId })
    });

    state.selectedCropId = cropId;
    state.simulation = simulation;
    state.stage = simulation.status === "complete" ? "result" : "simulation";
    state.demoMode = true;
    state.demoRunning = simulation.status !== "complete";
    state.demoDecision = null;
  } catch (error) {
    state.error = error.message;
    resetDemoMode();
  } finally {
    state.loading = false;
    render();

    if (state.demoMode && state.stage === "simulation") {
      scheduleDemoStep();
    }
  }
}

async function submitAction(action, options = {}) {
  if (!state.simulation) {
    return;
  }

  const isDemoStep = options.trigger === "ai";
  const manualSimulation = state.simulation;
  const aiSimulation = state.aiSimulation;

  if (!isDemoStep) {
    resetDemoMode();
    state.loading = true;
  }

  state.error = "";
  render();

  let continueDemo = false;

  try {
    if (isDemoStep || !state.comparisonId) {
      const { simulation } = await apiRequest(`/api/simulations/${manualSimulation.id}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, source: isDemoStep ? "ai" : "human" })
      });

      state.simulation = simulation;
      state.selectedCropId = simulation.crop.id;
      state.stage = simulation.status === "complete" ? "result" : "simulation";

      if (isDemoStep) {
        if (simulation.status === "complete") {
          stopDemoPlayback();
        } else {
          continueDemo = true;
        }
      }
    } else {
      const { comparison } = await apiRequest(`/api/comparisons/${state.comparisonId}/actions`, {
        method: "POST",
        body: JSON.stringify({ action })
      });

      state.simulation = comparison.simulation;
      state.aiSimulation = comparison.aiSimulation;
      state.selectedCropId = comparison.simulation.crop.id;
      state.lastComparison = comparison.lastComparison;
      state.comparisonHistory = comparison.comparisonHistory;
      state.stage = comparison.simulation.status === "complete" ? "result" : "simulation";
    }

    if (!isDemoStep && state.playMode !== "ai") {
      await refreshHumanData();
    }
  } catch (error) {
    state.error = error.message;
    if (isDemoStep) {
      stopDemoPlayback();
    }
  } finally {
    if (!isDemoStep) {
      state.loading = false;
    }
    render();

    if (continueDemo) {
      scheduleDemoStep();
    }
  }
}

function renderFrame(content) {
  const status = state.loading
    ? `<div class="status-card"><strong>Loading...</strong><p class="muted">Talking to the backend and preparing the next screen.</p></div>`
    : state.error
      ? `<div class="status-card"><strong>Backend error</strong><p class="muted">${state.error}</p></div>`
      : "";

  app.innerHTML = `${status}${content}`;
}

function renderStart() {
  const demoCrop = getSelectedCrop();
  const humanDataText = state.humanData
    ? `${state.humanData.entries} human decisions collected`
    : "Human decision log loading";

  renderFrame(`
    <div class="hero-grid">
      <article class="panel-card hero-card">
        <div class="hero-copy">
          <p class="eyebrow">Step 1</p>
          <h2>Pick how you want to use the crop simulator.</h2>
          <p>
            You can watch the trained policy run, play the farm manually, or switch on Human vs AI mode when you want a fair score comparison.
          </p>
        </div>
        <div class="mode-grid" style="margin-top: 1rem;">
          <div class="mode-card">
            <h3>Watch AI</h3>
            <p class="muted">Let the trained policy run the 30-day farm by itself.</p>
          </div>
          <div class="mode-card">
            <h3>Play Manually</h3>
            <p class="muted">Control the farm yourself and log human decisions for later training data.</p>
          </div>
          <div class="mode-card">
            <h3>Human vs AI</h3>
            <p class="muted">Run both lanes together and compare final scores on the same environment.</p>
          </div>
        </div>
        <div class="cta-row">
          <button class="primary" data-action="go-crops" ${state.loading ? "disabled" : ""}>Choose Crop</button>
          <button class="secondary" data-action="preview-guide" ${state.loading || !state.crops.length ? "disabled" : ""}>Preview Crop Guide</button>
        </div>
      </article>

      <aside class="panel-card">
        <h3>Training pipeline</h3>
        <div class="mini-grid">
          <div class="metric">
            <span class="muted">Human data</span>
            <span class="metric-value">${humanDataText}</span>
          </div>
          <div class="metric">
            <span class="muted">Storage</span>
            <span class="metric-value">JSONL log</span>
          </div>
          <div class="metric">
            <span class="muted">Training</span>
            <span class="metric-value">Q-table</span>
          </div>
        </div>
        <p class="support-copy">
          Manual and Human vs AI play now collect human action data that can be used to improve future training runs.
        </p>
        ${
          state.humanData
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>Human data collection</h3>
              <p class="muted">Collected manual actions are appended to the local training dataset.</p>
              <p><strong>Dataset:</strong> ${state.humanData.path}</p>
              <p><strong>Latest crop:</strong> ${demoCrop ? `${demoCrop.name} ${demoCrop.emoji}` : "Loading..."}</p>
            </div>
          `
            : ""
        }
        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Learning curve</h3>
          <p class="muted">\`train.py\` exports a trained Q-table plus a score curve after 500 backend-driven episodes.</p>
          <img class="learning-curve-image" src="/artifacts/learning_curve.svg" alt="AI learning curve across training episodes" />
        </div>
      </aside>
    </div>
  `);
}

function renderCropSelection() {
  const cards = state.crops
    .map(
      (crop) => `
        <button class="crop-card ${state.selectedCropId === crop.id ? "selected" : ""}" data-crop="${crop.id}" ${state.loading ? "disabled" : ""}>
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

  renderFrame(`
    <div class="panel-card">
      <p class="eyebrow">Step 2</p>
      <h2>Select the crop for your mode.</h2>
      <p class="muted">After crop selection you can choose Watch AI, Play Manually, or Human vs AI for the same field setup.</p>

      <div class="crop-grid">${cards}</div>

      <div class="button-row" style="margin-top: 1.2rem;">
        <button class="secondary" data-action="go-start" ${state.loading ? "disabled" : ""}>Back</button>
        <button class="primary" data-action="go-guide" ${state.loading || !state.selectedCropId ? "disabled" : ""}>Continue to Mode Selection</button>
      </div>
    </div>
  `);
}

function renderGuide() {
  const crop = getSelectedCrop();
  if (!crop) {
    renderFrame(`<div class="panel-card"><p class="muted">No crop selected.</p></div>`);
    return;
  }

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

  renderFrame(`
    <div class="guide-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 3</p>
        <h2>How to grow ${crop.name} ${crop.emoji}</h2>
        <p class="muted">Read the crop guidance first. All three modes use the same crop rules and backend environment.</p>
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
          <h3>Mode options</h3>
          <p class="muted">
            Watch AI runs the trained policy, Play Manually collects human decisions for training data,
            and Human vs AI compares both lanes on the same environment.
          </p>
        </div>

        ${
          state.humanData
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>Human data collector</h3>
              <p class="muted">Manual decisions are stored at <strong>${state.humanData.path}</strong> and can be reused for future training.</p>
              <p><strong>Collected entries:</strong> ${state.humanData.entries}</p>
            </div>
          `
            : ""
        }

        ${renderAgentBrief()}

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="go-crops" ${state.loading ? "disabled" : ""}>Choose Another Crop</button>
          <button class="ghost" data-action="watch-ai" ${state.loading ? "disabled" : ""}>Watch AI</button>
          <button class="secondary" data-action="start-simulation" ${state.loading ? "disabled" : ""}>Play Manually</button>
          <button class="primary" data-action="start-comparison" ${state.loading ? "disabled" : ""}>Human vs AI</button>
        </div>
      </aside>
    </div>
  `);
}

function renderDemoStatus() {
  if (!state.demoMode || !state.simulation) {
    return "";
  }

  const decision = state.demoDecision;
  const sourceLabel = decision && decision.source === "q_table" ? "Q-table" : "Recommendation fallback";
  const qValue = decision && decision.qValue !== null ? decision.qValue.toFixed(2) : "n/a";

  return `
    <div class="status-card" style="margin-top: 1rem;">
      <h3>AI is farming live</h3>
      <p class="muted">
        ${state.demoRunning ? "The trained agent is advancing one day at a time." : "This demo episode has finished."}
      </p>
      ${
        decision
          ? `
            <div class="decision-badge">
              <strong>Day ${decision.day}</strong>
              <span>${decision.label}</span>
              <span>${sourceLabel}</span>
              <span>Q ${qValue}</span>
            </div>
          `
          : ""
      }
      <div class="button-row" style="margin-top: 1rem;">
        <button class="secondary" data-action="take-over" ${state.loading ? "disabled" : ""}>Take Over Farm</button>
      </div>
    </div>
  `;
}

function renderChallengeTimeline() {
  if (!state.comparisonHistory.length) {
    return `<div class="log-item"><strong>No rounds yet</strong><p class="muted">Your first manual action will generate the first AI comparison.</p></div>`;
  }

  return state.comparisonHistory
    .slice(0, 5)
    .map(
      (entry) => `
        <div class="log-item">
          <strong>Day ${entry.day} · ${getRoundVerdict(entry)}</strong>
          <div class="duel-line">
            <span>You: ${entry.manualAction}</span>
            <span>${entry.manualDelta >= 0 ? `+${entry.manualDelta}` : entry.manualDelta}</span>
          </div>
          <div class="duel-line ai">
            <span>AI: ${entry.aiAction}</span>
            <span>${entry.aiPreviewDelta >= 0 ? `+${entry.aiPreviewDelta}` : entry.aiPreviewDelta}</span>
          </div>
          <p class="muted">Swing ${entry.swing >= 0 ? `+${entry.swing}` : entry.swing} against the AI lane.</p>
        </div>
      `
    )
    .join("");
}

function renderSimulation() {
  const simulation = getCurrentSimulation();
  const aiSimulation = getAiSimulation();
  if (!simulation) {
    renderFrame(`<div class="panel-card"><p class="muted">Simulation not found.</p></div>`);
    return;
  }

  if (!state.comparisonId) {
    const logs = simulation.history.length
      ? simulation.history
          .slice(0, 6)
          .map(
            (entry) => `
              <div class="log-item">
                <strong>Day ${entry.day} · ${entry.actionLabel || entry.action}</strong>
                <div class="score-chip">Score ${entry.scoreDelta >= 0 ? `+${entry.scoreDelta}` : entry.scoreDelta}</div>
                <p class="muted">Moisture after action: ${entry.moistureAfterAction}% · Crop health: ${entry.healthAfter}%</p>
                <p>${entry.notes[0]}</p>
              </div>
            `
          )
          .join("")
      : `<div class="log-item"><strong>No actions yet</strong><p class="muted">Start with day 1 and respond to the live field conditions.</p></div>`;

    renderFrame(`
      <div class="simulation-layout">
        <article class="panel-card">
          <p class="eyebrow">Step 4</p>
          <h2>${simulation.crop.name} ${state.demoMode ? "AI Farm" : "Manual Simulation"} · Day ${simulation.day} / ${simulation.totalDays}</h2>
          <div class="progress-bar" aria-hidden="true">
            <div class="progress-fill" style="width: ${simulation.progressPercent}%;"></div>
          </div>

          <div class="condition-grid" style="margin-top: 1rem;">
            <div class="condition-card">
              <span class="muted">Soil moisture</span>
              <span class="metric-value">${simulation.moisture}%</span>
            </div>
            <div class="condition-card">
              <span class="muted">Temperature</span>
              <span class="metric-value">${simulation.temperature}°C</span>
            </div>
            <div class="condition-card">
              <span class="muted">Crop health</span>
              <span class="metric-value">${simulation.cropHealth}%</span>
            </div>
            <div class="condition-card">
              <span class="muted">Score</span>
              <span class="metric-value">${simulation.score}</span>
            </div>
          </div>

          <div class="tip-card" style="margin-top: 1rem;">
            <h3>Daily crop guidance</h3>
            <p>${simulation.growthHint}</p>
          </div>

          ${
            simulation.lastActionSummary
              ? `
              <div class="status-card" style="margin-top: 1rem;">
                <h3>Previous action feedback</h3>
                <p>${simulation.lastActionSummary.notes.join(" ")}</p>
              </div>
            `
              : ""
          }

          ${
            state.demoMode
              ? renderDemoStatus()
              : `
              <div class="tip-card" style="margin-top: 1rem;">
                <h3>Submit your move</h3>
                <p class="muted">Manual actions from this mode are logged for future AI training.</p>
                <div class="button-row" style="margin-top: 1rem;">
                  <button class="primary" data-action="water" ${state.loading ? "disabled" : ""}>Water</button>
                  <button class="ghost" data-action="fertilize" ${state.loading ? "disabled" : ""}>Add fertilizer</button>
                  <button class="secondary" data-action="do_nothing" ${state.loading ? "disabled" : ""}>Do nothing</button>
                </div>
              </div>
            `
          }
        </article>

        <aside class="panel-card">
          <h3>${state.demoMode ? "AI policy" : "AI field recommendation"}</h3>
          <div class="recommendation-card">
            <div class="recommendation-topline">
              <strong>${simulation.recommendation.label}</strong>
              <div class="score-chip">${state.demoMode ? "Watch AI" : "Manual assist"}</div>
            </div>
            <p>${simulation.recommendation.reason}</p>
            <div class="decision-badge">
              <span>Crop ${simulation.crop.name}</span>
              <span>Target moisture ${simulation.crop.moistureRange[0]}-${simulation.crop.moistureRange[1]}%</span>
              <span>Target temp ${simulation.crop.temperatureRange[0]}-${simulation.crop.temperatureRange[1]}°C</span>
            </div>
          </div>

          ${
            state.humanData && !state.demoMode
              ? `
              <div class="tip-card" style="margin-top: 1rem;">
                <h3>Human data collector</h3>
                <p class="muted">Your manual actions are appended to:</p>
                <p><strong>${state.humanData.path}</strong></p>
                <p><strong>Collected entries:</strong> ${state.humanData.entries}</p>
              </div>
            `
              : ""
          }

          <div class="tip-card" style="margin-top: 1rem;">
            <h3>Recent farm log</h3>
            <div class="log-list">${logs}</div>
          </div>
        </aside>
      </div>
    `);
    return;
  }

  const summary = getComparisonSummary();
  const lastComparison = state.lastComparison;
  const aiDecision = aiSimulation ? chooseAiAction(aiSimulation) : null;

  renderFrame(`
    <div class="simulation-layout challenge-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 4</p>
        <h2>${simulation.crop.name} Human vs AI · Day ${simulation.day} / ${simulation.totalDays}</h2>
        <div class="progress-bar" aria-hidden="true">
          <div class="progress-fill" style="width: ${simulation.progressPercent}%;"></div>
        </div>

        <div class="challenge-scoreboard">
          <div class="versus-card manual">
            <span class="versus-label">Manual lane</span>
            <strong>${simulation.score}</strong>
            <span>Health ${simulation.cropHealth}%</span>
          </div>
          <div class="versus-vs">VS</div>
          <div class="versus-card ai">
            <span class="versus-label">AI lane</span>
            <strong>${aiSimulation ? aiSimulation.score : "--"}</strong>
            <span>${aiSimulation ? `Health ${aiSimulation.cropHealth}%` : "Preparing AI lane"}</span>
          </div>
        </div>

        <div class="condition-grid" style="margin-top: 1rem;">
          <div class="condition-card">
            <span class="muted">Soil moisture</span>
            <span class="metric-value">${simulation.moisture}%</span>
          </div>
          <div class="condition-card">
            <span class="muted">Temperature</span>
            <span class="metric-value">${simulation.temperature}°C</span>
          </div>
          <div class="condition-card">
            <span class="muted">Crop health</span>
            <span class="metric-value">${simulation.cropHealth}%</span>
          </div>
          <div class="condition-card">
            <span class="muted">Score</span>
            <span class="metric-value">${simulation.score}</span>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Daily crop guidance</h3>
          <p>${simulation.growthHint}</p>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Submit your manual move</h3>
          <p class="muted">
            After you submit, the backend scores your move, replays the AI decision on the same day snapshot for a fair round verdict, and also advances the AI season lane.
          </p>
          ${
            state.demoMode
              ? renderDemoStatus()
              : `
              <div class="button-row" style="margin-top: 1rem;">
                <button class="primary" data-action="water" ${state.loading ? "disabled" : ""}>Water</button>
                <button class="ghost" data-action="fertilize" ${state.loading ? "disabled" : ""}>Add fertilizer</button>
                <button class="secondary" data-action="do_nothing" ${state.loading ? "disabled" : ""}>Do nothing</button>
              </div>
            `
          }
        </div>

        ${
          lastComparison
            ? `
            <div class="round-result-card" style="margin-top: 1rem;">
              <div class="round-result-head">
                <div>
                  <p class="eyebrow">Latest round verdict</p>
                  <h3>${getRoundVerdict(lastComparison)}</h3>
                </div>
                <div class="score-chip">Swing ${lastComparison.swing >= 0 ? `+${lastComparison.swing}` : lastComparison.swing}</div>
              </div>
              <div class="round-result-grid">
                <div class="round-lane">
                  <span class="muted">Your action</span>
                  <strong>${lastComparison.manualAction}</strong>
                  <p>Turn score ${lastComparison.manualDelta >= 0 ? `+${lastComparison.manualDelta}` : lastComparison.manualDelta}</p>
                  <p class="muted">${lastComparison.manualReason}</p>
                </div>
                <div class="round-lane ai">
                  <span class="muted">AI action</span>
                  <strong>${lastComparison.aiAction}</strong>
                  <p>Turn score ${lastComparison.aiPreviewDelta >= 0 ? `+${lastComparison.aiPreviewDelta}` : lastComparison.aiPreviewDelta}</p>
                  <p class="muted">${lastComparison.aiPreviewReason}</p>
                </div>
              </div>
            </div>
          `
            : ""
        }
      </article>

      <aside class="panel-card">
        <h3>AI field recommendation</h3>
        <div class="recommendation-card">
          <div class="recommendation-topline">
            <strong>${simulation.recommendation.label}</strong>
            ${
              aiDecision
                ? `<div class="score-chip">${aiDecision.source === "q_table" ? "Q-table" : "Rule-based"} AI lane</div>`
                : ""
            }
          </div>
          <p>${simulation.recommendation.reason}</p>
          <div class="decision-badge">
            <span>Crop ${simulation.crop.name}</span>
            <span>Target moisture ${simulation.crop.moistureRange[0]}-${simulation.crop.moistureRange[1]}%</span>
            <span>Target temp ${simulation.crop.temperatureRange[0]}-${simulation.crop.temperatureRange[1]}°C</span>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Human vs AI score</h3>
          <div class="agent-pill-row">
            <div class="agent-pill">
              <strong>${summary.manualWins}</strong>
              <span>Manual round wins</span>
            </div>
            <div class="agent-pill">
              <strong>${summary.aiWins}</strong>
              <span>AI round wins</span>
            </div>
            <div class="agent-pill">
              <strong>${summary.ties}</strong>
              <span>Tied rounds</span>
            </div>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>How the result appears after submit</h3>
          <div class="flow-list">
            <div class="flow-step"><span>1</span><p>You choose a manual action for the current day.</p></div>
            <div class="flow-step"><span>2</span><p>The backend scores your lane and records the crop impact.</p></div>
            <div class="flow-step"><span>3</span><p>The AI move is replayed on the same snapshot to measure the round swing fairly.</p></div>
            <div class="flow-step"><span>4</span><p>The AI season lane also advances, then the verdict card shows who won and why.</p></div>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Recent comparison timeline</h3>
          <div class="log-list">${renderChallengeTimeline()}</div>
        </div>
      </aside>
    </div>
  `);
}

function renderResult() {
  const simulation = getCurrentSimulation();
  const aiSimulation = getAiSimulation();
  if (!simulation || !simulation.outcome) {
    renderFrame(`<div class="panel-card"><p class="muted">Result not available.</p></div>`);
    return;
  }

  if (!aiSimulation) {
    const bestActionCount = simulation.history.filter((entry) => entry.scoreDelta >= 8).length;
    const stressDays = simulation.history.filter((entry) => entry.scoreDelta < 0).length;
    const rerunLabel = state.playMode === "ai" ? `Watch ${simulation.crop.name} Again` : `Simulate ${simulation.crop.name} Again`;

    renderFrame(`
      <div class="result-layout">
        <article class="panel-card">
          <p class="eyebrow">Step 5</p>
          <div class="result-banner">
            <p class="eyebrow">30-day outcome</p>
            <h2 class="result-title">${simulation.outcome.badge}</h2>
            <p>${simulation.outcome.summary}</p>
          </div>

          <div class="metrics-grid" style="margin-top: 1rem;">
            <div class="metric">
              <span class="muted">Final score</span>
              <span class="metric-value">${simulation.score}</span>
            </div>
            <div class="metric">
              <span class="muted">Crop health</span>
              <span class="metric-value">${simulation.cropHealth}%</span>
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
            GreenLogic blends agricultural knowledge, AI-style recommendations, and interactive decision learning in one crop lifecycle experience.
          </p>
        </article>

        <aside class="panel-card">
          <h3>${simulation.crop.emoji} ${simulation.crop.name} season review</h3>
          <p class="muted">${simulation.outcome.summary}</p>
          ${
            state.humanData && state.playMode === "manual"
              ? `<p class="muted"><strong>Human data log:</strong> ${state.humanData.path}</p>`
              : ""
          }
          <div class="button-row" style="margin-top: 1rem;">
            <button class="secondary" data-action="restart-same" ${state.loading ? "disabled" : ""}>${rerunLabel}</button>
            <button class="primary" data-action="restart-all" ${state.loading ? "disabled" : ""}>Choose Another Crop</button>
          </div>
        </aside>
      </div>
    `);
    return;
  }

  const manualStats = getSeasonStats(simulation);
  const aiStats = getSeasonStats(aiSimulation);
  const summary = getComparisonSummary();
  const manualPower = simulation.score + simulation.cropHealth;
  const aiPower = aiSimulation.score + aiSimulation.cropHealth;
  const gap = manualPower - aiPower;
  let duelTitle = "Season tied the AI";
  let duelBody = "Manual play and the AI lane finished with the same combined season strength.";

  if (gap > 0) {
    duelTitle = "Manual strategy beat the AI";
    duelBody = `You finished ${gap} combined points ahead by turning more days into productive crop decisions.`;
  } else if (gap < 0) {
    duelTitle = "AI strategy beat manual play";
    duelBody = `The AI finished ${Math.abs(gap)} combined points ahead by making more stable day-to-day decisions.`;
  }

  renderFrame(`
    <div class="result-layout challenge-result-layout">
      <article class="panel-card">
        <p class="eyebrow">Step 5</p>
        <div class="result-banner">
          <p class="eyebrow">30-day human vs AI outcome</p>
          <h2 class="result-title">${duelTitle}</h2>
          <p>${duelBody}</p>
        </div>

        <div class="versus-summary-grid" style="margin-top: 1rem;">
          <div class="summary-column manual">
            <p class="eyebrow">Manual season</p>
            <h3>${simulation.outcome.badge}</h3>
            <p class="muted">${simulation.outcome.summary}</p>
            <div class="metrics-grid compact-metrics">
              <div class="metric">
                <span class="muted">Final score</span>
                <span class="metric-value">${simulation.score}</span>
              </div>
              <div class="metric">
                <span class="muted">Health</span>
                <span class="metric-value">${simulation.cropHealth}%</span>
              </div>
              <div class="metric">
                <span class="muted">Strong days</span>
                <span class="metric-value">${manualStats.strongDays}</span>
              </div>
              <div class="metric">
                <span class="muted">Stress days</span>
                <span class="metric-value">${manualStats.stressDays}</span>
              </div>
            </div>
          </div>
          <div class="summary-column ai">
            <p class="eyebrow">AI season</p>
            <h3>${aiSimulation.outcome.badge}</h3>
            <p class="muted">${aiSimulation.outcome.summary}</p>
            <div class="metrics-grid compact-metrics">
              <div class="metric">
                <span class="muted">Final score</span>
                <span class="metric-value">${aiSimulation.score}</span>
              </div>
              <div class="metric">
                <span class="muted">Health</span>
                <span class="metric-value">${aiSimulation.cropHealth}%</span>
              </div>
              <div class="metric">
                <span class="muted">Strong days</span>
                <span class="metric-value">${aiStats.strongDays}</span>
              </div>
              <div class="metric">
                <span class="muted">Stress days</span>
                <span class="metric-value">${aiStats.stressDays}</span>
              </div>
            </div>
          </div>
        </div>
      </article>

      <aside class="panel-card">
        <h3>${simulation.crop.emoji} ${simulation.crop.name} comparison review</h3>
        <p class="muted">
          The final screen is built from the actions you manually submitted plus the AI lane that advanced in parallel across the same 30-day crop.
        </p>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Head-to-head metrics</h3>
          <div class="flow-list">
            <div class="flow-step"><span>${summary.manualWins}</span><p>Rounds won by your manual decision.</p></div>
            <div class="flow-step"><span>${summary.aiWins}</span><p>Rounds won by the AI lane.</p></div>
            <div class="flow-step"><span>${manualStats.wateringDays}</span><p>Manual watering decisions across the season.</p></div>
            <div class="flow-step"><span>${aiStats.fertilizerDays}</span><p>AI fertilizer plays across the season.</p></div>
          </div>
        </div>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>How the result was built</h3>
          <p class="muted">
            After every manual submit, GreenLogic updated your lane, updated the AI lane, and stored the round verdict. This page is the season total of those daily comparisons plus final crop health.
          </p>
        </div>

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="restart-same" ${state.loading ? "disabled" : ""}>Run ${simulation.crop.name} Human vs AI Again</button>
          <button class="primary" data-action="restart-all" ${state.loading ? "disabled" : ""}>Choose Another Crop</button>
        </div>
      </aside>
    </div>
  `);
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

  const cropId = button.dataset.crop;
  const action = button.dataset.action;

  if (cropId) {
    state.selectedCropId = cropId;
    state.error = "";
    render();
    return;
  }

  if (action === "go-crops") {
    resetDemoMode();
    resetChallengeState();
    state.playMode = null;
    state.stage = "crop";
    state.error = "";
    render();
    return;
  }

  if (action === "preview-guide" && state.crops.length) {
    resetDemoMode();
    state.selectedCropId = state.selectedCropId || state.crops[0].id;
    state.stage = "guide";
    state.error = "";
    render();
    return;
  }

  if (action === "go-start") {
    resetDemoMode();
    resetChallengeState();
    state.playMode = null;
    state.stage = "start";
    state.error = "";
    render();
    return;
  }

  if (action === "go-guide" && state.selectedCropId) {
    resetDemoMode();
    state.stage = "guide";
    state.error = "";
    render();
    return;
  }

  if (action === "start-comparison") {
    startComparison();
    return;
  }

  if (action === "watch-ai") {
    startAIFarm(state.selectedCropId || (state.crops[0] && state.crops[0].id));
    return;
  }

  if (action === "take-over") {
    resetDemoMode();
    state.playMode = "manual";
    render();
    return;
  }

  if (action === "start-simulation") {
    startSimulation();
    return;
  }

  if (action === "water" || action === "fertilize" || action === "do_nothing") {
    submitAction(action);
    return;
  }

  if (action === "restart-same") {
    if (state.playMode === "ai" && state.simulation) {
      startAIFarm(state.simulation.crop.id);
      return;
    }

    if (state.playMode === "compare" && state.simulation) {
      startComparison();
      return;
    }

    startSimulation();
    return;
  }

  if (action === "restart-all") {
    resetDemoMode();
    state.simulation = null;
    resetChallengeState();
    state.playMode = null;
    state.stage = "crop";
    state.error = "";
    render();
  }
});

render();
loadCrops();
