// Shared domain model for Fuel Master and Power Master.
// This is a classic browser script (rather than an ES module) so the tools work over file://.
(function (global) {
"use strict";

const { clone } = global.VeloUtils;
const { clamp, conversions, finiteNumber: finite, roundDurationValue, roundTo, wholeNumber } = global.VeloMath;
const model = (key) => global.VeloModelConfig.get(key);

const PLAN_SCHEMA_VERSION = 1;

const PROFILES = [
  // These reference ratios are deliberately monotonic as focus duration gets
  // longer: aerobic demand increases while hard-effort and sprint demand fall.
  // They approximate Xert-like Focus matching; Xert's exact athlete-specific
  // Focus and Specificity algorithms remain proprietary.
  { id: "sprinter", label: "Sprinter", bestPower: "5–15 seconds", shares: [0.70, 0.15, 0.15] },
  { id: "puncheur", label: "Puncheur", bestPower: "4 minutes", shares: [0.86, 0.12, 0.02] },
  { id: "breakaway", label: "Breakaway Specialist", bestPower: "5 minutes", shares: [0.875, 0.11, 0.015] },
  { id: "rouleur", label: "Rouleur", bestPower: "6 minutes", shares: [0.89, 0.10, 0.01] },
  { id: "gc", label: "GC Specialist", bestPower: "8 minutes", shares: [0.905, 0.087, 0.008] },
  { id: "climber", label: "Climber", bestPower: "20–40 minutes", shares: [0.925, 0.07, 0.005] },
  { id: "time-trialist", label: "Time Trialist", bestPower: "40–60+ minutes", shares: [0.96, 0.038, 0.002] },
];

const RESISTANCE_PRESETS = {
  aero: { label: "Fast / Aero", cda: 0.26, crr: 0.004 },
  typical: { label: "Typical Road", cda: 0.32, crr: 0.005 },
};

// Power Master defaults and profile templates retain the established tape colors.
const DEFAULT_POWER_TARGETS = [
  { id: "crosswind", label: "CROSS", terrain: "flat", minPower: 153, targetPower: 156, maxPower: 158, cadence: "80-85", durationMinutes: 25, textColor: "#4a148c", backgroundColor: "#f3e5f5" },
  { id: "headwind", label: "HEAD", terrain: "flat", minPower: 165, targetPower: 168, maxPower: 170, cadence: "90", durationMinutes: 25, textColor: "#c2185b", backgroundColor: "#fce4ec" },
  { id: "tailwind", label: "TAIL", terrain: "flat", minPower: 163, targetPower: 166, maxPower: 168, cadence: "95+", durationMinutes: 25, textColor: "#1976d2", backgroundColor: "#e3f2fd" },
  { id: "climb-4-percent", label: "4% CLM", terrain: "climb", minPower: 200, targetPower: 206, maxPower: 212, cadence: "80", durationMinutes: 30, textColor: "#e65100", backgroundColor: "#ffffff" },
  { id: "incline-1-2-percent", label: "1-2% INC", terrain: "incline", minPower: 170, targetPower: 173, maxPower: 175, cadence: "90", durationMinutes: 35, textColor: "#2e7d32", backgroundColor: "#ffffff" },
  { id: "decline-1-2-percent", label: "1-2% DEC", terrain: "decline", minPower: 0, targetPower: 135, maxPower: 0, cadence: "95+", durationMinutes: 30, textColor: "#616161", backgroundColor: "#ffffff" },
  { id: "short-steep-ramp", label: "H EFFORT", terrain: "steep-ramp", minPower: 300, targetPower: 300, maxPower: 0, cadence: "100+", durationMinutes: 10, textColor: "#d32f2f", backgroundColor: "#ffffff" },
];

const PROFILE_TARGET_TEMPLATES = {
  sprinter: [
    ["END", "flat", .62, .70, .78, "88-94", 35, "#1b5e20", "#e8f5e9"],
    ["LEAD", "flat", .90, 1, 1.10, "95+", 1.5, "#e65100", "#fff3e0"],
    ["SPR", "steep-ramp", 1.60, 2, 2.40, "105+", .25, "#ffffff", "#c62828"],
    ["REC", "decline", .35, .50, .62, "90+", 8, "#0d47a1", "#e3f2fd"],
  ],
  puncheur: [
    ["CRZ", "flat", .68, .75, .82, "88-94", 30, "#1b5e20", "#e8f5e9"],
    ["PUNCH", "steep-ramp", 1.20, 1.35, 1.50, "88+", 2, "#ffffff", "#ad1457"],
    ["H INC", "incline", 1.02, 1.12, 1.22, "82-90", 6, "#4a148c", "#f3e5f5"],
    ["REC", "decline", .40, .54, .66, "90+", 10, "#0d47a1", "#e3f2fd"],
  ],
  breakaway: [
    ["BRDG", "flat", 1.02, 1.10, 1.18, "90+", 6, "#ffffff", "#6a1b9a"],
    ["BRK", "flat", .88, .94, 1, "88-94", 35, "#e65100", "#fff3e0"],
    ["ROLL", "incline", .96, 1.04, 1.12, "84-92", 10, "#4a148c", "#f3e5f5"],
    ["REC", "decline", .42, .56, .68, "90+", 12, "#0d47a1", "#e3f2fd"],
  ],
  rouleur: [
    ["END", "flat", .72, .76, .80, "88-94", 45, "#1b5e20", "#e8f5e9"],
    ["TMP", "flat", .82, .86, .90, "88-94", 25, "#e65100", "#fff3e0"],
    ["ROLL", "incline", .88, .94, 1, "82-90", 20, "#4a148c", "#f3e5f5"],
    ["XWIND", "flat", .92, .98, 1.04, "82-90", 12, "#ffffff", "#1565c0"],
    ["PULL", "steep-ramp", 1.08, 1.16, 1.24, "90+", 4, "#ffffff", "#c62828"],
    ["REC", "decline", .45, .58, .68, "90+", 20, "#0d47a1", "#e3f2fd"],
  ],
  gc: [
    ["END", "flat", .68, .74, .80, "88-94", 35, "#1b5e20", "#e8f5e9"],
    ["T CLM", "climb", .88, .94, 1, "78-86", 30, "#4a148c", "#f3e5f5"],
    ["THR CLM", "climb", .98, 1.03, 1.08, "76-84", 16, "#ffffff", "#6a1b9a"],
    ["SURGE", "incline", 1.02, 1.10, 1.18, "84-92", 5, "#ffffff", "#c62828"],
    ["REC", "decline", .42, .55, .65, "90+", 22, "#0d47a1", "#e3f2fd"],
  ],
  climber: [
    ["APP", "flat", .64, .70, .76, "88-94", 30, "#1b5e20", "#e8f5e9"],
    ["L CLM", "climb", .92, .98, 1.04, "76-84", 40, "#4a148c", "#f3e5f5"],
    ["STEEP", "steep-ramp", 1.02, 1.10, 1.18, "70-80", 10, "#ffffff", "#c62828"],
    ["DESC", "decline", .35, .50, .62, "90+", 25, "#0d47a1", "#e3f2fd"],
  ],
  "time-trialist": [
    ["SET", "flat", .78, .82, .86, "88-94", 10, "#1b5e20", "#e8f5e9"],
    ["RACE", "flat", .90, .95, 1, "88-96", 45, "#ffffff", "#6a1b9a"],
    ["HWIND", "flat", .94, .99, 1.04, "84-92", 15, "#ffffff", "#1565c0"],
    ["RISE", "incline", .96, 1.02, 1.08, "82-90", 8, "#4a148c", "#f3e5f5"],
  ],
};

function createDefaultPowerTargets(thresholdPower = 214) {
  const scale = thresholdPower > 0 ? thresholdPower / 214 : 1;
  return DEFAULT_POWER_TARGETS.map((row) => normalizePowerTarget({
    ...row,
    minPower: Math.round(row.minPower * scale),
    targetPower: Math.round(row.targetPower * scale),
    maxPower: Math.round(row.maxPower * scale),
  }));
}

function createProfilePowerTargets(profileId, thresholdPower, totalDurationMinutes = 180) {
  const template = PROFILE_TARGET_TEMPLATES[profileId];
  if (!template || !(thresholdPower > 0) || !(totalDurationMinutes > 0)) return [];
  const templateMinutes = template.reduce((sum, row) => sum + row[6], 0);
  let assignedMinutes = 0;
  return template.map((row, index) => {
    const durationMinutes = index === template.length - 1
      ? Math.max(0, Math.round((totalDurationMinutes - assignedMinutes) * 10) / 10)
      : Math.max(0, Math.round((row[6] * totalDurationMinutes / templateMinutes) * 10) / 10);
    assignedMinutes += durationMinutes;
    return normalizePowerTarget({
    id: `profile-${profileId}-${Date.now()}-${index}`,
    label: row[0], terrain: row[1], minPower: Math.round(thresholdPower * row[2]),
    targetPower: Math.round(thresholdPower * row[3]), maxPower: Math.round(thresholdPower * row[4]),
    cadence: row[5], durationMinutes, durationValue: durationMinutes, durationUnit: "minutes",
    textColor: row[7], backgroundColor: row[8], source: "profile", sourceProfile: profileId,
    });
  });
}

function createDefaultPlan() {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    source: { tool: null, fileName: null, parameterFileName: null, powerFileName: null },
    units: "imperial",
    athlete: {
      riderWeightKg: 68,
      bikeWeightKg: 9,
      carriedWeightKg: 0,
      thresholdPower: 214,
      lowThresholdPower: 160,
      peakPower: 800,
    },
    route: {
      activityFileName: null,
      distanceKm: 0,
      elevationGainM: 0,
      movingDurationMinutes: 180,
      stoppedDurationMinutes: 0,
      climbingDurationMinutes: 0,
      declineDurationMinutes: 0,
    },
    resistance: {
      preset: "typical",
      cda: RESISTANCE_PRESETS.typical.cda,
      crr: RESISTANCE_PRESETS.typical.crr,
    },
    demand: {
      mode: "target-duration",
      aerobic: 0,
      hardEffort: 0,
      sprint: 0,
      profile: "rouleur",
      difficulty: "moderate",
    },
    tape: {
      stemWidthMm: 25.4,
      maxLengthMm: null,
      baseFontSizePt: 5.25,
      previewZoom: 140,
    },
    powerTargets: [],
  };
}

function normalizePlan(input = {}) {
  if (input.schemaVersion !== PLAN_SCHEMA_VERSION) {
    throw new Error(`Unsupported plan schema. Expected version ${PLAN_SCHEMA_VERSION}.`);
  }

  const defaults = createDefaultPlan();
  const plan = clone(defaults);
  plan.source = { ...defaults.source, ...(input.source || {}) };
  plan.units = input.units === "metric" ? "metric" : "imperial";
  plan.athlete = { ...defaults.athlete, ...(input.athlete || {}) };
  plan.route = { ...defaults.route, ...(input.route || {}) };
  plan.resistance = { ...defaults.resistance, ...(input.resistance || {}) };
  plan.demand = { ...defaults.demand, ...(input.demand || {}) };
  plan.tape = { ...defaults.tape, ...(input.tape || {}) };
  plan.powerTargets = Array.isArray(input.powerTargets)
    ? input.powerTargets.map(normalizePowerTarget)
    : [];
  const targetIds = new Set(plan.powerTargets.map((row) => row.id));
  plan.powerTargets.forEach((row) => {
    if (row.overlapWith === row.id || !targetIds.has(row.overlapWith)) row.overlapWith = "";
  });

  for (const key of Object.keys(plan.athlete)) plan.athlete[key] = finite(plan.athlete[key]);
  for (const key of ["distanceKm", "elevationGainM", "movingDurationMinutes", "stoppedDurationMinutes", "climbingDurationMinutes", "declineDurationMinutes"]) {
    plan.route[key] = Math.max(0, finite(plan.route[key]));
  }
  for (const key of ["movingDurationMinutes", "stoppedDurationMinutes", "climbingDurationMinutes", "declineDurationMinutes"]) {
    plan.route[key] = roundTo(plan.route[key], 1);
  }
  plan.resistance.cda = Math.max(0.1, finite(plan.resistance.cda, defaults.resistance.cda));
  plan.resistance.crr = Math.max(0.001, finite(plan.resistance.crr, defaults.resistance.crr));
  for (const key of ["aerobic", "hardEffort", "sprint"]) plan.demand[key] = Math.max(0, finite(plan.demand[key]));
  // In manual/imported modes the demand components are authoritative and the
  // profile is descriptive. Recompute it so stale labels saved by older builds
  // do not override the actual demand composition.
  if (plan.demand.mode !== "target-duration" && combinedDemand(plan) > 0) {
    plan.demand.profile = deriveDemandProfile(plan);
  }
  plan.tape.stemWidthMm = Math.max(15, finite(plan.tape.stemWidthMm, defaults.tape.stemWidthMm));
  plan.tape.maxLengthMm = finite(plan.tape.maxLengthMm) > 0 ? finite(plan.tape.maxLengthMm) : null;
  plan.tape.baseFontSizePt = Math.max(3.5, finite(plan.tape.baseFontSizePt, defaults.tape.baseFontSizePt));
  plan.tape.previewZoom = clamp(finite(plan.tape.previewZoom, defaults.tape.previewZoom), 100, 250);
  return plan;
}

function normalizePowerTarget(target = {}, index = 0) {
  const inferredMode = wholeNumber(target.minPower) > 0 && wholeNumber(target.maxPower) > 0 ? "range" : "target";
  return {
    id: String(target.id || `target-${index + 1}`),
    label: String(target.label || "TARGET"),
    terrain: String(target.terrain || "flat"),
    minPower: wholeNumber(target.minPower),
    targetPower: wholeNumber(target.targetPower),
    maxPower: wholeNumber(target.maxPower),
    powerMode: ["target", "range", "speed"].includes(target.powerMode) ? target.powerMode : inferredMode,
    targetSpeedKph: Math.max(0, roundTo(finite(target.targetSpeedKph), 1)),
    cadence: String(target.cadence || ""),
    durationMinutes: Math.max(0, roundTo(finite(target.durationMinutes), 1)),
    durationValue: Math.max(0, roundDurationValue(finite(target.durationValue, target.durationMinutes), target.durationUnit)),
    durationUnit: ["seconds", "minutes", "hours"].includes(target.durationUnit) ? target.durationUnit : "minutes",
    durationEnabled: target.durationEnabled !== false,
    overlapWith: target.overlapWith ? String(target.overlapWith) : "",
    visibleInDashboard: target.visibleInDashboard !== false,
    textColor: String(target.textColor || "#111827"),
    backgroundColor: String(target.backgroundColor || "#ffffff"),
    source: target.source ? String(target.source) : null,
    sourceProfile: target.sourceProfile ? String(target.sourceProfile) : null,
  };
}

// A Speed target represents a restart/ramp segment. It estimates the average
// mechanical power needed to accelerate the loaded system from rest to the
// requested speed during the row duration, then adds rolling and aerodynamic
// resistance. It is intentionally an estimate; stop time itself belongs in
// Fuel Master's stopped-duration field.
function estimatePowerForSpeed(plan, target) {
  const seconds = Math.max(1, finite(target.durationMinutes) * 60);
  const speedKph = Math.max(0, finite(target.targetSpeedKph));
  const speed = speedKph / 3.6;
  if (!(speed > 0)) return 0;
  const settings = model("routePhysics.mechanicalPower");
  const mass = totalSystemMassKg(plan);
  const gravity = settings.gravityMps2;
  const rolling = plan.resistance.crr * mass * gravity * speed;
  const aero = 0.5 * settings.airDensityKgM3 * plan.resistance.cda * Math.pow(speed, 3);
  const terrainGrade = target.terrain === "climb" ? 0.04 : target.terrain === "incline" ? 0.015 : target.terrain === "decline" ? -0.015 : 0;
  const grade = mass * gravity * terrainGrade * speed;
  const acceleration = (0.5 * mass * speed * speed) / seconds;
  return Math.max(0, wholeNumber((rolling + aero + grade + acceleration) / settings.drivetrainEfficiency));
}

function totalSystemMassKg(plan) {
  return plan.athlete.riderWeightKg + plan.athlete.bikeWeightKg + plan.athlete.carriedWeightKg;
}

function elapsedDurationMinutes(plan) {
  return plan.route.movingDurationMinutes + plan.route.stoppedDurationMinutes;
}

function targetPower(target) {
  if (target.powerMode === "range") {
    if (target.minPower > 0 && target.maxPower > 0) return (target.minPower + target.maxPower) / 2;
    return target.minPower || target.maxPower || 0;
  }
  if (target.powerMode === "target") return target.targetPower > 0 ? target.targetPower : 0;
  if (target.targetPower > 0) return target.targetPower;
  if (target.minPower > 0 && target.maxPower > 0) return (target.minPower + target.maxPower) / 2;
  return target.minPower || target.maxPower || 0;
}

function durationWeightedAveragePower(plan) {
  const timed = effectiveTargetDurations(plan).filter(({ row, minutes }) => minutes > 0 && targetPower(row) > 0);
  const minutes = timed.reduce((sum, item) => sum + item.minutes, 0);
  if (!minutes) return 0;
  return timed.reduce((sum, item) => sum + targetPower(item.row) * item.minutes, 0) / minutes;
}

function estimatedWorkload(plan) {
  const threshold = plan.athlete.thresholdPower;
  if (threshold <= 0) return 0;
  const timed = effectiveTargetDurations(plan).filter(({ row, minutes }) => minutes > 0 && targetPower(row) > 0);
  const assignedMinutes = timed.reduce((sum, item) => sum + item.minutes, 0);
  // Scale the effective, non-duplicated exposure to the authoritative route
  // moving duration when a route supplies a slightly different total.
  const durationScale = assignedMinutes > 0 && plan.route.movingDurationMinutes > 0
    ? plan.route.movingDurationMinutes / assignedMinutes
    : 1;
  return timed.reduce((sum, item) => {
    const hours = item.minutes * durationScale / 60;
    return sum + thresholdRelativeWorkload(targetPower(item.row), threshold, hours);
  }, 0);
}

function durationCounts(row) {
  return row.durationEnabled !== false && !row.overlapWith;
}

// Overlap rows describe a condition occurring during another target (for
// example, a climb during a crosswind section). They must not add moving time,
// but their watts and cadence still replace the same number of parent minutes
// in weighted metrics. Nested overlaps are supported, and sibling overlaps are
// proportionally capped when their requested time exceeds the parent window.
function effectiveTargetDurations(plan) {
  const rows = Array.isArray(plan.powerTargets) ? plan.powerTargets : [];
  const enabled = rows.filter((row) => row.durationEnabled !== false);
  const byParent = new Map();
  enabled.forEach((row) => {
    if (!row.overlapWith) return;
    const children = byParent.get(row.overlapWith) || [];
    children.push(row);
    byParent.set(row.overlapWith, children);
  });

  const result = [];
  const allocate = (row, availableMinutes, ancestry = new Set()) => {
    const available = Math.max(0, Number(availableMinutes) || 0);
    if (!available || ancestry.has(row.id)) return;
    const nextAncestry = new Set(ancestry).add(row.id);
    const children = (byParent.get(row.id) || []).filter((child) => !nextAncestry.has(child.id));
    const requested = children.reduce((sum, child) => sum + Math.max(0, Number(child.durationMinutes) || 0), 0);
    const childScale = requested > available && requested > 0 ? available / requested : 1;
    const allocatedChildren = children.map((child) => ({
      row: child,
      minutes: Math.max(0, Number(child.durationMinutes) || 0) * childScale,
    }));
    const childMinutes = allocatedChildren.reduce((sum, item) => sum + item.minutes, 0);
    const ownMinutes = Math.max(0, available - childMinutes);
    if (ownMinutes > 0) result.push({ row, minutes: ownMinutes });
    allocatedChildren.forEach((item) => allocate(item.row, item.minutes, nextAncestry));
  };

  enabled.filter((row) => !row.overlapWith).forEach((row) => allocate(row, row.durationMinutes));
  return result;
}

function thresholdRelativeWorkload(averagePower, thresholdPower, hours) {
  if (!(averagePower > 0) || !(thresholdPower > 0) || !(hours > 0)) return 0;
  const settings = model("workload.thresholdRelative");
  return hours * Math.pow(averagePower / thresholdPower, settings.intensityExponent) * settings.scorePerHour;
}

function combinedDemand(plan) {
  return plan.demand.aerobic + plan.demand.hardEffort + plan.demand.sprint;
}

// Match the normalized three-system demand allocation to the closest profile
// reference. Weighting the smaller hard/peak systems prevents the dominant
// aerobic component from masking a meaningfully punchier demand pattern.
function deriveDemandProfile(plan) {
  const total = combinedDemand(plan);
  if (!(total > 0)) return plan.demand.profile || "rouleur";
  const allocation = [plan.demand.aerobic, plan.demand.hardEffort, plan.demand.sprint]
    .map((value) => Math.max(0, finite(value)) / total);
  const weights = [1, 2, 4];
  return PROFILES.reduce((best, profile) => {
    const score = profile.shares.reduce((sum, share, index) => {
      return sum + weights[index] * Math.pow(allocation[index] - share, 2);
    }, 0);
    return score < best.score ? { id: profile.id, score } : best;
  }, { id: "rouleur", score: Infinity }).id;
}

// A profile describes how workload is distributed, not an empty set of demand
// fields. Reuse the current total when possible; otherwise create a conservative
// baseline from duration and the selected difficulty.
function applyProfileDemandSuggestions(plan) {
  const profile = PROFILES.find((item) => item.id === plan.demand.profile) || PROFILES[3];
  const settings = model("demand.profileSuggestions");
  const hours = Math.max(settings.minimumDurationHours, plan.route.movingDurationMinutes / 60);
  const suggestedIntensity = plan.demand.difficulty === "difficult" ? settings.difficultIntensity : settings.moderateIntensity;
  const total = combinedDemand(plan) || thresholdRelativeWorkload(suggestedIntensity, 1, hours);
  [plan.demand.aerobic, plan.demand.hardEffort, plan.demand.sprint] = profile.shares.map((share) => roundTo(total * share, 1));
  return plan.demand;
}

// A transparent route-physics estimate for Meet Target Duration mode. It deliberately
// excludes wind, braking, drafting, and grade-by-grade speed, which require richer route data.
function estimateMechanicalPower(plan) {
  const seconds = plan.route.movingDurationMinutes * 60;
  if (seconds <= 0 || plan.route.distanceKm <= 0) return 0;
  const speed = plan.route.distanceKm * 1000 / seconds;
  const mass = totalSystemMassKg(plan);
  const settings = model("routePhysics.mechanicalPower");
  const gravity = settings.gravityMps2;
  const airDensity = settings.airDensityKgM3;
  const rolling = plan.resistance.crr * mass * gravity * speed;
  const aero = 0.5 * airDensity * plan.resistance.cda * Math.pow(speed, 3);
  const climbing = mass * gravity * plan.route.elevationGainM / seconds;
  return (rolling + aero + climbing) / settings.drivetrainEfficiency;
}

function calculateDemandFromTargetDuration(plan) {
  const averagePower = estimateMechanicalPower(plan);
  const threshold = plan.athlete.thresholdPower;
  if (averagePower <= 0 || threshold <= 0) return { averagePower: 0, workload: 0 };
  const hours = plan.route.movingDurationMinutes / 60;
  const workload = thresholdRelativeWorkload(averagePower, threshold, hours);
  plan.demand.profile = deriveTargetDurationProfile(plan, averagePower);
  const profile = PROFILES.find((item) => item.id === plan.demand.profile) || PROFILES[3];
  const [aerobic, hardEffort, sprint] = profile.shares.map((share) => workload * share);
  plan.demand.aerobic = aerobic;
  plan.demand.hardEffort = hardEffort;
  plan.demand.sprint = sprint;
  plan.demand.difficulty = averagePower / threshold >= model("profile.targetDurationClassification").difficultIntensityMin ? "difficult" : "moderate";
  return { averagePower, workload };
}

function deriveTargetDurationProfile(plan, averagePower) {
  const settings = model("profile.targetDurationClassification");
  const distance = Math.max(0, plan.route.distanceKm);
  const moving = Math.max(1, plan.route.movingDurationMinutes);
  const elevationDensity = distance > 0 ? plan.route.elevationGainM / distance : 0;
  const climbingShare = Math.min(1, Math.max(0, plan.route.climbingDurationMinutes / moving));
  const intensity = plan.athlete.thresholdPower > 0 ? averagePower / plan.athlete.thresholdPower : 0;
  if (elevationDensity >= settings.climberElevationMPerKm || climbingShare >= settings.climberTimeShare) return "climber";
  if (elevationDensity >= settings.gcElevationMPerKm || climbingShare >= settings.gcTimeShare) return "gc";
  if (elevationDensity < settings.timeTrialElevationMaxMPerKm && climbingShare < settings.timeTrialClimbShareMax && intensity >= settings.timeTrialIntensityMin) return "time-trialist";
  return "rouleur";
}

global.VeloPlanning = {
  PLAN_SCHEMA_VERSION, PROFILES, RESISTANCE_PRESETS, DEFAULT_POWER_TARGETS, PROFILE_TARGET_TEMPLATES,
  createDefaultPlan, createDefaultPowerTargets, createProfilePowerTargets, clone,
  normalizePlan, normalizePowerTarget, totalSystemMassKg, elapsedDurationMinutes,
  targetPower, durationCounts, effectiveTargetDurations, durationWeightedAveragePower, estimatedWorkload, combinedDemand, estimatePowerForSpeed,
  thresholdRelativeWorkload,
  deriveDemandProfile, applyProfileDemandSuggestions, estimateMechanicalPower, calculateDemandFromTargetDuration, deriveTargetDurationProfile, conversions,
};
})(globalThis);
