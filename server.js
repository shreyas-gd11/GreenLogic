"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { FarmEnvironment } = require("./farm");
const { getCrop: getLegacyCrop } = require("./crops");
const {
  getAgentBrief,
  listCrops,
  getCrop,
  createSimulation,
  serializeSimulation,
  applyAction
} = require("./lib/simulation");

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "localhost";
const ROOT = __dirname;
const simulations = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(message);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Not found");
        return;
      }

      sendText(res, 500, "Failed to read file");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream"
    });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/crops") {
    sendJson(res, 200, { crops: listCrops() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/agent-brief") {
    sendJson(res, 200, { agentBrief: getAgentBrief() });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/crops/")) {
    const cropId = pathname.split("/").pop();
    const crop = getCrop(cropId);
    if (!crop) {
      sendJson(res, 404, { error: "Crop not found" });
      return;
    }

    sendJson(res, 200, { crop });
    return;
  }

  if (req.method === "GET" && pathname === "/api/demo") {
    const cropId = url.searchParams.get("crop");
    const mode = url.searchParams.get("mode") || "explain";

    if (cropId && !getLegacyCrop(cropId)) {
      sendJson(res, 400, { error: "Valid crop query parameter is required" });
      return;
    }

    if (mode !== "learning" && mode !== "explain") {
      sendJson(res, 400, { error: "Mode must be either learning or explain" });
      return;
    }

    const environment = new FarmEnvironment({ cropType: cropId || null });
    const episode = environment.runEpisode({ mode });

    sendJson(res, 200, {
      mode: episode.mode,
      cropType: episode.cropType,
      steps: episode.steps,
      score: episode.finalScore,
      finalScore: episode.finalScore,
      normalizedScore: episode.normalizedScore,
      result: episode.result
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/simulations") {
    const body = await readBody(req);
    if (!getCrop(body.cropId)) {
      sendJson(res, 400, { error: "Valid cropId is required" });
      return;
    }

    const simulation = createSimulation(body.cropId);
    simulations.set(simulation.id, simulation);
    sendJson(res, 201, { simulation: serializeSimulation(simulation) });
    return;
  }

  const simulationMatch = pathname.match(/^\/api\/simulations\/([^/]+)$/);
  if (req.method === "GET" && simulationMatch) {
    const simulation = simulations.get(simulationMatch[1]);
    if (!simulation) {
      sendJson(res, 404, { error: "Simulation not found" });
      return;
    }

    sendJson(res, 200, { simulation: serializeSimulation(simulation) });
    return;
  }

  const actionMatch = pathname.match(/^\/api\/simulations\/([^/]+)\/actions$/);
  if (req.method === "POST" && actionMatch) {
    const simulation = simulations.get(actionMatch[1]);
    if (!simulation) {
      sendJson(res, 404, { error: "Simulation not found" });
      return;
    }

    const body = await readBody(req);
    try {
      applyAction(simulation, body.action);
      sendJson(res, 200, { simulation: serializeSimulation(simulation) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    serveStatic(res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Soilixa OpenEnv running on http://${HOST}:${PORT}`);
});

module.exports = {
  server
};
