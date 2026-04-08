from __future__ import annotations

import math
import random
from dataclasses import replace
from uuid import uuid4

from greenlogic_models import CropTask, GreenLogicAction, GreenLogicObservation, GreenLogicState, StepResult, Thresholds

try:
    import numpy as np
except ImportError:  # pragma: no cover - numpy is optional for this local environment
    np = None

EPISODE_LENGTH = 30
MAX_FINAL_SCORE = 400
DEFAULT_SEED = 42

CROPS: dict[str, CropTask] = {
    "tomato": CropTask(
        cropType="tomato",
        displayName="Tomato",
        difficulty="Easy",
        thresholds=Thresholds(optimalMin=50.0, optimalMax=60.0, low=45.0, high=75.0),
        temperatureRange=(20.0, 30.0),
        rainfallRange=(0.0, 10.0),
        waterBoost=14.0,
        fertilizerDays=(6, 13, 20, 27),
        evaporationRate=0.42,
        naturalDrying=2.0,
    ),
    "rice": CropTask(
        cropType="rice",
        displayName="Rice",
        difficulty="Medium",
        thresholds=Thresholds(optimalMin=70.0, optimalMax=80.0, low=62.0, high=95.0),
        temperatureRange=(25.0, 35.0),
        rainfallRange=(4.0, 16.0),
        waterBoost=11.0,
        fertilizerDays=(5, 11, 18, 25),
        evaporationRate=0.36,
        naturalDrying=1.2,
    ),
    "sugarcane": CropTask(
        cropType="sugarcane",
        displayName="Sugarcane",
        difficulty="Hard",
        thresholds=Thresholds(optimalMin=60.0, optimalMax=70.0, low=52.0, high=85.0),
        temperatureRange=(24.0, 34.0),
        rainfallRange=(0.0, 12.0),
        waterBoost=12.0,
        fertilizerDays=(7, 14, 21, 28),
        evaporationRate=0.48,
        naturalDrying=2.6,
    ),
}


def seed_everything(seed: int = DEFAULT_SEED) -> int:
    random.seed(seed)
    if np is not None:
        np.random.seed(seed)
    return seed


class GreenLogicEnv:
    """Typed OpenEnv-style crop environment with Gym-like reset/step/state APIs."""

    def __init__(self, crop_type: str = "tomato", seed: int | None = DEFAULT_SEED) -> None:
        self._requested_crop_type = crop_type
        self._seed = seed_everything(DEFAULT_SEED if seed is None else seed)
        self._rng = random.Random(self._seed)
        self._state: GreenLogicState | None = None

    def reset(self, crop_type: str | None = None, seed: int | None = None) -> StepResult:
        if seed is not None:
            self._seed = seed_everything(seed)
            self._rng.seed(self._seed)

        selected_crop = crop_type or self._requested_crop_type
        crop = self._get_crop(selected_crop)
        weather, temperature, rainfall = self._generate_weather(crop, day=1)
        starting_moisture = self._initial_moisture(crop)

        self._state = GreenLogicState(
            episodeId=str(uuid4()),
            stepCount=0,
            day=1,
            soilMoisture=starting_moisture,
            temperature=temperature,
            cropHealth=82.0,
            cropType=crop.cropType,
            difficulty=crop.difficulty,
            rainfall=rainfall,
            weather=weather,
            thresholds=crop.thresholds,
            cumulativeReward=0.0,
            totalScore=0,
            done=False,
            lastAction=None,
        )
        return StepResult(
            observation=self._observation(),
            reward=0.0,
            done=False,
            info={"event": "reset", "episodeLength": EPISODE_LENGTH},
        )

    def step(self, action: str | GreenLogicAction) -> StepResult:
        if self._state is None:
            raise RuntimeError("Environment not initialized. Call reset() first.")
        if self._state.done:
            raise RuntimeError("Episode is complete. Call reset() before stepping again.")

        state = self._state
        crop = self._get_crop(state.cropType)
        action_model = GreenLogicAction.from_value(action)

        completed_day = state.day
        soil_moisture = state.soilMoisture
        crop_health = state.cropHealth

        if action_model.action == "water":
            soil_moisture += crop.waterBoost
        elif action_model.action == "fertilize":
            crop_health += self._fertilizer_effect(state)

        soil_moisture += state.rainfall
        soil_moisture -= max(0.0, state.temperature - crop.temperatureRange[0]) * crop.evaporationRate
        soil_moisture -= crop.naturalDrying
        soil_moisture = self._clamp(soil_moisture, 0.0, 100.0)

        crop_health += self._health_delta(soil_moisture, state.temperature, crop)
        crop_health = self._clamp(crop_health, 0.0, 100.0)

        reward = self._calculate_reward(soil_moisture, crop_health, state.temperature, crop)
        cumulative_reward = state.cumulativeReward + reward
        total_score = self._score_from_reward(cumulative_reward)
        done = completed_day >= EPISODE_LENGTH or crop_health <= 0.0

        next_weather = state.weather
        next_temperature = state.temperature
        next_rainfall = state.rainfall
        next_day = completed_day

        if not done:
            next_day = completed_day + 1
            next_weather, next_temperature, next_rainfall = self._generate_weather(crop, next_day)

        self._state = replace(
            state,
            stepCount=state.stepCount + 1,
            day=next_day,
            soilMoisture=round(soil_moisture, 2),
            temperature=round(next_temperature, 2),
            cropHealth=round(crop_health, 2),
            rainfall=round(next_rainfall, 2),
            weather=next_weather,
            cumulativeReward=round(cumulative_reward, 4),
            totalScore=total_score,
            done=done,
            lastAction=action_model.action,
        )

        return StepResult(
            observation=self._observation(),
            reward=round(reward, 4),
            done=done,
            info={
                "completedDay": completed_day,
                "action": action_model.action,
                "difficulty": crop.difficulty,
                "weatherUsed": {
                    "type": state.weather,
                    "rainfall": state.rainfall,
                    "temperature": state.temperature,
                },
                "thresholds": crop.thresholds.to_dict(),
                "finalScore": total_score,
                "normalizedScore": round(total_score / MAX_FINAL_SCORE, 4),
            },
        )

    def state(self) -> GreenLogicState:
        if self._state is None:
            raise RuntimeError("Environment not initialized. Call reset() first.")
        return replace(self._state)

    def final_score(self) -> int:
        if self._state is None:
            return 0
        return self._state.totalScore

    def normalized_score(self) -> float:
        return round(self._clamp(self.final_score() / MAX_FINAL_SCORE, 0.0, 1.0), 4)

    def result_label(self) -> str:
        score = self.final_score()
        if score >= 340:
            return "Excellent Crop"
        if score >= 260:
            return "Good Crop"
        if score >= 180:
            return "Average Crop"
        return "Poor Crop"

    def _observation(self) -> GreenLogicObservation:
        if self._state is None:
            raise RuntimeError("Environment not initialized. Call reset() first.")
        return GreenLogicObservation(
            day=self._state.day,
            soilMoisture=self._state.soilMoisture,
            temperature=self._state.temperature,
            cropHealth=self._state.cropHealth,
            cropType=self._state.cropType,
            difficulty=self._state.difficulty,
            rainfall=self._state.rainfall,
            weather=self._state.weather,
            thresholds=self._state.thresholds,
            normalizedScore=round(self._state.totalScore / MAX_FINAL_SCORE, 4),
        )

    def _calculate_reward(self, soil_moisture: float, crop_health: float, temperature: float, crop: CropTask) -> float:
        thresholds = crop.thresholds
        optimal_midpoint = (thresholds.optimalMin + thresholds.optimalMax) / 2
        optimal_radius = max(1.0, (thresholds.optimalMax - thresholds.optimalMin) / 2)
        moisture_distance = abs(soil_moisture - optimal_midpoint)
        moisture_score = max(0.0, 1.0 - (moisture_distance / (optimal_radius * 2.5)))
        health_score = crop_health / 100.0

        penalty = 0.0
        if soil_moisture < thresholds.low:
            penalty += min(0.35, (thresholds.low - soil_moisture) / thresholds.low)
        if soil_moisture > thresholds.high:
            overflow = soil_moisture - thresholds.high
            penalty += min(0.4, overflow / max(1.0, 100.0 - thresholds.high))
        low_temp, high_temp = crop.temperatureRange
        if temperature < low_temp:
            penalty += min(0.12, (low_temp - temperature) / low_temp)
        if temperature > high_temp:
            penalty += min(0.12, (temperature - high_temp) / high_temp)

        reward = (0.55 * moisture_score) + (0.45 * health_score) - penalty + self._difficulty_modifier(crop)
        return self._clamp(reward, 0.0, 1.0)

    def _fertilizer_effect(self, state: GreenLogicState) -> float:
        crop = self._get_crop(state.cropType)
        thresholds = crop.thresholds
        if state.day in crop.fertilizerDays and thresholds.low <= state.soilMoisture <= thresholds.high:
            return 5.5
        if state.soilMoisture < thresholds.low:
            return -2.0
        return 1.5

    def _health_delta(self, soil_moisture: float, temperature: float, crop: CropTask) -> float:
        thresholds = crop.thresholds
        if thresholds.optimalMin <= soil_moisture <= thresholds.optimalMax:
            moisture_delta = 2.5
        elif thresholds.low <= soil_moisture <= thresholds.high:
            moisture_delta = 0.8
        elif soil_moisture < thresholds.low:
            moisture_delta = -4.0
        else:
            moisture_delta = -4.5

        low_temp, high_temp = crop.temperatureRange
        temp_delta = 0.6 if low_temp <= temperature <= high_temp else -1.4
        return moisture_delta + temp_delta

    def _generate_weather(self, crop: CropTask, day: int) -> tuple[str, float, float]:
        base_low, base_high = crop.temperatureRange
        seasonal_wave = math.sin(day / 4.0) * 2.2
        weather_roll = self._rng.random()

        if weather_roll < 0.18:
            weather = "rainy"
            base_rainfall = self._rng.uniform(max(4.0, crop.rainfallRange[0]), crop.rainfallRange[1])
            base_temp = self._rng.uniform(base_low - 1.5, base_high - 1.0)
        elif weather_roll < 0.35:
            weather = "cloudy"
            base_rainfall = self._rng.uniform(0.0, crop.rainfallRange[1] * 0.35)
            base_temp = self._rng.uniform(base_low - 1.0, base_high - 2.0)
        elif weather_roll < 0.88:
            weather = "sunny"
            base_rainfall = self._rng.uniform(0.0, crop.rainfallRange[1] * 0.15)
            base_temp = self._rng.uniform(base_low + 0.5, base_high + 1.5)
        else:
            weather = "heatwave"
            base_rainfall = 0.0
            base_temp = self._rng.uniform(base_high + 1.5, base_high + 4.0)

        rainfall = base_rainfall + self._rng.uniform(-2.0, 2.0)
        temperature = base_temp + self._rng.uniform(-1.0, 1.0)
        temperature = self._clamp(temperature + seasonal_wave, 18.0, 42.0)
        rainfall = self._clamp(rainfall, 0.0, 20.0)
        return weather, round(temperature, 2), round(rainfall, 2)

    def _initial_moisture(self, crop: CropTask) -> float:
        thresholds = crop.thresholds
        midpoint = (thresholds.optimalMin + thresholds.optimalMax) / 2
        return round(self._clamp(midpoint + self._rng.uniform(-4.0, 4.0), 0.0, 100.0), 2)

    def _get_crop(self, crop_type: str) -> CropTask:
        try:
            return CROPS[crop_type]
        except KeyError as error:
            valid = ", ".join(sorted(CROPS))
            raise ValueError(f"Unknown crop type '{crop_type}'. Expected one of: {valid}.") from error

    @staticmethod
    def _difficulty_modifier(crop: CropTask) -> float:
        if crop.difficulty == "Easy":
            return 0.0125
        if crop.difficulty == "Hard":
            return -0.005
        return 0.0

    @staticmethod
    def _score_from_reward(cumulative_reward: float) -> int:
        scaled = round((cumulative_reward / EPISODE_LENGTH) * MAX_FINAL_SCORE)
        return int(GreenLogicEnv._clamp(scaled, 0, MAX_FINAL_SCORE))

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))
