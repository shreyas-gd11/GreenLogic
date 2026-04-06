"use strict";

const { getCrop, getRandomCropType } = require("./crops");
const { generateWeather } = require("./weather");
const { decideActionWithDetails } = require("./aiAgent");
const { getThresholds, normalizeScore } = require("./envRules");
const { calculateReward, describeEnvironment, gradeScore, evaluateDecision } = require("./scoring");

class FarmEnvironment {
  constructor(options = {}) {
    this.fixedCropType = options.cropType || null;
    this.totalScore = 0;
    this.currentState = null;
  }

  reset() {
    const cropType = this.fixedCropType || getRandomCropType();
    const weather = generateWeather();

    this.totalScore = 0;
    this.currentState = {
      day: 1,
      soilMoisture: 50,
      temperature: weather.temperature,
      rainfall: weather.rainfall,
      cropHealth: 80,
      cropType
    };

    return this.state();
  }

  state() {
    if (!this.currentState) {
      return null;
    }

    return { ...this.currentState };
  }

  step(action, options = {}) {
    if (!this.currentState) {
      throw new Error("Environment not initialized. Call reset() first.");
    }

    if (this.currentState.day > 30) {
      return {
        state: this.state(),
        reward: 0,
        done: true
      };
    }

    const crop = getCrop(this.currentState.cropType);
    if (!crop) {
      throw new Error(`Unknown crop type: ${this.currentState.cropType}`);
    }

    const stateBeforeAction = this.state();
    const evaluation = evaluateDecision(stateBeforeAction, action, crop);

    this.applyAction(action);
    this.applyWeather();
    this.updateCropHealth(crop);

    const reward = calculateReward(this.currentState, crop);
    const environment = describeEnvironment(this.currentState, crop);
    this.totalScore += reward;

    this.currentState.day += 1;
    const done = this.currentState.day > 30;

    if (!done) {
      const nextWeather = generateWeather();
      this.currentState.temperature = nextWeather.temperature;
      this.currentState.rainfall = nextWeather.rainfall;
    }

    return {
      day: stateBeforeAction.day,
      mode: options.mode || "learning",
      state: stateBeforeAction,
      aiAction: action,
      correctAction: evaluation.correctAction,
      isCorrect: evaluation.isCorrect,
      reason: evaluation.reason,
      explanation: evaluation.explanation,
      environment,
      reward,
      normalizedReward: normalizeStepReward(reward),
      nextState: this.state(),
      done
    };
  }

  runEpisode(options = {}) {
    const mode = options.mode === "explain" ? "explain" : "learning";
    let currentState = this.reset();
    let done = false;
    const steps = [];

    while (!done) {
      const decision = decideActionWithDetails(currentState);
      const step = this.step(decision.action, { mode });
      steps.push({
        day: step.day,
        state: step.state,
        aiAction: step.aiAction,
        correctAction: step.correctAction,
        isCorrect: step.isCorrect,
        reason: step.reason,
        explanation: mode === "explain" || !step.isCorrect ? step.explanation : undefined,
        environment: step.environment,
        reward: step.reward,
        normalizedReward: step.normalizedReward,
        policySource: decision.source,
        qState: decision.stateKey,
        qValue: decision.qValue
      });

      done = step.done;
      if (!done) {
        currentState = this.state();
      }
    }

    return {
      mode,
      cropType: this.currentState.cropType,
      steps,
      finalScore: this.getTotalScore(),
      normalizedScore: normalizeScore(this.getTotalScore()),
      result: this.getResult()
    };
  }

  getTotalScore() {
    return this.totalScore;
  }

  getResult() {
    return gradeScore(this.totalScore);
  }

  applyAction(action) {
    if (action === "water") {
      this.currentState.soilMoisture += 15;
      return;
    }

    if (action === "fertilize") {
      this.currentState.cropHealth += 6;
      return;
    }

    if (action === "do_nothing") {
      return;
    }

    throw new Error(`Invalid action: ${action}`);
  }

  applyWeather() {
    this.currentState.soilMoisture += this.currentState.rainfall * 0.5;
    this.currentState.soilMoisture -= (this.currentState.temperature - 25) * 0.5;
    this.currentState.soilMoisture -= 2;
    this.currentState.soilMoisture = clamp(this.currentState.soilMoisture, 0, 100);
  }

  updateCropHealth(crop) {
    const thresholds = getThresholds(crop);

    if (this.currentState.soilMoisture > thresholds.high) {
      this.currentState.cropHealth -= 2;
    } else if (this.currentState.soilMoisture < thresholds.low) {
      this.currentState.cropHealth -= 2;
    } else {
      this.currentState.cropHealth += 2;
    }

    this.currentState.cropHealth = clamp(this.currentState.cropHealth, 0, 100);
  }
}

function normalizeStepReward(reward) {
  return Math.max(0, Math.min(1, (reward + 10) / 40));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  FarmEnvironment
};
