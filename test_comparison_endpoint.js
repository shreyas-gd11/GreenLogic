"use strict";

const PORT = 5052;
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await sleep(200);
      continue;
    }

    await sleep(200);
  }

  throw new Error("Server did not become ready in time.");
}

async function postJson(path, payload) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed for ${path}`);
  }

  return data;
}

async function assertComparisonFlow() {
  const { comparison: created } = await postJson("/api/comparisons", { cropId: "rice" });

  if (!created.id) {
    throw new Error("Expected a comparison id.");
  }

  if (!created.simulation || !created.aiSimulation) {
    throw new Error("Expected both human and AI simulations in the comparison response.");
  }

  let comparison = created;
  const actions = ["water", "fertilize", "do_nothing"];

  for (let day = 0; day < 30; day += 1) {
    const chosenAction = actions[day % actions.length];
    const { comparison: updated } = await postJson(`/api/comparisons/${comparison.id}/actions`, {
      action: chosenAction
    });

    comparison = updated;

    if (!comparison.lastComparison) {
      throw new Error("Expected a lastComparison payload after submitting an action.");
    }

    if (typeof comparison.lastComparison.swing !== "number") {
      throw new Error("Expected a numeric score swing in lastComparison.");
    }
  }

  if (comparison.status !== "complete") {
    throw new Error("Expected comparison to be complete after 30 actions.");
  }

  if (!comparison.simulation.outcome || !comparison.aiSimulation.outcome) {
    throw new Error("Expected both final outcomes in the completed comparison.");
  }
}

async function main() {
  process.env.HOST = HOST;
  process.env.PORT = String(PORT);
  const { server } = require("./server");

  try {
    await waitForServer();
    await assertComparisonFlow();
    console.log("PASS /api/comparisons");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await closeServer(server);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(() => resolve(), 2000);
  });
}

main();
