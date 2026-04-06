const STAGES = ["start", "crop", "guide", "simulation", "result"];
const STAGE_TITLES = {
  start: "Start",
  crop: "Crop Selection",
  guide: "Crop Guide",
  simulation: "Simulation",
  result: "Final Result"
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
  selectedCropId: null,
  simulation: null,
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
  stageLabel.textContent = STAGE_TITLES[state.stage];
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
    const [{ crops }, { agentBrief }] = await Promise.all([
      apiRequest("/api/crops"),
      apiRequest("/api/agent-brief")
    ]);
    state.crops = crops;
    state.agentBrief = agentBrief;
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

async function startAIFarm(cropId = state.selectedCropId) {
  if (!cropId) {
    return;
  }

  resetDemoMode();
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

  if (!isDemoStep) {
    resetDemoMode();
    state.loading = true;
  }

  state.error = "";
  render();

  let continueDemo = false;

  try {
    const { simulation } = await apiRequest(`/api/simulations/${state.simulation.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action })
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

  renderFrame(`
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
          <button class="primary" data-action="go-crops" ${state.loading ? "disabled" : ""}>Start</button>
          <button class="ghost" data-action="watch-ai" ${state.loading || !state.crops.length ? "disabled" : ""}>Watch AI Farm</button>
          <button class="secondary" data-action="preview-guide" ${state.loading || !state.crops.length ? "disabled" : ""}>Preview Learning Flow</button>
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
        ${
          state.agentBrief
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>AI agent objective</h3>
              <p class="muted">${state.agentBrief.objective}</p>
              <p><strong>Episode:</strong> ${state.agentBrief.episode.totalDays} days</p>
              <p><strong>Demo crop:</strong> ${demoCrop ? `${demoCrop.name} ${demoCrop.emoji}` : "Loading..."}</p>
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
      <h2>Select a crop to guide the simulation.</h2>
      <p class="muted">Choose the crop first. Soilixa then loads the matching farming guide and daily environmental targets.</p>

      <div class="crop-grid">${cards}</div>

      <div class="button-row" style="margin-top: 1.2rem;">
        <button class="secondary" data-action="go-start" ${state.loading ? "disabled" : ""}>Back</button>
        <button class="ghost" data-action="watch-ai" ${state.loading || !state.selectedCropId ? "disabled" : ""}>Watch AI Farm</button>
        <button class="primary" data-action="go-guide" ${state.loading || !state.selectedCropId ? "disabled" : ""}>Continue to Crop Guide</button>
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

        ${renderAgentBrief()}

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="go-crops" ${state.loading ? "disabled" : ""}>Choose Another Crop</button>
          <button class="ghost" data-action="watch-ai" ${state.loading ? "disabled" : ""}>Watch AI Farm</button>
          <button class="primary" data-action="start-simulation" ${state.loading ? "disabled" : ""}>Start Simulation</button>
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

function renderSimulation() {
  const simulation = state.simulation;
  if (!simulation) {
    renderFrame(`<div class="panel-card"><p class="muted">Simulation not found.</p></div>`);
    return;
  }

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
        <h2>${simulation.crop.name} Simulation · Day ${simulation.day} / ${simulation.totalDays}</h2>
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
            <div class="button-row" style="margin-top: 1rem;">
              <button class="primary" data-action="water" ${state.loading ? "disabled" : ""}>Water</button>
              <button class="ghost" data-action="fertilize" ${state.loading ? "disabled" : ""}>Add fertilizer</button>
              <button class="secondary" data-action="do_nothing" ${state.loading ? "disabled" : ""}>Do nothing</button>
            </div>
          `
        }
      </article>

      <aside class="panel-card">
        <h3>AI field recommendation</h3>
        <p><strong>Best action now:</strong> ${simulation.recommendation.label}</p>
        <p class="muted">${simulation.recommendation.reason}</p>

        ${
          simulation.agentBrief
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>Agent rule focus</h3>
              <p class="muted">${simulation.agentBrief.finalGoal.join(" ")}</p>
            </div>
          `
            : ""
        }

        ${
          state.demoMode
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>Trained policy</h3>
              <p class="muted">
                The live demo reads the exported Q-table first and falls back to the backend recommendation only when a state is unseen.
              </p>
              ${
                state.demoDecision
                  ? `<p><strong>Current state key:</strong> ${state.demoDecision.stateKey}</p>`
                  : ""
              }
            </div>
          `
            : ""
        }

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
  `);
}

function renderResult() {
  const simulation = state.simulation;
  if (!simulation || !simulation.outcome) {
    renderFrame(`<div class="panel-card"><p class="muted">Result not available.</p></div>`);
    return;
  }

  const bestActionCount = simulation.history.filter((entry) => entry.scoreDelta >= 8).length;
  const stressDays = simulation.history.filter((entry) => entry.scoreDelta < 0).length;
  const rerunLabel = state.demoMode ? `Watch ${simulation.crop.name} Again` : `Simulate ${simulation.crop.name} Again`;

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

        ${
          state.demoMode
            ? `
            <div class="tip-card" style="margin-top: 1rem;">
              <h3>AI season recap</h3>
              <p class="muted">
                This run was driven by the exported Q-table from \`train.py\`, using the same backend step logic as the guided simulation.
              </p>
            </div>
          `
            : ""
        }

        <p class="footnote">
          Soilixa OpenEnv blends agricultural knowledge, AI-style recommendations, and interactive decision learning in one crop lifecycle experience.
        </p>
      </article>

      <aside class="panel-card">
        <h3>${simulation.crop.emoji} ${simulation.crop.name} season review</h3>
        <p class="muted">
          The final result reflects how well the simulation followed the crop guide across moisture, nutrient timing, and daily balance.
        </p>

        <div class="tip-card" style="margin-top: 1rem;">
          <h3>Knowledge to remember</h3>
          <p>${simulation.crop.knowledge[0]}</p>
          <p>${simulation.crop.knowledge[5]}</p>
          <p>${simulation.crop.knowledge[10]}</p>
        </div>

        <div class="button-row" style="margin-top: 1rem;">
          <button class="secondary" data-action="restart-same" ${state.loading ? "disabled" : ""}>${rerunLabel}</button>
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

  if (action === "watch-ai") {
    startAIFarm(state.selectedCropId || (state.crops[0] && state.crops[0].id));
    return;
  }

  if (action === "take-over") {
    resetDemoMode();
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
    if (state.demoMode && state.simulation) {
      startAIFarm(state.simulation.crop.id);
      return;
    }

    startSimulation();
    return;
  }

  if (action === "restart-all") {
    resetDemoMode();
    state.simulation = null;
    state.stage = "crop";
    state.error = "";
    render();
  }
});

render();
loadCrops();
