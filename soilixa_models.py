from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

ActionName = Literal["water", "fertilize", "do_nothing"]
DifficultyName = Literal["Easy", "Medium", "Hard"]
WeatherName = Literal["sunny", "cloudy", "rainy", "heatwave"]


@dataclass(frozen=True)
class Thresholds:
    optimalMin: float
    optimalMax: float
    low: float
    high: float

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class CropTask:
    cropType: str
    displayName: str
    difficulty: DifficultyName
    thresholds: Thresholds
    temperatureRange: tuple[float, float]
    rainfallRange: tuple[float, float]
    waterBoost: float
    fertilizerDays: tuple[int, ...]
    evaporationRate: float
    naturalDrying: float

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["thresholds"] = self.thresholds.to_dict()
        return payload


@dataclass(frozen=True)
class SoilixaAction:
    action: ActionName

    def __post_init__(self) -> None:
        if self.action not in {"water", "fertilize", "do_nothing"}:
            raise ValueError(f"Unsupported action: {self.action}")

    @classmethod
    def from_value(cls, value: str | "SoilixaAction") -> "SoilixaAction":
        if isinstance(value, SoilixaAction):
            return value
        return cls(action=value)


@dataclass
class SoilixaObservation:
    day: int
    soilMoisture: float
    temperature: float
    cropHealth: float
    cropType: str
    difficulty: DifficultyName
    rainfall: float
    weather: WeatherName
    thresholds: Thresholds
    normalizedScore: float

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["thresholds"] = self.thresholds.to_dict()
        return payload


@dataclass
class SoilixaState:
    episodeId: str
    stepCount: int
    day: int
    soilMoisture: float
    temperature: float
    cropHealth: float
    cropType: str
    difficulty: DifficultyName
    rainfall: float
    weather: WeatherName
    thresholds: Thresholds
    cumulativeReward: float
    totalScore: int
    done: bool
    lastAction: ActionName | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["thresholds"] = self.thresholds.to_dict()
        return payload


@dataclass
class StepResult:
    observation: SoilixaObservation
    reward: float
    done: bool
    info: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "observation": self.observation.to_dict(),
            "reward": self.reward,
            "done": self.done,
            "info": self.info,
        }
