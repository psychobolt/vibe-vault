// Pure numeric helpers shared by planning, route parsing, and tool controllers.
// Kept as a classic script so the tools continue to work directly over file://.
(function (global) {
"use strict";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finiteNumber(value, minimum)));
}

function roundTo(value, places = 0) {
  const factor = 10 ** places;
  return Math.round(finiteNumber(value) * factor) / factor;
}

function wholeNumber(value, minimum = 0) {
  return Math.max(minimum, Math.round(finiteNumber(value)));
}

function roundDurationValue(value, unit) {
  return roundTo(value, unit === "seconds" ? 0 : unit === "hours" ? 2 : 1);
}

function haversineDistanceMeters(a, b) {
  const radius = 6371000;
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const term = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(term), Math.sqrt(1 - term));
}

const conversions = {
  kgToLb: (kg) => kg * 2.2046226218,
  lbToKg: (lb) => lb / 2.2046226218,
  kmToMi: (km) => km * 0.6213711922,
  miToKm: (mi) => mi / 0.6213711922,
  mToFt: (m) => m * 3.280839895,
  ftToM: (ft) => ft / 3.280839895,
};

global.VeloMath = {
  finiteNumber,
  clamp,
  roundTo,
  wholeNumber,
  roundDurationValue,
  haversineDistanceMeters,
  conversions,
};
})(globalThis);
