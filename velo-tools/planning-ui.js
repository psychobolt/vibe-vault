// Reusable Steps 1–4 UI. Kept as a classic script for direct file:// use.
(function (global) {
"use strict";
const { PROFILES, RESISTANCE_PRESETS, conversions } = global.VeloPlanning;

const number = (value, digits = 1) => Number(value || 0).toFixed(digits).replace(/\.0$/, "");

function renderPlanningUI(root, plan, {
  locked = false,
  onChange = () => {},
  onActivityFile = () => {},
  onClearActivity = () => {},
  sectionActions = {},
  showUnits = true,
} = {}) {
  const imperial = plan.units === "imperial";
  const weight = (kg) => number(imperial ? conversions.kgToLb(kg) : kg);
  const distance = number(imperial ? conversions.kmToMi(plan.route.distanceKm) : plan.route.distanceKm);
  const elevation = number(imperial ? conversions.mToFt(plan.route.elevationGainM) : plan.route.elevationGainM, 0);
  const disabled = locked ? "disabled" : "";
  const routeDerived = Boolean(plan.route.activityFileName);
  const demandDisabled = locked || plan.demand.mode === "target-duration" ? "disabled" : "";
  const derivedProfileDisabled = locked || plan.demand.mode === "target-duration" ? "disabled" : "";

  root.innerHTML = `
    ${section("athlete", "1", "Athlete and Equipment", `
      <div class="field-grid field-grid--six">
        ${showUnits ? selectField("Units", "units", [["imperial", "Imperial"], ["metric", "Metric"]], plan.units, "", "Changes the displayed weight and the units used for route and fueling measurements.") : ""}
        ${numberField(`Rider Weight (${imperial ? "lb" : "kg"})`, "athlete.riderWeightKg", weight(plan.athlete.riderWeightKg), disabled, "0.1", "Rider body mass. Combined with bike and carried equipment for climbing and rolling-resistance estimates.")}
        ${numberField(`Bike Weight (${imperial ? "lb" : "kg"})`, "athlete.bikeWeightKg", weight(plan.athlete.bikeWeightKg), disabled, "0.1", "Bike mass used with rider and carried equipment in Meet Target Duration calculations.")}
        ${numberField(`Carried Equipment (${imperial ? "lb" : "kg"})`, "athlete.carriedWeightKg", weight(plan.athlete.carriedWeightKg), disabled, "0.1", "Clothing, bottles, tools, and other carried mass included in total system weight.")}
        ${numberField("Threshold Power", "athlete.thresholdPower", plan.athlete.thresholdPower, disabled, "1", "Sustainable threshold power used to calculate relative intensity, workload, and profile difficulty.")}
        ${numberField("Low Threshold Power", "athlete.lowThresholdPower", plan.athlete.lowThresholdPower, disabled, "1", "The transition from steady aerobic riding toward harder sustained effort. Retained as part of the athlete model.")}
        ${numberField("Peak Power", "athlete.peakPower", plan.athlete.peakPower, disabled, "1", "Maximum short-duration power retained for sprint-oriented planning and shared Power Master parameters.")}
      </div>`, sectionActions)}
    ${section("route", "2", "Route and Duration", `
      <div class="activity-control">
        <input class="file-input" type="file" accept=".gpx,.tcx,application/gpx+xml,application/vnd.garmin.tcx+xml" data-activity-file ${disabled}>
        <button type="button" class="activity-load" data-open-activity ${routeDerived ? "hidden" : ""} ${disabled}>Load Activity Route</button>
        <div class="loaded-file-control activity-loaded-control ${locked ? "is-locked" : ""}" ${routeDerived ? "" : "hidden"}>
          <input type="text" readonly value="${escapeAttribute(plan.route.activityFileName || "")}" data-open-activity aria-label="Loaded activity route" title="Click to replace the loaded activity route" ${disabled}>
          ${!locked ? `<button type="button" class="icon-button danger" data-clear-activity title="Remove activity route" aria-label="Remove activity route">${trashIcon()}</button>` : ""}
        </div>
      </div>
      <div class="field-grid field-grid--six">
        ${showUnits ? selectField("Units", "units", [["imperial", "Imperial"], ["metric", "Metric"]], plan.units, "", "Changes the displayed route distance and elevation units without changing the underlying plan.") : ""}
        ${numberField(`Activity Distance (${imperial ? "mi" : "km"})`, "route.distanceKm", distance, locked || routeDerived ? "disabled" : "", "0.1", "Distance from the loaded activity route, or a manual route distance when no activity is loaded.")}
        ${numberField(`Elevation Gain (${imperial ? "ft" : "m"})`, "route.elevationGainM", elevation, locked || routeDerived ? "disabled" : "", "1", "Total ascent used by the route-physics estimate and route-oriented profile matching.")}
        ${numberField("Moving Duration (min)", "route.movingDurationMinutes", number(plan.route.movingDurationMinutes), disabled, "0.1", "Planned time spent moving. Power workload and planned average speed use this duration.")}
        ${numberField("Stopped Duration (min)", "route.stoppedDurationMinutes", number(plan.route.stoppedDurationMinutes), disabled, "0.1", "Planned stops, aid stations, traffic, and rest. Fueling uses moving plus stopped duration.")}
        ${numberField("Climbing Duration (min)", "route.climbingDurationMinutes", number(plan.route.climbingDurationMinutes), disabled, "0.1", "Minutes spent on uphill segments at a grade of 2% or steeper. Parsed from supported activity files when possible.")}
        ${numberField("Decline Duration (min)", "route.declineDurationMinutes", number(plan.route.declineDurationMinutes), disabled, "0.1", "Minutes spent on downhill segments at a grade of -2% or steeper. Parsed from supported activity files when possible.")}
      </div>`, sectionActions)}
    ${section("resistance", "3", "Ride Resistance", `
      <div class="field-grid field-grid--three">
        ${selectField("Ride Conditions", "resistance.preset", [["aero", "Fast / Aero"], ["typical", "Typical Road"], ["custom", "Custom"]], plan.resistance.preset, disabled, "Choose a preset or Custom. Presets populate CdA and rolling resistance for Meet Target Duration mode.")}
        ${numberField("CdA (m²)", "resistance.cda", plan.resistance.cda, disabled, "0.01", "Aerodynamic drag area. Lower values require less power at higher speed.")}
        ${numberField("Rolling Resistance (Crr)", "resistance.crr", plan.resistance.crr, disabled, "0.001", "Rolling-resistance coefficient for the tires and road surface. Typical road values are around 0.003 to 0.008.")}
      </div>`, sectionActions)}
    ${section("demand", "4", "Demand and Profile", `
      <div class="field-grid field-grid--three">
        ${selectField("Planning Mode", "demand.mode", [["target-duration", "Meet Target Duration"], ["imported", "Use Imported Demand"], ["manual", "Manual Demand"]], plan.demand.mode, disabled, "Choose whether demand is estimated from route and target duration, supplied by imported parameters, or entered manually.")}
        ${selectField("Profile", "demand.profile", PROFILES.map((profile) => [profile.id, `${profile.label} (${profile.bestPower})`]), plan.demand.profile, derivedProfileDisabled, "Describes the ride's power-duration emphasis. Meet Target Duration selects a route-oriented profile automatically.")}
        ${selectField("Difficulty", "demand.difficulty", [["moderate", "Moderate"], ["difficult", "Difficult"]], plan.demand.difficulty, derivedProfileDisabled, "Describes the required intensity tier. Meet Target Duration derives it from estimated average power relative to threshold power.")}
      </div>
      <div class="field-grid field-grid--three">
        ${numberField("Aerobic Demand", "demand.aerobic", number(plan.demand.aerobic), demandDisabled, "0.1", "Steady endurance workload accumulated below the lower threshold. This usually makes up most of the ride's workload.")}
        ${numberField("Hard-Effort Demand", "demand.hardEffort", number(plan.demand.hardEffort), demandDisabled, "0.1", "Workload from sustained hard efforts such as attacks, hard climbs, or prolonged surges.")}
        ${numberField("Sprint Demand", "demand.sprint", number(plan.demand.sprint), demandDisabled, "0.1", "Workload from very short explosive efforts near maximum power, such as sprints or sharp accelerations.")}
      </div>`, sectionActions)}
  `;

  root.onchange = (event) => {
    if (event.target.matches("[data-activity-file]")) {
      const file = event.target.files[0];
      if (file) onActivityFile(file);
      return;
    }
    const input = event.target.closest("[data-path]");
    if (!input || (locked && input.dataset.path !== "units")) return;
    const next = structuredClone(plan);
    updatePlanValue(next, input.dataset.path, input.value, imperial);
    onChange(next, input.dataset.path);
  };
  root.onclick = (event) => {
    const action = event.target.closest("[data-section-action]");
    if (action && !action.disabled) sectionActions[action.dataset.sectionAction]?.(action.dataset.section);
    if (event.target.closest("[data-open-activity]") && !locked) root.querySelector("[data-activity-file]")?.click();
    if (event.target.closest("[data-clear-activity]")) onClearActivity();
  };
}

function section(id, step, title, body, actions) {
  const state = actions.state?.[id] || {};
  return `<section class="card"><header class="section-title"><div class="section-heading"><span>Step ${step}</span><h2>${title}</h2></div><div class="section-actions">
    ${actionButton("undo", id, "Undo", undoIcon(), state.canUndo === false)}
    ${actionButton("redo", id, "Redo", redoIcon(), state.canRedo === false)}
    ${actionButton("reset", id, "Reset section", trashIcon(), false, "danger")}
  </div></header>${body}</section>`;
}

function actionButton(action, sectionId, label, icon, disabled, extra = "") {
  return `<button type="button" class="icon-button ${extra}" data-section-action="${action}" data-section="${sectionId}" title="${label}" aria-label="${label}" ${disabled ? "disabled" : ""}>${icon}</button>`;
}

function undoIcon() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M7.5 7H16a5 5 0 0 1 0 10h-4v-2h4a3 3 0 0 0 0-6H7.5l3 3L9 13.5 3.5 8 9 2.5 10.5 4l-3 3Z"/></svg>`; }
function redoIcon() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M16.5 7H8a5 5 0 0 0 0 10h4v-2H8a3 3 0 0 1 0-6h8.5l-3 3 1.5 1.5L20.5 8 15 2.5 13.5 4l3 3Z"/></svg>`; }
function trashIcon() { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>`; }

function numberField(label, path, value, disabled, step = "0.1", help = "") {
  const demandClass = path === "demand.aerobic" ? " demand-low" : path === "demand.hardEffort" ? " demand-high" : path === "demand.sprint" ? " demand-peak" : "";
  return `<label class="field"><span class="field-label">${label}${tooltip(help)}</span><input class="${demandClass.trim()}" type="number" step="${step}" min="0" value="${value}" data-path="${path}" ${disabled}></label>`;
}

function selectField(label, path, options, value, disabled, help = "") {
  return `<label class="field"><span class="field-label">${label}${tooltip(help)}</span><select data-path="${path}" ${disabled}>${options.map(([key, text]) => `<option value="${key}" ${key === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function tooltip(text) {
  return text ? ` <span class="tooltip" tabindex="0" role="note" data-tooltip="${escapeAttribute(text)}" aria-label="${escapeAttribute(text)}">?</span>` : "";
}

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function updatePlanValue(plan, path, raw, imperial) {
  const [group, key] = path.split(".");
  if (!key) {
    plan[group] = raw;
    return;
  }
  if (path === "resistance.preset" && RESISTANCE_PRESETS[raw]) {
    plan.resistance = { preset: raw, ...RESISTANCE_PRESETS[raw] };
    delete plan.resistance.label;
    return;
  }
  const numeric = !["preset", "mode", "profile", "difficulty"].includes(key);
  let value = numeric ? Number(raw) || 0 : raw;
  if (group === "athlete" && key.endsWith("WeightKg") && imperial) value = conversions.lbToKg(value);
  if (path === "route.distanceKm" && imperial) value = conversions.miToKm(value);
  if (path === "route.elevationGainM" && imperial) value = conversions.ftToM(value);
  plan[group][key] = value;
  if ((path === "resistance.cda" || path === "resistance.crr") && plan.resistance.preset !== "custom") plan.resistance.preset = "custom";
}

global.VeloPlanningUI = { renderPlanningUI };
})(globalThis);
