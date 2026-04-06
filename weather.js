"use strict";

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateWeather() {
  return {
    temperature: randomInt(25, 40),
    rainfall: randomInt(0, 20)
  };
}

module.exports = {
  generateWeather
};
