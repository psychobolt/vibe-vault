const { attachSectionLinks, attachSectionPins, attachStickyActions, attachToolSidebar, createPlanStore, createStateStore, downloadJson, protectSummaryActions, readJsonFile, renderSummaryFields, restoreSectionAnchor, setStatus } = VeloApp;
    const { enhanceNumberSliders, escapeHtml } = VeloUtils;
    const { calculateDemandFromTargetDuration, combinedDemand, createDefaultPlan, durationWeightedAveragePower, elapsedDurationMinutes, estimatedWorkload, estimateMechanicalPower, normalizePlan, thresholdRelativeWorkload } = VeloPlanning;
    const { renderPlanningUI } = VeloPlanningUI;
    const { parseActivityFile } = VeloActivity;

    const elements = {
      planning: document.querySelector("#planning-fields"), summary: document.querySelector("#summary"),
      recipe: document.querySelector("#recipe-plan"),
      file: document.querySelector("#load-plan"), status: document.querySelector("#status"),
      authority: document.querySelector("#authority-note"), remove: document.querySelector("#remove-plan"),
      loadButton: document.querySelector("#load-button"), loadedControl: document.querySelector("#loaded-plan-control"),
      loadedName: document.querySelector("#loaded-plan-name"),
      parameterActions: document.querySelector("#parameter-actions"),
    };
    attachToolSidebar("fuel");
    attachSectionLinks();
    attachSectionPins();
    attachStickyActions(elements.parameterActions);
    protectSummaryActions();
    const fuelDefaults = {
      mode: "automatic", customCarbs: 70, bottles: 2, bottleCapacity: 90, gelSizeOz: 5, maxGelStop: 45,
      gelFlasks: 1, waterFlasks: 1, drinkName: "Gatorade Thirst Quencher", drinkCarbs: 21,
      haveMalto: true, haveFructose: true, haveGatorade: true, havePectin: true, haveSalt: true,
      spoons: { tablespoon: true, one: true, half: true, quarter: true, eighth: true, third: true }
    };
    const fuelStore = createStateStore(
      "velo-tools:fuel-settings",
      fuelDefaults,
      (value) => ({ ...fuelDefaults, ...value, spoons: { ...fuelDefaults.spoons, ...(value.spoons || {}) } }),
    );
    fuelStore.loadLocal();
    let fuel = fuelStore.get();
    fuelStore.subscribe((next) => { fuel = next; });
    const initial = createDefaultPlan();
    initial.source.tool = "fuel-master";
    const store = createPlanStore("velo-tools:fuel-master", initial);
    const histories = Object.fromEntries(["athlete", "route", "resistance", "demand"].map((id) => [id, { undo: [], redo: [] }]));
    const fuelHistories = { fueling: { undo: [], redo: [] }, spoons: { undo: [], redo: [] } };
    const loadedBaselineKey = "velo-tools:fuel-master:loaded-baseline";
    let loadedBaseline = readLoadedBaseline();

    function readLoadedBaseline() {
      try {
        const saved = JSON.parse(localStorage.getItem(loadedBaselineKey) || "null");
        return saved ? { plan: normalizePlan(saved.plan), fuel: { ...fuelDefaults, ...(saved.fuel || {}) } } : null;
      } catch {
        localStorage.removeItem(loadedBaselineKey);
        return null;
      }
    }

    function setLoadedBaseline(plan, fuelSettings = fuel) {
      loadedBaseline = plan ? { plan: normalizePlan(structuredClone(plan)), fuel: { ...fuelDefaults, ...fuelSettings } } : null;
      if (loadedBaseline) localStorage.setItem(loadedBaselineKey, JSON.stringify(loadedBaseline));
      else localStorage.removeItem(loadedBaselineKey);
    }

    function clearHistories() {
      Object.values(histories).forEach((history) => { history.undo.length = 0; history.redo.length = 0; });
      Object.values(fuelHistories).forEach((history) => { history.undo.length = 0; history.redo.length = 0; });
      updateFuelHistoryButtons();
    }

    function persistFuel() {
      fuelStore.set(fuel);
    }

    function fuelSectionState(section) {
      return section === "spoons" ? { spoons: structuredClone(fuel.spoons || fuelDefaults.spoons) } : { ...fuel, spoons: undefined };
    }
    function rememberFuel(section) {
      fuelHistories[section].undo.push(fuelSectionState(section));
      fuelHistories[section].redo.length = 0;
      updateFuelHistoryButtons();
    }
    function restoreFuelSection(section, snapshot) {
      if (section === "spoons") fuel.spoons = structuredClone(snapshot.spoons);
      else fuel = { ...fuelDefaults, ...snapshot, spoons: fuel.spoons || fuelDefaults.spoons };
      persistFuel();
      renderFuelFields(); renderSummary(store.get()); updateFuelHistoryButtons();
    }
    function runFuelHistory(section, direction) {
      const history = fuelHistories[section];
      if (!history[direction].length) return;
      const current = fuelSectionState(section);
      history[direction === "undo" ? "redo" : "undo"].push(current);
      restoreFuelSection(section, history[direction].pop());
      const label = section === "spoons" ? "Measuring Spoons" : "Pantry and Fueling";
      setStatus(elements.status, `${direction === "undo" ? "Undid" : "Redid"} ${label} change.`);
    }
    function resetFuelSection(section) {
      rememberFuel(section);
      restoreFuelSection(section, section === "spoons" ? { spoons: fuelDefaults.spoons } : fuelDefaults);
    }
    function updateFuelHistoryButtons() {
      document.querySelectorAll("[data-fuel-history]").forEach((button) => {
        const history = fuelHistories[button.dataset.fuelSection];
        if (history) button.disabled = button.dataset.fuelHistory !== "reset" && !history[button.dataset.fuelHistory].length;
      });
    }

    function remember(section) {
      histories[section].undo.push(store.get());
      histories[section].redo.length = 0;
    }

    function runHistory(section, direction) {
      const history = histories[section];
      const source = history[direction];
      if (!source.length) return;
      (direction === "undo" ? history.redo : history.undo).push(store.get());
      store.set(source.pop());
      const labels = {
        athlete: "Athlete and Equipment",
        route: "Route and Duration",
        resistance: "Ride Resistance",
        demand: "Demand and Profile",
      };
      setStatus(elements.status, `${direction === "undo" ? "Undid" : "Redid"} ${labels[section] || section} change.`);
    }

    function resetSection(section) {
      remember(section);
      const plan = store.get();
      plan[section] = structuredClone(createDefaultPlan()[section]);
      store.set(plan);
      setStatus(elements.status, `${section[0].toUpperCase() + section.slice(1)} reset.`);
    }

    function isPowerMasterPlan(plan) { return plan.source.tool === "power-master" && plan.powerTargets.length > 0; }

    // Detailed Power Master rows are the execution authority. Their measured workload
    // becomes Fuel Master's demand baseline while the imported plan remains read-only.
    function syncImportedPowerDemand(plan) {
      if (!plan.powerTargets.length || plan.athlete.thresholdPower <= 0) return;
      const workload = estimatedWorkload(plan);
      const currentDemand = combinedDemand(plan);
      const totalMinutes = plan.powerTargets.reduce((sum, row) => sum + row.durationMinutes, 0);
      const climbMinutes = plan.powerTargets.reduce((sum, row) => sum + (/climb|steep|incline/i.test(row.terrain) ? row.durationMinutes : 0), 0);
      const climbShare = totalMinutes > 0 ? climbMinutes / totalMinutes : 0;
      const averagePower = durationWeightedAveragePower(plan);
      const intensity = averagePower / plan.athlete.thresholdPower;
      plan.demand.profile = climbShare >= .25 ? "climber" : climbShare >= .2 ? "gc" : climbShare < .08 && intensity >= .88 ? "time-trialist" : "rouleur";
      plan.demand.difficulty = intensity >= VeloModelConfig.get("profile.targetDurationClassification").difficultIntensityMin ? "difficult" : "moderate";
      if (currentDemand > 0) {
        const scale = workload / currentDemand;
        plan.demand.aerobic *= scale;
        plan.demand.hardEffort *= scale;
        plan.demand.sprint *= scale;
      } else {
        plan.demand.aerobic = workload;
        plan.demand.hardEffort = 0;
        plan.demand.sprint = 0;
      }
      plan.demand.mode = "imported";
    }

    function adjustDemandRatio(factor) {
      const plan = store.get();
      if (!(combinedDemand(plan) > 0)) return;
      remember("demand");
      for (const key of ["aerobic", "hardEffort", "sprint"]) plan.demand[key] *= factor;
      store.set(plan);
      setStatus(elements.status, `${factor > 1 ? "Increased" : "Decreased"} combined demand by 1%.`);
    }

    function fitDemandToPowerPlan() {
      const plan = store.get();
      if (!plan.powerTargets.length) return;
      remember("demand");
      syncImportedPowerDemand(plan);
      store.set(plan);
      const profile = VeloPlanning.PROFILES.find((item) => item.id === plan.demand.profile)?.label || "best matching profile";
      setStatus(elements.status, `Fitted demand to the power plan and selected ${profile}.`);
    }

    function render(plan) {
      const locked = isPowerMasterPlan(plan);
      renderPlanningUI(elements.planning, plan, {
        showUnits: true,
        locked,
        onChange(next, path) {
          remember(path === "units" ? "athlete" : path.split(".")[0]);
          if (next.demand.mode === "target-duration") calculateDemandFromTargetDuration(next);
          store.set(next);
        },
        async onActivityFile(file) {
          try {
            const route = await parseActivityFile(file);
            remember("route");
            const next = store.get();
            next.route = { ...next.route, ...route };
            if (next.demand.mode === "target-duration") calculateDemandFromTargetDuration(next);
            store.set(next);
            setStatus(elements.status, `Loaded ${file.name}.`);
          } catch (error) { setStatus(elements.status, error.message, "error"); }
        },
        onClearActivity() {
          remember("route");
          const next = store.get();
          next.route.activityFileName = null;
          store.set(next);
          setStatus(elements.status, "Activity route removed; route values are now editable.");
        },
        sectionActions: {
          state: Object.fromEntries(Object.entries(histories).map(([id, history]) => [id, { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 }])),
          undo: (section) => runHistory(section, "undo"),
          redo: (section) => runHistory(section, "redo"),
          reset: resetSection,
        },
      });
      elements.authority.hidden = !locked;
      elements.authority.textContent = locked ? `Power Master owns Steps 1–4${plan.source.fileName ? ` through ${plan.source.fileName}` : ""}. Remove the plan to edit them here.` : "";
      const hasLoadedFile = Boolean(loadedBaseline && plan.source.fileName);
      elements.loadButton.hidden = hasLoadedFile;
      elements.loadedControl.hidden = !hasLoadedFile;
      elements.loadedName.value = hasLoadedFile ? plan.source.fileName : "";
      renderFuelFields();
      renderSummary(plan);
    }

    function renderFuelFields() {
      const imperial = store.get().units !== "metric";
      document.querySelector("#fuel-units").value = imperial ? "imperial" : "metric";
      document.querySelector("#drink-name").value = fuel.drinkName;
      document.querySelector("#drink-carbs").value = fuel.drinkCarbs;
      document.querySelector("#fuel-mode").value = fuel.mode;
      document.querySelector("#custom-carbs").value = fuel.customCarbs;
      document.querySelector("#custom-carbs").disabled = fuel.mode !== "custom";
      document.querySelector("#bottles").value = fuel.bottles;
      document.querySelector("#bottle-capacity").value = fuel.bottleCapacity;
      document.querySelector("#gel-size-label").textContent = `Gel Flask Size (${imperial ? "fl oz" : "ml"})`;
      document.querySelector("#gel-size").value = imperial ? fuel.gelSizeOz : fuel.gelSizeOz * 29.5735295625;
      document.querySelector("#gel-flasks").value = fuel.gelFlasks || 1;
      document.querySelector("#water-flasks").value = fuel.waterFlasks || 0;
      document.querySelector("#gel-stop").value = fuel.maxGelStop;
      document.querySelector("#have-malto").checked = fuel.haveMalto !== false;
      document.querySelector("#have-fructose").checked = fuel.haveFructose !== false;
      document.querySelector("#have-gatorade").checked = fuel.haveGatorade !== false;
      document.querySelector("#commercial-name-field").hidden = fuel.haveGatorade === false;
      document.querySelector("#commercial-carbs-field").hidden = fuel.haveGatorade === false;
      document.querySelector("#have-pectin").checked = fuel.havePectin !== false;
      document.querySelector("#have-salt").checked = fuel.haveSalt !== false;
      document.querySelector("#spoon-1").checked = fuel.spoons?.one !== false;
      document.querySelector("#spoon-tablespoon").checked = fuel.spoons?.tablespoon !== false;
      document.querySelector("#spoon-half").checked = fuel.spoons?.half !== false;
      document.querySelector("#spoon-quarter").checked = fuel.spoons?.quarter !== false;
      document.querySelector("#spoon-eighth").checked = fuel.spoons?.eighth !== false;
      document.querySelector("#spoon-third").checked = fuel.spoons?.third !== false;
      enhanceNumberSliders(document.querySelector(".fuel-master-page"));
    }

    function automaticCarbsPerHour(plan) {
      const settings = VeloModelConfig.get("fueling.automaticCarbohydrateRate");
      const avg = durationWeightedAveragePower(plan) || estimateMechanicalPower(plan);
      const ratio = plan.athlete.thresholdPower > 0 ? avg / plan.athlete.thresholdPower : 0;
      const tier = settings.intensityBreakpoints.findIndex((breakpoint) => ratio < breakpoint);
      let carbs = settings.gramsPerHourTiers[tier < 0 ? settings.gramsPerHourTiers.length - 1 : tier];
      carbs += Math.min(settings.hardEffortMaximum, plan.demand.hardEffort * settings.hardEffortMultiplier)
        + Math.min(settings.sprintMaximum, plan.demand.sprint);
      const hours = elapsedDurationMinutes(plan) / 60;
      if (hours >= settings.veryLongRideHours) carbs += settings.veryLongRideBonus;
      else if (hours >= settings.longRideHours) carbs += settings.longRideBonus;
      return Math.min(settings.maximumGramsPerHour, Math.round(carbs));
    }

    function carbsPerHour(plan) {
      return { automatic: automaticCarbsPerHour(plan), easy: 55, endurance: 70, hard: 85, race: 100, custom: Number(fuel.customCarbs) || 70 }[fuel.mode];
    }

    function formatSpoonAmount(value) {
      if (!(value > 0.02)) return "";
      const whole = Math.floor(value);
      const fraction = value - whole;
      const allowed = [[0, ""], [0.125, "1/8", fuel.spoons?.eighth], [0.25, "1/4", fuel.spoons?.quarter], [0.333, "1/3", fuel.spoons?.third], [0.5, "1/2", fuel.spoons?.half], [0.667, "2/3", fuel.spoons?.third], [0.75, "3/4", fuel.spoons?.quarter]].filter(item => item[0] === 0 || item[2] !== false);
      const nearest = allowed.reduce((best, item) => Math.abs(item[0] - fraction) < Math.abs(best[0] - fraction) ? item : best, allowed[0]);
      return `${whole ? `${whole} ` : ""}${nearest[1]} tsp`.trim();
    }

    function formatInventoryAmount(value) {
      const spoons = fuel.spoons || fuelDefaults.spoons;
      if (Math.abs(value - 1) < 0.01 && spoons.one !== false) return "1 tsp";
      if (Math.abs(value - 0.5) < 0.01 && spoons.half !== false) return "1/2 tsp";
      if (Math.abs(value - 0.25) < 0.01 && spoons.quarter !== false) return "1/4 tsp";
      if (Math.abs(value - 0.125) < 0.01 && spoons.eighth !== false) return "1/8 tsp";
      if (Math.abs(value - 0.333) < 0.02 && spoons.third !== false) return "1/3 tsp";
      if (spoons.quarter !== false && Math.abs(value * 4 - Math.round(value * 4)) < 0.03) return `${Math.round(value * 4)} × 1/4 tsp`;
      if (spoons.eighth !== false && Math.abs(value * 8 - Math.round(value * 8)) < 0.03) return `${Math.round(value * 8)} × 1/8 tsp`;
      return formatSpoonAmount(value);
    }

    function formatPowder(value) {
      if (!(value > 0.02)) return "";
      if (fuel.spoons?.tablespoon === false) return formatInventoryAmount(value * 3);
      // Keep small powder amounts in total teaspoons (for example 1 tbsp + 1/4 tsp → 3 1/4 tsp).
      if (value < 1.5) return formatSpoonAmount(value * 3);
      const tbsp = Math.floor(value);
      const tsp = Math.round((value - tbsp) * 4) / 4;
      return `${tbsp ? `${tbsp} tbsp` : ""}${tsp ? `${tbsp ? " + " : ""}${formatSpoonAmount(tsp)}` : ""}`.trim();
    }

    function renderRecipe(plan, values) {
      const { bottleShare, gelCarbs, gelFlasks, gelStops, gelPerFlask, gelPerStop, gelLiquidOz, gelLiquidPerStopOz, waterRecommended } = values;
      const bottleCount = Math.max(1, Math.floor(Number(fuel.bottles) || 1));
      const perBottle = bottleShare / bottleCount;
      const baseCarbs = fuel.haveGatorade ? Math.max(0, Number(fuel.drinkCarbs) || 0) : 0;
      const remaining = Math.max(0, perBottle - baseCarbs);
      const bottleIngredients = document.querySelector("#bottle-ingredients");
      bottleIngredients.innerHTML = "";
      if (fuel.haveGatorade && baseCarbs > 0) bottleIngredients.insertAdjacentHTML("beforeend", `<li>${escapeHtml(fuel.drinkName)}: 1 serving (${baseCarbs.toFixed(0)}g carbs).</li>`);
      if (remaining > 0 && fuel.haveMalto && fuel.haveFructose) bottleIngredients.insertAdjacentHTML("beforeend", `<li>${formatPowder(remaining * .65 / 8)} maltodextrin.</li><li>${formatPowder(remaining * .35 / 12)} pure fructose.</li>`);
      else if (remaining > 0) bottleIngredients.insertAdjacentHTML("beforeend", `<li>${formatPowder(remaining / 12)} sugar powder.</li>`);
      if (fuel.haveSalt) bottleIngredients.insertAdjacentHTML("beforeend", `<li>${formatSpoonAmount(.25)} electrolyte salt.</li>`);
      document.querySelector("#bottle-badge").textContent = `${bottleCount} bottle${bottleCount === 1 ? "" : "s"} · ${Math.round(perBottle)}g each`;
      document.querySelector("#bottle-recipe-card").hidden = bottleShare <= 0;

      const spoonInventory = [fuel.spoons?.tablespoon !== false ? "1 Tbsp" : "", fuel.spoons?.one !== false ? "1 tsp" : "", fuel.spoons?.half !== false ? "1/2 tsp" : "", fuel.spoons?.quarter !== false ? "1/4 tsp" : "", fuel.spoons?.eighth !== false ? "1/8 tsp" : "", fuel.spoons?.third !== false ? "1/3 tsp" : ""].filter(Boolean).join(", ");
      document.querySelector("#equipment-list").innerHTML = [
        `Kitchen tablespoon and checked measuring spoons${spoonInventory ? ` (${spoonInventory})` : ""}`, "Medium mixing bowl or wide-mouth prep container",
        `${bottleCount} × 20 fl oz fuel bottle${bottleCount === 1 ? "" : "s"}`, "Kitchen funnel for clean powder transfer",
        gelCarbs > 15 ? `${Math.max(1, Number(fuel.gelFlasks) || 1)} × gel flask${Number(fuel.gelFlasks) === 1 ? "" : "s"}` : "",
        gelCarbs > 15 ? "Heat-safe glass measuring cup and small whisk" : "",
        gelCarbs > 15 ? `${gelStops} planned gel consumption stop${gelStops === 1 ? "" : "s"}` : "",
        gelCarbs > 15 ? (fuel.havePectin ? "Microwave or small saucepan" : "Microwave or warm-water bath") : "",
        Number(fuel.waterFlasks) > 0 ? `${fuel.waterFlasks} water flask${Number(fuel.waterFlasks) === 1 ? "" : "s"}` : ""
      ].filter(Boolean).map(item => `<li>${item}</li>`).join("");

      const gelCard = document.querySelector("#gel-recipe-card");
      gelCard.hidden = gelCarbs <= 15;
      if (gelCarbs <= 15) return;
      document.querySelector("#gel-badge").textContent = `${Math.max(1, Number(fuel.gelFlasks) || 1)} flask${Number(fuel.gelFlasks) === 1 ? "" : "s"} · ${Math.round(gelCarbs)}g total`;
      const gelIngredients = document.querySelector("#gel-ingredients");
      const gelSteps = document.querySelector("#gel-steps");
      gelIngredients.innerHTML = ""; gelSteps.innerHTML = "";
      if (fuel.haveMalto && fuel.haveFructose) gelIngredients.insertAdjacentHTML("beforeend", `<li>${formatPowder(gelCarbs * .67 / 8)} maltodextrin.</li><li>${formatPowder(gelCarbs * .33 / 12)} pure fructose.</li>`);
      else gelIngredients.insertAdjacentHTML("beforeend", `<li>${formatPowder(gelCarbs / 12)} regular sugar base.</li>`);
      if (fuel.havePectin) {
        // Tested working formulation: 1/2 tsp Pomona's pectin + 1 tsp prepared calcium water.
        // Keep these amounts explicit so the instructions do not drift to 3/4 tsp through rounding.
        gelIngredients.insertAdjacentHTML("beforeend", `<li>${formatInventoryAmount(.5)} Pomona's pectin powder + ${formatInventoryAmount(1)} prepared calcium water.</li>`);
      }
      if (fuel.haveSalt) gelIngredients.insertAdjacentHTML("beforeend", `<li>${formatSpoonAmount(.25)} electrolyte salt.</li>`);
      gelIngredients.insertAdjacentHTML("beforeend", `<li>${gelLiquidOz.toFixed(1)} fl oz fruit base (${gelLiquidPerStopOz.toFixed(1)} fl oz per stop).</li>`);
      gelSteps.insertAdjacentHTML("beforeend", `<li>Fill ${Math.max(1, Number(fuel.gelFlasks) || 1)} flask${Number(fuel.gelFlasks) === 1 ? "" : "s"} evenly: about ${Math.round(gelPerFlask)}g each.</li><li>Use over ${gelStops} stop${gelStops === 1 ? "" : "s"}: about ${Math.round(gelPerStop)}g per stop.</li><li>${waterRecommended ? "Drink water with each serving." : "Water is optional at this dilution."}</li>`);
      gelSteps.insertAdjacentHTML("beforeend", `<li>Whisk the dry ingredients in a medium mixing bowl.</li><li>Add fruit base${fuel.havePectin ? " and calcium water" : ""}; whisk until smooth.</li><li>Pour into a heat-safe measuring cup.</li>`);
      if (fuel.havePectin) gelSteps.insertAdjacentHTML("beforeend", `<li>Microwave 30 seconds and stir. Watch continuously; stop immediately when rising begins. Stir and repeat until the mixture has risen three times total.</li><li>Transfer to flasks and seal while warm. Cool to room temperature before refrigerating.</li>`);
      else gelSteps.insertAdjacentHTML("beforeend", `<li>Microwave 25 seconds and stir; repeat briefly if needed.</li><li>Transfer to flasks and seal. Cool to room temperature before refrigerating.</li>`);
    }

    function renderSummary(plan) {
      const gelSettings = VeloModelConfig.get("fueling.gelConcentration");
      document.querySelector("#summary-units").value = plan.units === "metric" ? "metric" : "imperial";
      const rate = carbsPerHour(plan);
      const total = Math.round(rate * elapsedDurationMinutes(plan) / 60);
      const bottleCarbs = Math.min(total, fuel.bottles * fuel.bottleCapacity);
      const gelCarbs = Math.max(0, total - bottleCarbs);
      const gelCapacity = fuel.gelSizeOz * gelSettings.flaskCapacityGramsPerOz;
      const gelFlasks = gelCarbs && gelCapacity > 0 ? Math.ceil(gelCarbs / gelCapacity) : 0;
      const gelStops = gelCarbs ? Math.ceil(gelCarbs / fuel.maxGelStop) : 0;
      const avg = durationWeightedAveragePower(plan) || estimateMechanicalPower(plan);
      const movingHours = plan.route.movingDurationMinutes / 60;
      const workload = plan.powerTargets.length ? estimatedWorkload(plan) : thresholdRelativeWorkload(avg, plan.athlete.thresholdPower, movingHours);
      const speedKmh = plan.route.movingDurationMinutes > 0 ? plan.route.distanceKm / (plan.route.movingDurationMinutes / 60) : 0;
      const speed = plan.units === "imperial" ? speedKmh * 0.6213711922 : speedKmh;
      const alignment = combinedDemand(plan) > 0 ? ((workload - combinedDemand(plan)) / combinedDemand(plan)) * 100 : null;
      const servingsPerBottle = fuel.drinkCarbs > 0 ? Math.ceil(Math.min(total / Math.max(1, fuel.bottles), fuel.bottleCapacity) / fuel.drinkCarbs) : 0;
      const importedPowerPlan = isPowerMasterPlan(plan);
      const alignmentTone = alignment == null || Math.abs(alignment) < 1 ? "aligned" : alignment > 0 ? "positive" : "negative";
      const alignmentActions = combinedDemand(plan) > 0 ? [
        { action: "demand-minus", label: "Decrease combined demand by 1%", text: "−" },
        { action: "demand-plus", label: "Increase combined demand by 1%", text: "+" },
        plan.powerTargets.length && { action: "demand-fit", label: "Fit demand and best profile to the power plan", text: "⌈", kind: "fit" },
      ].filter(Boolean) : [];
      renderSummaryFields(elements.summary, [
        !importedPowerPlan && { label: "Moving duration", value: `${plan.route.movingDurationMinutes.toFixed(1)} min`, tooltip: "Planned time in motion, used for workload calculations." },
        !importedPowerPlan && { label: "Elapsed duration", value: `${elapsedDurationMinutes(plan).toFixed(1)} min`, tooltip: "Moving duration plus stopped duration, used for the total fueling requirement." },
        !importedPowerPlan && { label: "Average speed", value: speed > 0 ? `${speed.toFixed(1)} ${plan.units === "imperial" ? "mph" : "km/h"}` : "Add route distance", tooltip: "Route distance divided by moving duration." },
        !importedPowerPlan && { label: "Weighted average power", value: `${Math.round(avg)} W`, tooltip: "Average mechanical power weighted by target duration, or the route-physics estimate when no detailed targets exist." },
        { label: "Power plan", value: plan.powerTargets.length ? `${plan.powerTargets.length} target rows` : "Route estimate", tooltip: "Shows whether fueling is based on detailed Power Master targets or Fuel Master's route estimate." },
        !importedPowerPlan && { label: "Estimated IF", value: plan.athlete.thresholdPower ? (avg / plan.athlete.thresholdPower).toFixed(2) : "—", tooltip: "Average power divided by threshold power; this is not normalized-power IF." },
        { label: "Workload", value: workload.toFixed(1), tooltip: "Simplified threshold-relative work used to connect the execution plan to fueling intensity." },
        { label: "Demand alignment", value: alignment == null ? "—" : `${alignment >= 0 ? "+" : ""}${alignment.toFixed(1)}%`, tooltip: "Difference between estimated workload and combined demand. Within one percent is considered aligned.", tone: alignmentTone, actions: alignmentActions },
        { label: "Fuel target", value: `${rate} g/hr`, tooltip: "Recommended hourly carbohydrate intake from intensity, demand, duration, and fueling mode." },
        { label: "Ride total", value: `${total} g`, tooltip: "Fuel target multiplied by elapsed ride duration." },
        { label: "Bottles", value: `${Math.round(bottleCarbs)} g across ${fuel.bottles}`, tooltip: "Total carbohydrate assigned to the selected number of fuel bottles." },
        { label: "Gel", value: `${Math.round(gelCarbs)} g · ${gelFlasks} flask(s) · ${gelStops} stop(s)`, tooltip: "Remaining carbohydrate assigned to gel, including calculated flask and consumption-stop counts." },
      ]);
      elements.summary.querySelectorAll("[data-summary-action]").forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.summaryAction === "demand-minus") adjustDemandRatio(.99);
        if (button.dataset.summaryAction === "demand-plus") adjustDemandRatio(1.01);
        if (button.dataset.summaryAction === "demand-fit") fitDemandToPowerPlan();
      }));
      const bottleShare = fuel.bottles > 0 ? Math.min(total, fuel.bottles * fuel.bottleCapacity) : 0;
      const gelPerFlask = gelFlasks > 0 ? gelCarbs / gelFlasks : 0;
      const gelPerStop = gelStops > 0 ? gelCarbs / gelStops : 0;
      elements.recipe.innerHTML = `
        <div class="recipe-item"><strong>Carry</strong><span>${fuel.bottles} fuel bottle(s)${gelFlasks ? ` + ${Math.max(1, Number(fuel.gelFlasks) || 1)} gel flask(s)` : ""} + ${Math.max(0, Number(fuel.waterFlasks) || 0)} water flask(s)</span></div>
        <div class="recipe-item"><strong>Bottle mix</strong><span>${Math.round(bottleShare)}g total · ${fuel.bottles ? Math.round(bottleShare / Math.max(1, fuel.bottles)) : 0}g per bottle${fuel.drinkCarbs > 0 ? ` · about ${servingsPerBottle} ${escapeHtml(fuel.drinkName)} serving(s)` : ""}</span></div>
        <div class="recipe-item"><strong>Gel mix</strong><span>${Math.round(gelCarbs)}g total${gelFlasks ? ` · ${Math.round(gelPerFlask)}g per flask` : ""}${gelStops ? ` · ${Math.round(gelPerStop)}g per stop` : ""}</span></div>
        <div class="recipe-item"><strong>Water note</strong><span>${gelPerStop > gelSettings.waterRecommendedAboveGrams ? "Drink water with each gel serving." : "Carry water separately and drink to thirst."}</span></div>`;
      const gelLiquidOz = Math.max(gelSettings.minimumLiquidOz, gelCarbs * gelSettings.liquidOzPerGram, gelStops * gelSettings.minimumLiquidOzPerStop);
      renderRecipe(plan, { bottleShare, gelCarbs, gelFlasks, gelStops, gelPerFlask, gelPerStop, gelLiquidOz, gelLiquidPerStopOz: gelStops ? gelLiquidOz / gelStops : 0, waterRecommended: gelPerStop > gelSettings.waterRecommendedAboveGrams });
    }

    document.querySelectorAll("#drink-name,#drink-carbs,#fuel-mode,#custom-carbs,#bottles,#bottle-capacity,#gel-size,#gel-flasks,#water-flasks,#gel-stop,#have-malto,#have-fructose,#have-gatorade,#have-pectin,#have-salt,#spoon-tablespoon,#spoon-1,#spoon-half,#spoon-quarter,#spoon-eighth,#spoon-third").forEach((input) => input.addEventListener("input", () => {
      rememberFuel(input.id.startsWith("spoon-") ? "spoons" : "fueling");
      fuel = {
        drinkName: document.querySelector("#drink-name").value.trim() || fuelDefaults.drinkName,
        drinkCarbs: Number(document.querySelector("#drink-carbs").value) || 0,
        mode: document.querySelector("#fuel-mode").value,
        customCarbs: Number(document.querySelector("#custom-carbs").value),
        bottles: Number(document.querySelector("#bottles").value),
        bottleCapacity: Number(document.querySelector("#bottle-capacity").value),
        gelSizeOz: (Number(document.querySelector("#gel-size").value) || 0) / (store.get().units === "metric" ? 29.5735295625 : 1),
        maxGelStop: Number(document.querySelector("#gel-stop").value),
        gelFlasks: Number(document.querySelector("#gel-flasks").value) || fuelDefaults.gelFlasks,
        waterFlasks: Number(document.querySelector("#water-flasks").value) || 0,
        haveMalto: document.querySelector("#have-malto").checked,
        haveFructose: document.querySelector("#have-fructose").checked,
        haveGatorade: document.querySelector("#have-gatorade").checked,
        havePectin: document.querySelector("#have-pectin").checked,
        haveSalt: document.querySelector("#have-salt").checked,
        spoons: {
          tablespoon: document.querySelector("#spoon-tablespoon").checked,
          one: document.querySelector("#spoon-1").checked, half: document.querySelector("#spoon-half").checked,
          quarter: document.querySelector("#spoon-quarter").checked, eighth: document.querySelector("#spoon-eighth").checked,
          third: document.querySelector("#spoon-third").checked
        }
      };
      persistFuel();
      renderFuelFields();
      renderSummary(store.get());
    }));
    document.querySelectorAll("[data-fuel-history]").forEach((button) => button.addEventListener("click", () => {
      const section = button.dataset.fuelSection;
      if (button.dataset.fuelHistory === "reset") resetFuelSection(section);
      else runFuelHistory(section, button.dataset.fuelHistory);
    }));
    document.querySelector("#fuel-mode").addEventListener("change", () => {
      rememberFuel("fueling");
      fuel.mode = document.querySelector("#fuel-mode").value;
      const modeDefaults = { easy: 55, endurance: 70, hard: 85, race: 100 };
      fuel.customCarbs = fuel.mode === "automatic" ? automaticCarbsPerHour(store.get()) : (modeDefaults[fuel.mode] || fuel.customCarbs || 70);
      persistFuel();
      renderFuelFields();
      renderSummary(store.get());
    });
    document.querySelector("#save-recipe").addEventListener("click", () => {
      renderSummary(store.get());
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuel Master Recipe</title><style>body{font:16px/1.5 Arial,sans-serif;max-width:820px;margin:auto;padding:24px;color:#263238}h1,h2,h3{color:#1a237e}.equipment-card,.recipe-card{padding:16px;margin:0 0 16px;border:1px solid #cfd8dc;border-radius:8px;background:#fff}.equipment-card{background:#fffde7}li{margin:.4rem 0}.target-badge{float:right;font-size:12px;background:#ffebee;color:#b71c1c;padding:3px 7px;border-radius:4px}</style></head><body><h1>Fuel Master Recipe</h1>${document.querySelector("#recipe-export-content").innerHTML}</body></html>`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      link.download = "fuel-master-recipe.html";
      link.click();
      URL.revokeObjectURL(link.href);
    });
    document.querySelector("#fuel-units").addEventListener("change", () => {
      const plan = store.get();
      remember("athlete");
      plan.units = document.querySelector("#fuel-units").value;
      store.set(plan);
    });
    document.querySelector("#summary-units").addEventListener("change", (event) => {
      const plan = store.get();
      remember("athlete");
      plan.units = event.target.value;
      store.set(plan);
    });
    elements.loadButton.addEventListener("click", () => elements.file.click());
    elements.loadedName.addEventListener("click", () => elements.file.click());
    elements.file.addEventListener("change", async () => {
      try {
        const file = elements.file.files[0];
        const plan = await readJsonFile(file);
        const raw = JSON.parse(await file.text());
        if (raw.fueling) {
          fuel = { ...fuelDefaults, ...raw.fueling };
          persistFuel();
        }
        plan.source = { ...plan.source, tool: plan.powerTargets.length ? "power-master" : "fuel-master", fileName: file.name };
        if (plan.powerTargets.length) syncImportedPowerDemand(plan);
        setLoadedBaseline(plan, fuel);
        clearHistories();
        store.set(plan);
        setStatus(elements.status, plan.powerTargets.length ? `Loaded ${file.name}. Shared planning fields are locked.` : `Loaded ${file.name}.`);
      } catch (error) { setStatus(elements.status, error.message, "error"); }
      elements.file.value = "";
    });
    document.querySelector("#save-button").addEventListener("click", () => {
      downloadJson("fuel-master-plan.json", { ...store.get(), fueling: fuel });
    });
    elements.remove.addEventListener("click", () => {
      const plan = store.get();
      setLoadedBaseline(null);
      plan.source = { tool: "fuel-master", fileName: null };
      plan.powerTargets = [];
      plan.demand.mode = "manual";
      elements.file.value = "";
      store.set(plan);
      setStatus(elements.status, "Loaded parameter file removed; current planning values are retained.");
    });
    document.querySelector("#reset-button").addEventListener("click", () => {
      const resetToFile = Boolean(loadedBaseline);
      if (!confirm(resetToFile ? "Restore the parameters from the loaded file?" : "Reset Fuel Master to factory defaults?")) return;
      fuel = resetToFile ? { ...loadedBaseline.fuel } : { ...fuelDefaults };
      persistFuel();
      clearHistories();
      store.set(resetToFile ? structuredClone(loadedBaseline.plan) : initial);
      setStatus(elements.status, resetToFile ? `Restored ${loadedBaseline.plan.source.fileName}.` : "Fuel Master reset to defaults.");
    });

    store.subscribe(render);
    if (!store.loadLocal()) render(initial);
    else if (!loadedBaseline && store.get().source.fileName) {
      setLoadedBaseline(store.get(), fuel);
      render(store.get());
    }
    restoreSectionAnchor();
