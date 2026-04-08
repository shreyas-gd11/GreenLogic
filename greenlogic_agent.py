from __future__ import annotations

from greenlogic_models import GreenLogicAction, GreenLogicObservation


class BaselineGreenLogicAgent:
    """Safety-first baseline policy for the typed GreenLogic OpenEnv."""

    def __init__(self) -> None:
        self.epsilon = 0.0

    def act(self, observation: GreenLogicObservation) -> GreenLogicAction:
        thresholds = observation.thresholds

        if observation.soilMoisture > thresholds.high:
            return GreenLogicAction("do_nothing")

        if observation.soilMoisture < thresholds.optimalMin:
            return GreenLogicAction("water")

        fertilizer_window = observation.day in self._fertilizer_days(observation.cropType)
        stable_moisture = thresholds.optimalMin <= observation.soilMoisture <= thresholds.optimalMax

        if fertilizer_window and stable_moisture and observation.cropHealth < 95.0:
            return GreenLogicAction("fertilize")

        if observation.cropHealth < 72.0 and thresholds.low <= observation.soilMoisture <= thresholds.high:
            return GreenLogicAction("fertilize")

        if observation.temperature > self._heat_threshold(observation.cropType) and observation.soilMoisture < thresholds.optimalMax:
            return GreenLogicAction("water")

        if observation.weather == "sunny" and observation.rainfall < 1.0 and observation.soilMoisture < thresholds.optimalMax - 4.0:
            return GreenLogicAction("water")

        return GreenLogicAction("do_nothing")

    @staticmethod
    def _fertilizer_days(crop_type: str) -> set[int]:
        if crop_type == "tomato":
            return {6, 13, 20, 27}
        if crop_type == "rice":
            return {5, 11, 18, 25}
        return {7, 14, 21, 28}

    @staticmethod
    def _heat_threshold(crop_type: str) -> float:
        if crop_type == "tomato":
            return 30.0
        if crop_type == "rice":
            return 35.0
        return 34.0
