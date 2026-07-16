// Query-driven calculation overrides and responsive debug profiles.
// This remains a classic script so both tools continue to work over file://.
(function (global) {
"use strict";

const query = new URLSearchParams(global.location.search);
const debugEnabled = query.has("debug_profile");
const debugProfile = query.get("debug_profile") || "0";
const storageKey = "velo-tools:debug-math-model-overrides";

// Keys name both the domain and the calculation being replaced. Keep these
// stable so a copied debug configuration remains understandable on its own.
const models = {
  "routePhysics.mechanicalPower": {
    label: "Route physics — mechanical power",
    defaults: { gravityMps2: 9.80665, airDensityKgM3: 1.225, drivetrainEfficiency: 0.97 },
  },
  "workload.thresholdRelative": {
    label: "Workload — threshold-relative score",
    defaults: { intensityExponent: 2, scorePerHour: 100 },
  },
  "profile.targetDurationClassification": {
    label: "Profile — target-duration classification",
    defaults: {
      climberElevationMPerKm: 10, climberTimeShare: 0.25,
      gcElevationMPerKm: 5, gcTimeShare: 0.22,
      timeTrialElevationMaxMPerKm: 2, timeTrialClimbShareMax: 0.08,
      timeTrialIntensityMin: 0.88, difficultIntensityMin: 0.85,
    },
  },
  "demand.profileSuggestions": {
    label: "Demand — profile suggestion workload",
    defaults: { moderateIntensity: 0.7, difficultIntensity: 0.85, minimumDurationHours: 0.25 },
  },
  "fueling.automaticCarbohydrateRate": {
    label: "Fueling — automatic carbohydrate rate",
    defaults: {
      intensityBreakpoints: [0.6, 0.7, 0.8, 0.9],
      gramsPerHourTiers: [35, 45, 55, 70, 85],
      hardEffortMultiplier: 0.5, hardEffortMaximum: 5, sprintMaximum: 5,
      longRideHours: 3, longRideBonus: 5, veryLongRideHours: 5,
      veryLongRideBonus: 10, maximumGramsPerHour: 90,
    },
  },
  "fueling.gelConcentration": {
    label: "Fueling — gel concentration and hydration",
    defaults: {
      flaskCapacityGramsPerOz: 20, waterRecommendedAboveGrams: 45,
      minimumLiquidOz: 2, liquidOzPerGram: 0.035, minimumLiquidOzPerStop: 2,
    },
  },
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function loadOverrides() {
  if (!debugEnabled) return {};
  try {
    const parsed = JSON.parse(global.sessionStorage.getItem(storageKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

let overrides = loadOverrides();

function get(key) {
  const definition = models[key];
  if (!definition) throw new Error(`Unknown math model: ${key}`);
  const supplied = overrides[key];
  return { ...clone(definition.defaults), ...(supplied && typeof supplied === "object" ? clone(supplied) : {}) };
}

function normalizeOverrides(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("The configuration must be a JSON object.");
  const normalized = {};
  for (const [key, supplied] of Object.entries(input)) {
    if (!models[key]) throw new Error(`Unknown math model key: ${key}`);
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new Error(`${key} must contain an object.`);
    normalized[key] = {};
    for (const [field, value] of Object.entries(supplied)) {
      if (!(field in models[key].defaults)) throw new Error(`Unknown ${key} field: ${field}`);
      const expected = models[key].defaults[field];
      if (Array.isArray(expected)) {
        if (!Array.isArray(value) || value.some((item) => !Number.isFinite(Number(item)))) throw new Error(`${key}.${field} must be a numeric array.`);
        normalized[key][field] = value.map(Number);
      } else {
        if (!Number.isFinite(Number(value))) throw new Error(`${key}.${field} must be numeric.`);
        normalized[key][field] = Number(value);
      }
    }
  }
  return normalized;
}

function installResponsiveDebugFrame() {
  if (!debugEnabled || query.has("debug_embedded") || !["mobile1", "mobile2"].includes(debugProfile)) return false;
  const width = debugProfile === "mobile1" ? 360 : 414;
  const url = new URL(global.location.href);
  url.searchParams.set("debug_embedded", "1");
  global.document.body.className = "debug-profile-host";
  global.document.body.innerHTML = "";
  const frame = global.document.createElement("iframe");
  frame.className = "debug-profile-frame";
  frame.title = `${width}px mobile debug profile`;
  frame.style.width = `${width}px`;
  frame.src = url.href;
  global.document.body.appendChild(frame);
  return true;
}

function renderEditor() {
  if (!debugEnabled || global.document.body.classList.contains("debug-profile-host")) return;
  global.document.body.classList.add("debug-mode", `debug-profile-${debugProfile.replace(/[^a-z0-9_-]/gi, "-")}`);
  const planningRoot = global.document.querySelector("#planning-fields");
  if (!planningRoot || global.document.querySelector("#section-debug-config")) return;

  const section = global.document.createElement("details");
  section.id = "section-debug-config";
  section.className = "card collapsible-section debug-config-section";
  section.open = true;
  section.innerHTML = `
    <summary class="section-title"><div class="section-heading"><h2>Config Parameters</h2></div><div class="section-actions"><button type="button" class="icon-button section-fullscreen-toggle" data-debug-fullscreen title="Fullscreen Config Parameters" aria-label="Fullscreen Config Parameters"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg></button></div></summary>
    <div class="debug-config-toolbar">
      <label class="field"><span>Math Model</span><select data-debug-model></select></label>
      <button type="button" data-debug-add-model>Add Model</button>
    </div>
    <label class="field debug-config-editor"><span>Math Model Overrides (JSON)</span><textarea data-debug-json spellcheck="false" rows="14"></textarea></label>
    <div class="debug-config-actions"><button type="button" data-debug-apply>Apply Overrides</button><button type="button" class="danger" data-debug-reset>Reset Overrides</button></div>
    <p class="status debug-config-status" role="status" aria-live="polite"></p>`;
  planningRoot.parentNode.insertBefore(section, planningRoot);

  const select = section.querySelector("[data-debug-model]");
  Object.entries(models).forEach(([key, definition]) => {
    const option = global.document.createElement("option");
    option.value = key;
    option.textContent = `${definition.label} (${key})`;
    select.appendChild(option);
  });
  const editor = section.querySelector("[data-debug-json]");
  const status = section.querySelector(".debug-config-status");
  const fullscreen = section.querySelector("[data-debug-fullscreen]");
  const fullscreenIcon = (active) => active
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';
  const setFullscreen = (active) => {
    section.classList.toggle("is-section-fullscreen", active);
    fullscreen.classList.toggle("is-active", active);
    fullscreen.title = active ? "Restore Config Parameters" : "Fullscreen Config Parameters";
    fullscreen.setAttribute("aria-label", fullscreen.title);
    fullscreen.innerHTML = fullscreenIcon(active);
  };
  fullscreen.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setFullscreen(!section.classList.contains("is-section-fullscreen"));
  });
  global.document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && section.classList.contains("is-section-fullscreen")) setFullscreen(false);
  });
  const write = (value) => { editor.value = JSON.stringify(value, null, 2); };
  write(overrides);

  section.querySelector("[data-debug-add-model]").addEventListener("click", () => {
    try {
      const current = editor.value.trim() ? JSON.parse(editor.value) : {};
      current[select.value] = clone(models[select.value].defaults);
      write(current);
      status.textContent = `Added ${select.value}.`;
    } catch (error) { status.textContent = error.message; }
  });
  section.querySelector("[data-debug-apply]").addEventListener("click", () => {
    try {
      overrides = normalizeOverrides(editor.value.trim() ? JSON.parse(editor.value) : {});
      global.sessionStorage.setItem(storageKey, JSON.stringify(overrides));
      status.textContent = "Overrides applied. Reloading calculations…";
      global.location.reload();
    } catch (error) { status.textContent = error.message; }
  });
  section.querySelector("[data-debug-reset]").addEventListener("click", () => {
    overrides = {};
    global.sessionStorage.removeItem(storageKey);
    write(overrides);
    status.textContent = "Math model overrides cleared. Reloading calculations…";
    global.location.reload();
  });
}

global.VeloModelConfig = { debugEnabled, debugProfile, get, models };
global.addEventListener("DOMContentLoaded", () => {
  if (!installResponsiveDebugFrame()) renderEditor();
});
})(globalThis);
