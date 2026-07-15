// Shared browser utilities exposed globally so sibling file:// pages can reuse them.
(function (global) {
"use strict";
const { clone, normalizePlan } = global.VeloPlanning;

function createPlanStore(storageKey, initialPlan) {
  let state = clone(initialPlan);
  const listeners = new Set();

  return {
    get: () => clone(state),
    set(next, { persist = true } = {}) {
      state = clone(next);
      if (persist) localStorage.setItem(storageKey, JSON.stringify(state));
      listeners.forEach((listener) => listener(clone(state)));
    },
    loadLocal() {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return false;
      try {
        state = normalizePlan(JSON.parse(saved));
        listeners.forEach((listener) => listener(clone(state)));
        return true;
      } catch {
        localStorage.removeItem(storageKey);
        return false;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function readJsonFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".json")) throw new Error("Choose a JSON file.");
  const raw = JSON.parse(await file.text());
  return normalizePlan(raw.schemaVersion == null && Array.isArray(raw.powerTargets) ? migratePacingPlan(raw, file.name) : raw);
}

// Keep Power Master's established pacing JSON importable while the shared plan schema evolves.
function migratePacingPlan(raw, fileName) {
  const defaults = global.VeloPlanning.createDefaultPlan();
  const durationMinutes = (row) => {
    if (Number.isFinite(Number(row.durationMinutes))) return Number(row.durationMinutes);
    const value = Number(row.duration?.value ?? row.durationValue ?? 0) || 0;
    const unit = row.duration?.unit || row.durationUnit || "minutes";
    return unit === "seconds" ? value / 60 : unit === "hours" ? value * 60 : value;
  };
  const cadence = (value) => {
    if (value == null) return "";
    if (typeof value !== "object") return String(value);
    if (value.min != null && value.max != null) return `${value.min}-${value.max}`;
    if (value.min != null) return `${value.min}+`;
    return String(value.target ?? value.label ?? "");
  };
  return {
    ...defaults,
    schemaVersion: global.VeloPlanning.PLAN_SCHEMA_VERSION,
    source: { tool: "power-master", fileName },
    units: raw.displayUnits === "metric" ? "metric" : "imperial",
    athlete: { ...defaults.athlete, thresholdPower: Number(raw.athlete?.thresholdPower ?? raw.thresholdPower ?? raw.tp ?? raw.ftp) || defaults.athlete.thresholdPower },
    route: { ...defaults.route, movingDurationMinutes: Number(raw.rideDurationMinutes) || defaults.route.movingDurationMinutes },
    tape: {
      ...defaults.tape,
      stemWidthMm: Number(raw.tape?.stemWidthMm) || defaults.tape.stemWidthMm,
      maxLengthMm: Number(raw.tape?.maxLengthMm ?? raw.tape?.lengthMm) || null,
      baseFontSizePt: Number(raw.tape?.baseFontSizePt) || defaults.tape.baseFontSizePt,
    },
    powerTargets: raw.powerTargets.map((row, index) => {
      const power = typeof row.power === "object" ? row.power : { target: row.power };
      const minutes = durationMinutes(row);
      const unit = row.duration?.unit || row.durationUnit || "minutes";
      const value = Number(row.duration?.value ?? row.durationValue);
      return {
        id: row.id || `target-${index + 1}`, label: row.label || `Target ${index + 1}`, terrain: row.terrain || "flat",
        minPower: power?.min ?? row.minPower ?? row.min ?? 0,
        targetPower: power?.target ?? row.targetPower ?? row.target ?? 0,
        maxPower: power?.max ?? row.maxPower ?? row.max ?? 0,
        cadence: cadence(row.cadence), durationMinutes: minutes,
        durationValue: Number.isFinite(value) ? value : minutes, durationUnit: ["seconds", "minutes", "hours"].includes(unit) ? unit : "minutes",
        textColor: row.style?.textColor || row.textColor || row.color || "#455a64",
        backgroundColor: row.style?.backgroundColor || row.backgroundColor || row.background || "#ffffff",
        source: row.source || null, sourceProfile: row.sourceProfile || null,
      };
    }),
  };
}

function downloadFile(fileName, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  // Firefox can cancel a file:// download if the object URL is revoked in the same task.
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 1000);
}

function downloadJson(fileName, value) {
  downloadFile(fileName, JSON.stringify(value, null, 2), "application/json");
}

const statusTimers = new WeakMap();

function setStatus(element, message, kind = "info") {
  const previousTimer = statusTimers.get(element);
  if (previousTimer) clearTimeout(previousTimer);
  element.textContent = message;
  element.dataset.kind = kind;
  element.classList.toggle("is-visible", Boolean(message));
  if (message) {
    const timer = setTimeout(() => element.classList.remove("is-visible"), kind === "error" ? 6500 : 4000);
    statusTimers.set(element, timer);
  }
}

function wholeWatts(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

global.VeloApp = { createPlanStore, readJsonFile, downloadFile, downloadJson, setStatus, wholeWatts };
})(globalThis);
