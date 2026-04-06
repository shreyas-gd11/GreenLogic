"use strict";

const PORT = 5051;
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

async function assertDemoEndpoint() {
  const demoResponse = await fetch(`${BASE_URL}/api/demo?crop=rice&mode=explain`);
  if (!demoResponse.ok) {
    throw new Error(`/api/demo returned ${demoResponse.status} for a valid request.`);
  }

  const demoPayload = await demoResponse.json();
  if (demoPayload.cropType !== "rice") {
    throw new Error(`Expected cropType 'rice' but received '${demoPayload.cropType}'.`);
  }

  if (demoPayload.mode !== "explain") {
    throw new Error(`Expected mode 'explain' but received '${demoPayload.mode}'.`);
  }

  if (!Array.isArray(demoPayload.steps) || demoPayload.steps.length === 0) {
    throw new Error("Expected /api/demo to return a non-empty steps array.");
  }

  if (typeof demoPayload.normalizedScore !== "number") {
    throw new Error("Expected /api/demo to return a numeric normalizedScore.");
  }

  if (typeof demoPayload.result !== "string" || !demoPayload.result) {
    throw new Error("Expected /api/demo to return a result label.");
  }

  const invalidResponse = await fetch(`${BASE_URL}/api/demo?crop=invalid`);
  if (invalidResponse.status !== 400) {
    throw new Error(`Expected invalid crop request to return 400 but received ${invalidResponse.status}.`);
  }

  const invalidPayload = await invalidResponse.json();
  if (invalidPayload.error !== "Valid crop query parameter is required") {
    throw new Error("Expected invalid crop response to include the configured validation message.");
  }
}

async function main() {
  process.env.HOST = HOST;
  process.env.PORT = String(PORT);
  const { server } = require("./server");

  try {
    await waitForServer();
    await assertDemoEndpoint();
    console.log("PASS /api/demo");
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
