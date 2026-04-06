"use strict";

const crops = {
  tomato: {
    name: "Tomato",
    optimalMoisture: 60,
    maxMoisture: 78,
    moistureRange: [45, 68],
    temperatureRange: [20, 30],
    fertilizerDays: [6, 13, 20, 27]
  },
  rice: {
    name: "Rice",
    optimalMoisture: 78,
    maxMoisture: 95,
    moistureRange: [62, 88],
    temperatureRange: [25, 35],
    fertilizerDays: [5, 11, 18, 25]
  },
  sugarcane: {
    name: "Sugarcane",
    optimalMoisture: 68,
    maxMoisture: 88,
    moistureRange: [52, 74],
    temperatureRange: [24, 34],
    fertilizerDays: [7, 14, 21, 28]
  }
};

function getCrop(cropType) {
  return crops[cropType] || null;
}

function getRandomCropType() {
  const cropTypes = Object.keys(crops);
  const index = Math.floor(Math.random() * cropTypes.length);
  return cropTypes[index];
}

module.exports = {
  crops,
  getCrop,
  getRandomCropType
};
