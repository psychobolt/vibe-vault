    const { attachSectionLinks, attachSectionPins, attachStickyActions, attachToolSidebar, createPlanStore, downloadFile, downloadJson, protectSummaryActions, readJsonFile, renderSummaryFields, restoreSectionAnchor, setStatus, wholeWatts } = VeloApp;
    const { roundTo } = VeloMath;
    const { enhanceNumberSliders, escapeHtml } = VeloUtils;
    const { PROFILES, calculateDemandFromTargetDuration, combinedDemand, createDefaultPlan, createDefaultPowerTargets, createProfilePowerTargets, durationWeightedAveragePower, estimatedWorkload, estimateMechanicalPower, normalizePlan, targetPower } = VeloPlanning;
    const { renderPlanningUI } = VeloPlanningUI;
    const { parseActivityFile } = VeloActivity;

    const elements = {
      planning: document.querySelector("#planning-fields"),
      targets: document.querySelector("#target-list"),
      summary: document.querySelector("#plan-summary"),
      tape: document.querySelector("#tape"),
      file: document.querySelector("#load-plan"),
      loadButton: document.querySelector("#load-button"),
      loadedControl: document.querySelector("#loaded-plan-control"),
      loadedName: document.querySelector("#loaded-plan-name"),
      tapeUnits: document.querySelector("#tape-units"),
      summaryUnits: document.querySelector("#summary-units"),
      status: document.querySelector("#status"),
      stemWidth: document.querySelector("#stem-width"),
      stemWidthValue: document.querySelector("#stem-width-value"),
      tapeLength: document.querySelector("#tape-length"),
      tapeLengthValue: document.querySelector("#tape-length-value"),
      baseFontSize: document.querySelector("#base-font-size"),
      baseFontSizeValue: document.querySelector("#base-font-size-value"),
      previewZoom: document.querySelector("#preview-zoom"),
      previewPanel: document.querySelector("#preview-panel"),
      previewViewport: document.querySelector("#preview-viewport"),
      expandPreview: document.querySelector("#expand-preview"),
      toggleTargets: document.querySelector("#toggle-targets"),
      parameterActions: document.querySelector("#parameter-actions"),
    };

    attachToolSidebar("power");
    attachSectionLinks();
    attachSectionPins();
    attachStickyActions(elements.parameterActions);
    protectSummaryActions();

    const initial = createDefaultPlan();
    initial.source.tool = "power-master";
    initial.powerTargets = createDefaultPowerTargets(initial.athlete.thresholdPower);
    const store = createPlanStore("velo-tools:power-master", initial);
    const histories = Object.fromEntries(["athlete", "route", "resistance", "demand", "tape", "targets"].map((id) => [id, { undo: [], redo: [] }]));
    const loadedBaselineKey = "velo-tools:power-master:loaded-baseline";
    let loadedBaseline = readLoadedBaseline();
    let targetSortable = null;
    const collapsedTargetIds = new Set();

    // A loaded file becomes the Reset baseline until its trash control removes the association.
    function readLoadedBaseline() {
      try {
        const saved = localStorage.getItem(loadedBaselineKey);
        return saved ? normalizePlan(JSON.parse(saved)) : null;
      } catch {
        localStorage.removeItem(loadedBaselineKey);
        return null;
      }
    }

    function setLoadedBaseline(plan) {
      loadedBaseline = plan ? normalizePlan(structuredClone(plan)) : null;
      if (loadedBaseline) localStorage.setItem(loadedBaselineKey, JSON.stringify(loadedBaseline));
      else localStorage.removeItem(loadedBaselineKey);
    }

    function clearHistories() {
      Object.values(histories).forEach((history) => { history.undo.length = 0; history.redo.length = 0; });
    }

    function remember(section, snapshot = store.get()) {
      histories[section].undo.push(snapshot);
      histories[section].redo.length = 0;
    }

    function historyState() {
      return Object.fromEntries(Object.entries(histories).map(([id, history]) => [id, { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 }]));
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
        targets: "Power Targets",
        tape: "Stem Dashboard",
      };
      setStatus(elements.status, `${direction === "undo" ? "Undid" : "Redid"} ${labels[section] || section} change.`);
    }

    function resetSection(section) {
      remember(section);
      const plan = store.get();
      plan[section] = structuredClone(createDefaultPlan()[section]);
      commit(plan, `${section}.reset`);
      setStatus(elements.status, `${section[0].toUpperCase() + section.slice(1)} reset.`);
    }

    function defaultTargetRow(plan, index, current = {}) {
      const fallback = createDefaultPowerTargets(plan.athlete.thresholdPower)[index] || {
        label: "TARGET",
        terrain: "flat",
        minPower: 0,
        targetPower: plan.athlete.thresholdPower,
        maxPower: 0,
        cadence: "90",
        durationMinutes: 10,
        durationValue: 10,
        durationUnit: "minutes",
        textColor: "#455a64",
        backgroundColor: "#ffffff",
      };
      return { ...structuredClone(fallback), id: current.id || fallback.id || crypto.randomUUID() };
    }

    function resetTargetRow(plan, index) {
      const current = plan.powerTargets[index] || {};
      const baselineRows = loadedBaseline?.powerTargets || createDefaultPowerTargets(plan.athlete.thresholdPower);
      const baseline = baselineRows.find((row) => row.id === current.id) || baselineRows[index];
      return baseline ? { ...structuredClone(baseline), id: current.id || baseline.id } : defaultTargetRow(plan, index, current);
    }

    function commit(plan, path = "") {
      plan.source.tool = "power-master";
      if (plan.demand.mode === "target-duration") calculateDemandFromTargetDuration(plan);
      store.set(plan);
    }

    function render(plan) {
      renderPlanningUI(elements.planning, plan, {
        showUnits: true,
        onChange(next, path) { remember(path === "units" ? "athlete" : path.split(".")[0], plan); commit(next, path); },
        async onActivityFile(file) {
          try {
            const route = await parseActivityFile(file);
            remember("route");
            const next = store.get();
            next.route = { ...next.route, ...route };
            commit(next, "route.activity");
            setStatus(elements.status, `Loaded ${file.name}.`);
          } catch (error) { setStatus(elements.status, error.message, "error"); }
        },
        onClearActivity() {
          remember("route");
          const next = store.get();
          next.route.activityFileName = null;
          commit(next, "route.activityFileName");
          setStatus(elements.status, "Activity route removed; route values are now editable.");
        },
        sectionActions: {
          state: historyState(),
          undo: (section) => runHistory(section, "undo"),
          redo: (section) => runHistory(section, "redo"),
          reset: resetSection,
        },
      });
      renderTargets(plan);
      renderSummary(plan);
      renderTapeAppearance(plan);
      renderTape(plan);
      renderLoadedFile(plan);
      elements.tapeUnits.value = plan.units;
      document.querySelector("#targets-undo").disabled = !histories.targets.undo.length;
      document.querySelector("#targets-redo").disabled = !histories.targets.redo.length;
      document.querySelector("#tape-undo").disabled = !histories.tape.undo.length;
      document.querySelector("#tape-redo").disabled = !histories.tape.redo.length;
    }

    function renderLoadedFile(plan) {
      const hasLoadedFile = Boolean(loadedBaseline && plan.source.fileName);
      elements.loadButton.hidden = hasLoadedFile;
      elements.loadedControl.hidden = !hasLoadedFile;
      elements.loadedName.value = hasLoadedFile ? plan.source.fileName : "";
    }

    function renderTargets(plan) {
      const activeIds = new Set(plan.powerTargets.map((row) => row.id));
      document.querySelectorAll(".pinned-section-dock > .target-row[data-target-id]").forEach((row) => {
        if (activeIds.has(row.dataset.targetId)) return;
        localStorage.removeItem(`velo-sticky:${location.pathname}:${row.id}`);
        row.remove();
        const dock = document.querySelector(".pinned-section-dock");
        if (dock) dock.hidden = !dock.children.length;
      });
      [...collapsedTargetIds].forEach((id) => { if (!activeIds.has(id)) collapsedTargetIds.delete(id); });
      elements.targets.innerHTML = plan.powerTargets.length ? `<div class="target-table"><div class="target-head"><span></span><span>Label</span><span>Terrain</span><span>Min W</span><span>Target W</span><span>Max W</span><span>Cadence</span><span>Duration</span><span>Text</span><span>BG</span><span></span><span></span></div><div class="target-list-body">${plan.powerTargets.map((row, index) => `
        <div id="${targetDomId(row.id)}" class="target-row ${collapsedTargetIds.has(row.id) ? "is-collapsed" : ""}" data-index="${index}" data-target-id="${escapeHtml(row.id)}">
          <span class="target-leading-controls" aria-label="Reorder and edit ${escapeHtml(row.label)}">
            <span class="drag-handle" title="Drag to reorder" aria-label="Drag ${escapeHtml(row.label)} to reorder">⋮⋮</span>
            <button class="mobile-move-control" type="button" data-move-index="${index}" data-move-direction="-1" aria-label="Move ${escapeHtml(row.label)} up" title="Move up" ${index === 0 ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg></button>
            <button class="mobile-move-control" type="button" data-move-index="${index}" data-move-direction="1" aria-label="Move ${escapeHtml(row.label)} down" title="Move down" ${index === plan.powerTargets.length - 1 ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 10 6 6 6-6"/></svg></button>
            <button class="reset-target" type="button" data-reset-row="${index}" title="Restore ${escapeHtml(row.label)} original values" aria-label="Restore ${escapeHtml(row.label)} original values"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4-4L13.6 6.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L7 21Z"/><path d="m6 14 4 4"/><path d="M7 21h12"/></svg></button>
            <button class="remove-target danger" type="button" data-remove="${index}" title="Remove ${escapeHtml(row.label)}" aria-label="Remove ${escapeHtml(row.label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </span>
          ${targetLabelField(row)}
          ${terrainField(row.terrain)}
          ${field("Min W", "minPower", row.minPower, "number")}
          ${field("Target W", "targetPower", row.targetPower, "number")}
          ${field("Max W", "maxPower", row.maxPower, "number")}
          ${field("Cadence", "cadence", row.cadence, "text")}
          ${durationField(row)}
          ${field("Text", "textColor", row.textColor, "color")}
          ${field("BG", "backgroundColor", row.backgroundColor, "color")}
          <span class="target-actions">
            <button class="pin-target section-sticky-toggle" type="button" data-sticky-target="${targetDomId(row.id)}" data-sticky-label="${escapeHtml(row.label)}" title="Pin ${escapeHtml(row.label)}" aria-label="Pin ${escapeHtml(row.label)}" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 14v7"/></svg></button>
            <button class="target-collapse icon-button" type="button" data-toggle-target="${escapeHtml(row.id)}" title="${collapsedTargetIds.has(row.id) ? "Expand" : "Collapse"} ${escapeHtml(row.label)}" aria-label="${collapsedTargetIds.has(row.id) ? "Expand" : "Collapse"} ${escapeHtml(row.label)}" aria-expanded="${collapsedTargetIds.has(row.id) ? "false" : "true"}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
          </span>
        </div>`).join("")}</div></div>` : `<p class="status">Add targets for flat roads, climbs, descents, wind, pulls, or recovery.</p>`;

      enhanceNumberSliders(elements.targets);

      elements.targets.querySelectorAll("[data-toggle-target]").forEach((button) => button.addEventListener("click", () => {
        const id = button.dataset.toggleTarget;
        if (collapsedTargetIds.has(id)) collapsedTargetIds.delete(id);
        else collapsedTargetIds.add(id);
        renderTargets(store.get());
      }));

      elements.targets.querySelectorAll("[data-key]").forEach((input) => input.addEventListener("change", (event) => {
        remember("targets");
        const plan = store.get();
        const row = plan.powerTargets[Number(event.target.closest("[data-index]").dataset.index)];
        const key = event.target.dataset.key;
        if (["label", "terrain", "cadence", "textColor", "backgroundColor"].includes(key)) row[key] = event.target.value;
        else if (key.includes("Power")) row[key] = wholeWatts(event.target.value);
        else if (key === "durationValue") {
          row.durationValue = normalizeDurationValue(event.target.value, row.durationUnit);
          row.durationMinutes = roundTo(durationToMinutes(row.durationValue, row.durationUnit), 1);
        } else if (key === "durationUnit") {
          row.durationUnit = event.target.value;
          row.durationValue = normalizeDurationValue(minutesToDuration(row.durationMinutes, row.durationUnit), row.durationUnit);
        }
        commit(plan, "powerTargets");
      }));
      elements.targets.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => {
        remember("targets");
        const plan = store.get();
        plan.powerTargets.splice(Number(button.dataset.remove), 1);
        commit(plan, "powerTargets");
      }));
      elements.targets.querySelectorAll("[data-reset-row]").forEach((button) => button.addEventListener("click", () => {
        remember("targets");
        const plan = store.get();
        const index = Number(button.dataset.resetRow);
        plan.powerTargets[index] = resetTargetRow(plan, index);
        commit(plan, "powerTargets");
      }));
      elements.targets.querySelectorAll("[data-move-index]").forEach((button) => button.addEventListener("click", () => {
        const index = Number(button.dataset.moveIndex);
        const destination = index + Number(button.dataset.moveDirection);
        const plan = store.get();
        if (destination < 0 || destination >= plan.powerTargets.length) return;
        remember("targets");
        const [row] = plan.powerTargets.splice(index, 1);
        plan.powerTargets.splice(destination, 0, row);
        commit(plan, "powerTargets");
      }));
      updateTargetCollapseToggle(plan);
      bindTargetDragging();
      attachSectionPins(elements.targets);
    }

    function updateTargetCollapseToggle(plan) {
      const allCollapsed = plan.powerTargets.length > 0 && plan.powerTargets.every((row) => collapsedTargetIds.has(row.id));
      elements.toggleTargets.disabled = plan.powerTargets.length === 0;
      elements.toggleTargets.title = allCollapsed ? "Expand All Power Targets" : "Collapse All Power Targets";
      elements.toggleTargets.setAttribute("aria-label", elements.toggleTargets.title);
      elements.toggleTargets.innerHTML = allCollapsed
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5-5 5 5M7 14l5 5 5-5"/></svg>`
        : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 9 5-5 5 5M7 15l5 5 5-5"/></svg>`;
    }

    function field(label, key, value, type) {
      const className = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      const numeric = type === "number" ? "min=\"0\" max=\"1200\" step=\"1\" data-slider-max=\"1200\"" : "";
      return `<label class="field target-field--${className}"><span>${label}</span><input type="${type}" ${numeric} value="${value}" data-key="${key}"></label>`;
    }

    function targetLabelField(row) {
      const profile = PROFILES.find((item) => item.id === row.sourceProfile);
      const badge = profile ? `<span class="target-source">${escapeHtml(profile.label)}</span>` : "";
      return `<label class="field target-field--label"><span>Label</span><div class="target-label-control ${badge ? "has-source" : ""}"><input type="text" value="${escapeHtml(row.label)}" data-key="label">${badge}</div></label>`;
    }

    function targetDomId(id) {
      return `power-target-${String(id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    }

    function terrainField(value) {
      return `<label class="field target-field--terrain"><span>Terrain</span><select data-key="terrain">${["flat", "incline", "climb", "decline", "steep-ramp"].map((terrain) => `<option value="${terrain}" ${terrain === value ? "selected" : ""}>${terrain}</option>`).join("")}</select></label>`;
    }

    function durationField(row) {
      const unit = row.durationUnit || "minutes";
      const step = unit === "seconds" ? 1 : unit === "hours" ? 0.01 : 0.1;
      const maximum = unit === "seconds" ? 3600 : unit === "hours" ? 24 : 1440;
      return `<label class="field target-field--duration"><span>Duration</span><div class="duration-control"><input type="number" min="0" max="${maximum}" step="${step}" value="${normalizeDurationValue(row.durationValue ?? row.durationMinutes, unit)}" data-slider-max="${maximum}" data-slider-step="${step}" data-key="durationValue"><select data-key="durationUnit"><option value="seconds" ${unit === "seconds" ? "selected" : ""}>sec</option><option value="minutes" ${unit === "minutes" ? "selected" : ""}>min</option><option value="hours" ${unit === "hours" ? "selected" : ""}>hr</option></select></div></label>`;
    }

    function durationToMinutes(value, unit) { return unit === "seconds" ? value / 60 : unit === "hours" ? value * 60 : value; }
    function minutesToDuration(minutes, unit) { return unit === "seconds" ? minutes * 60 : unit === "hours" ? minutes / 60 : minutes; }
    function normalizeDurationValue(value, unit) { return roundTo(Math.max(0, Number(value) || 0), unit === "seconds" ? 0 : unit === "hours" ? 2 : 1); }

    function bindTargetDragging() {
      targetSortable?.destroy();
      targetSortable = null;
      const container = elements.targets.querySelector(".target-list-body");
      if (!container) return;

      if (globalThis.Sortable?.create) {
        let startPlan = null;
        targetSortable = globalThis.Sortable.create(container, {
          animation: 150,
          draggable: ".target-row",
          handle: ".drag-handle",
          ghostClass: "target-row--ghost",
          chosenClass: "dragging",
          dragClass: "dragging",
          fallbackOnBody: true,
          fallbackTolerance: 4,
          onStart() { startPlan = store.get(); },
          onEnd() {
            commitTargetOrder(container, startPlan);
            startPlan = null;
          },
        });
        return;
      }

      bindNativeTargetDragging(container);
    }

    function commitTargetOrder(container, startPlan) {
      const ids = [...container.querySelectorAll(".target-row")].map((row) => row.dataset.targetId);
      const plan = store.get();
      const byId = new Map(plan.powerTargets.map((row) => [row.id, row]));
      const visibleIds = new Set(ids);
      const visibleQueue = ids.map((id) => byId.get(id)).filter(Boolean);
      // Floating targets remain anchored in their plan positions while the
      // visible source rows are reordered around them.
      const reordered = plan.powerTargets.map((row) => visibleIds.has(row.id) ? visibleQueue.shift() : row);
      const changed = reordered.some((row, index) => row.id !== plan.powerTargets[index]?.id);
      if (!changed) return false;
      remember("targets", startPlan || plan);
      plan.powerTargets = reordered;
      commit(plan, "powerTargets");
      return true;
    }

    // Direct file use remains functional when the CDN is unavailable.
    function bindNativeTargetDragging(container) {
      let startPlan = null;
      container.querySelectorAll(".drag-handle").forEach((handle) => {
        handle.draggable = true;
        handle.addEventListener("dragstart", (event) => {
          startPlan = store.get();
          const row = event.target.closest(".target-row");
          row.classList.add("dragging");
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", row.dataset.targetId);
        });
        handle.addEventListener("dragend", () => {
          commitTargetOrder(container, startPlan);
          handle.closest(".target-row")?.classList.remove("dragging");
          startPlan = null;
        });
      });
      container.querySelectorAll(".target-row").forEach((row) => row.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = container.querySelector(".target-row.dragging");
        if (!dragging || dragging === row) return;
        const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        row.parentElement.insertBefore(dragging, after ? row.nextSibling : row);
      }));
    }

    function renderSummary(plan) {
      elements.summaryUnits.value = plan.units;
      const weighted = durationWeightedAveragePower(plan);
      const mechanical = estimateMechanicalPower(plan);
      const displayedPower = weighted || mechanical;
      const estimatedIf = plan.athlete.thresholdPower > 0 ? displayedPower / plan.athlete.thresholdPower : 0;
      const speedKmh = plan.route.movingDurationMinutes > 0 ? plan.route.distanceKm / (plan.route.movingDurationMinutes / 60) : 0;
      const speed = plan.units === "imperial" ? speedKmh * 0.6213711922 : speedKmh;
      renderSummaryFields(elements.summary, [
        { label: "Moving duration", value: `${plan.route.movingDurationMinutes.toFixed(1)} min`, tooltip: "Total planned time in motion across the route." },
        { label: "Average speed", value: speed > 0 ? `${speed.toFixed(1)} ${plan.units === "imperial" ? "mph" : "km/h"}` : "Add route distance", tooltip: "Route distance divided by moving duration; stopped time is excluded." },
        { label: weighted ? "Duration-weighted power" : "Estimated average power", value: displayedPower ? `${Math.round(displayedPower)} W` : "Add route distance", tooltip: "Average mechanical power weighted by each target row's assigned duration." },
        { label: "Estimated IF", value: estimatedIf > 0 ? estimatedIf.toFixed(2) : "—", tooltip: "Duration-weighted average power divided by threshold power; this is an estimate, not normalized-power IF." },
        { label: "Estimated workload", value: (plan.powerTargets.length ? estimatedWorkload(plan) : combinedDemand(plan)).toFixed(1), tooltip: "Simplified threshold-relative workload accumulated from target power and duration." },
        { label: "Combined demand", value: combinedDemand(plan).toFixed(1), tooltip: "The sum of aerobic, hard-effort, and sprint demand." },
      ]);
    }

    function renderTapeAppearance(plan) {
      const imperial = plan.units === "imperial";
      elements.stemWidth.min = imperial ? "0.6" : "15";
      elements.stemWidth.max = imperial ? "2.4" : "60";
      elements.stemWidth.step = imperial ? "0.01" : "0.1";
      elements.stemWidth.value = imperial ? (plan.tape.stemWidthMm / 25.4).toFixed(2) : plan.tape.stemWidthMm.toFixed(1);
      elements.tapeLength.min = "0";
      elements.tapeLength.max = imperial ? "8" : "200";
      elements.tapeLength.step = imperial ? "0.05" : "1";
      elements.tapeLength.value = plan.tape.maxLengthMm ? (imperial ? plan.tape.maxLengthMm / 25.4 : plan.tape.maxLengthMm) : 0;
      elements.baseFontSize.value = plan.tape.baseFontSizePt;
      elements.previewZoom.value = plan.tape.previewZoom;
      elements.summaryUnits.value = plan.units;
      document.querySelector("#stem-width-label").textContent = `Stem Width (${imperial ? "in" : "mm"})`;
      document.querySelector("#tape-length-label").textContent = `Max Dashboard Length (${imperial ? "in" : "mm"})`;
      elements.stemWidthValue.min = elements.stemWidth.min;
      elements.stemWidthValue.max = elements.stemWidth.max;
      elements.stemWidthValue.step = elements.stemWidth.step;
      elements.stemWidthValue.value = elements.stemWidth.value;
      elements.tapeLengthValue.max = elements.tapeLength.max;
      elements.tapeLengthValue.step = elements.tapeLength.step;
      elements.tapeLengthValue.value = plan.tape.maxLengthMm ? String(roundTo(Number(elements.tapeLength.value), imperial ? 2 : 0)) : "";
      elements.baseFontSizeValue.value = String(plan.tape.baseFontSizePt);
      document.querySelector("#preview-zoom-value").textContent = `${plan.tape.previewZoom}%`;
    }

    function renderTape(plan) {
      const average = Math.round(durationWeightedAveragePower(plan));
      elements.tape.style.width = `${plan.tape.stemWidthMm}mm`;
      elements.tape.style.fontSize = `${plan.tape.baseFontSizePt}pt`;
      elements.tape.style.zoom = String(plan.tape.previewZoom / 100);
      elements.tape.innerHTML = `<div style="padding:2px 1px;font-weight:900">AVG ${average}W</div><table><tbody>${plan.powerTargets.map((row) => `<tr style="color:${row.textColor};background:${row.backgroundColor}"><td style="width:43%;padding:1px 0 1px 2px;border-left:2px solid ${row.textColor};font-weight:800">${escapeHtml(row.label)}</td><td style="width:36%;padding:1px 0;font-weight:800">${powerText(row)}</td><td style="width:21%;padding:1px 2px 1px 0;font-size:.9em">${escapeHtml(row.cadence)}</td></tr>`).join("")}</tbody></table>`;
      requestAnimationFrame(() => fitTape(plan));
    }

    function powerText(row) {
      if (row.minPower > 0 && row.maxPower > 0) return `${row.minPower}-${row.maxPower}`;
      if (row.targetPower > 0) return `${row.targetPower}`;
      if (row.minPower > 0) return `${row.minPower}+`;
      return row.maxPower > 0 ? `≤${row.maxPower}` : "—";
    }

    function fitTape(plan) {
      elements.tape.style.maxHeight = "";
      if (!plan.tape.maxLengthMm) return;
      const maxPixels = plan.tape.maxLengthMm * 96 / 25.4;
      const zoom = plan.tape.previewZoom / 100;
      const naturalPixels = elements.tape.scrollHeight / zoom;
      const scale = Math.min(1.35, Math.max(.62, maxPixels / Math.max(1, naturalPixels)));
      elements.tape.style.fontSize = `${plan.tape.baseFontSizePt * scale}pt`;
      elements.tape.style.maxHeight = `${plan.tape.maxLengthMm}mm`;
    }

    function previewExpandIcon(expanded) {
      return expanded
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/></svg>`
        : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>`;
    }

    function togglePreviewFullscreen() {
      const dashboard = document.querySelector("#stem-dashboard-panel");
      dashboard?.querySelector(".section-fullscreen-toggle")?.click();
    }

    document.querySelector("#add-target").addEventListener("click", () => {
      remember("targets");
      const plan = store.get();
      plan.powerTargets.push({ id: crypto.randomUUID(), label: "TARGET", terrain: "flat", minPower: 0, targetPower: plan.athlete.thresholdPower, maxPower: 0, cadence: "90", durationMinutes: 10, textColor: "#455a64", backgroundColor: "#ffffff" });
      commit(plan, "powerTargets");
    });
    function applyProfileTargets(mode) {
      const plan = store.get();
      const durationValue = Math.max(0, Number(document.querySelector("#profile-duration").value) || 0);
      const totalMinutes = document.querySelector("#profile-duration-unit").value === "hours" ? durationValue * 60 : durationValue;
      const profile = document.querySelector("#profile-template").value;
      const created = createProfilePowerTargets(profile, plan.athlete.thresholdPower, totalMinutes);
      if (!created.length) {
        setStatus(elements.status, "Enter a valid threshold power and profile duration.", "error");
        return;
      }
      remember("targets");
      plan.powerTargets = mode === "replace" ? created : [...plan.powerTargets, ...created];
      commit(plan, "powerTargets");
      setStatus(elements.status, `${mode === "replace" ? "Replaced with" : "Added"} ${created.length} ${profile} profile targets across ${Math.round(totalMinutes)} minutes.`);
    }
    document.querySelector("#add-profile-targets").addEventListener("click", () => applyProfileTargets("add"));
    document.querySelector("#replace-profile-targets").addEventListener("click", () => applyProfileTargets("replace"));
    enhanceNumberSliders(document.querySelector(".profile-targets"));
    function readTapeControls(plan) {
      const imperial = plan.units === "imperial";
      plan.tape.stemWidthMm = Math.max(15, Number(elements.stemWidth.value) * (imperial ? 25.4 : 1));
      const length = Math.max(0, Number(elements.tapeLength.value) || 0);
      plan.tape.maxLengthMm = length > 0 ? length * (imperial ? 25.4 : 1) : null;
      plan.tape.baseFontSizePt = Math.max(3.5, Number(elements.baseFontSize.value) || 5.25);
      plan.tape.previewZoom = Math.min(250, Math.max(100, Number(elements.previewZoom.value) || 140));
      return plan;
    }
    const appearancePairs = [
      [elements.stemWidth, elements.stemWidthValue],
      [elements.tapeLength, elements.tapeLengthValue],
      [elements.baseFontSize, elements.baseFontSizeValue],
    ];
    appearancePairs.forEach(([slider, valueField]) => {
      valueField.addEventListener("input", () => {
        slider.value = valueField.value === "" ? "0" : valueField.value;
        const preview = readTapeControls(store.get());
        renderTape(preview);
      });
      valueField.addEventListener("change", () => {
        slider.value = valueField.value === "" ? "0" : valueField.value;
        remember("tape");
        commit(readTapeControls(store.get()), "tape");
      });
    });
    [elements.stemWidth, elements.tapeLength, elements.baseFontSize, elements.previewZoom].forEach((control) => {
      control.addEventListener("input", () => {
        const preview = readTapeControls(store.get());
        renderTapeAppearance(preview);
        renderTape(preview);
      });
      control.addEventListener("change", () => {
        remember("tape");
        commit(readTapeControls(store.get()), "tape");
      });
    });
    elements.tapeUnits.addEventListener("change", () => {
      remember("tape");
      const plan = store.get();
      plan.units = elements.tapeUnits.value;
      commit(plan, "units");
    });
    elements.summaryUnits.addEventListener("change", () => {
      remember("athlete");
      const plan = store.get();
      plan.units = elements.summaryUnits.value;
      commit(plan, "units");
    });
    document.querySelector("#tape-undo").addEventListener("click", () => runHistory("tape", "undo"));
    document.querySelector("#tape-redo").addEventListener("click", () => runHistory("tape", "redo"));
    document.querySelector("#tape-reset").addEventListener("click", () => resetSection("tape"));
    document.querySelector("#save-tape").addEventListener("click", () => {
      const tape = elements.tape.cloneNode(true);
      tape.style.zoom = "1";
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Power Master Dashboard</title><style>body{margin:0;background:#fff}.tape{font-family:Arial,sans-serif;line-height:1;text-align:center;border:1px dashed #666;-webkit-print-color-adjust:exact;print-color-adjust:exact}.tape table{width:100%;border-collapse:collapse;table-layout:fixed;text-align:left}.tape td{line-height:1;white-space:nowrap}@media print{.tape{border:0}}</style></head><body>${tape.outerHTML}</body></html>`;
      downloadFile("power-master-dashboard.html", html, "text/html");
    });
    document.querySelector("#targets-undo").addEventListener("click", () => runHistory("targets", "undo"));
    document.querySelector("#targets-redo").addEventListener("click", () => runHistory("targets", "redo"));
    document.querySelector("#targets-clear").addEventListener("click", () => {
      remember("targets");
      const plan = store.get();
      plan.powerTargets = createDefaultPowerTargets(plan.athlete.thresholdPower);
      commit(plan, "powerTargets");
    });
    elements.toggleTargets.addEventListener("click", () => {
      const plan = store.get();
      const allCollapsed = plan.powerTargets.length > 0 && plan.powerTargets.every((row) => collapsedTargetIds.has(row.id));
      collapsedTargetIds.clear();
      if (!allCollapsed) plan.powerTargets.forEach((row) => collapsedTargetIds.add(row.id));
      renderTargets(plan);
    });
    elements.expandPreview.addEventListener("click", togglePreviewFullscreen);
    document.querySelector("#stem-dashboard-panel")?.addEventListener("sectionfullscreenchange", (event) => {
      const expanded = Boolean(event.detail?.fullscreen);
      elements.expandPreview.title = expanded ? "Restore Stem Dashboard" : "Expand Preview";
      elements.expandPreview.setAttribute("aria-label", elements.expandPreview.title);
      elements.expandPreview.setAttribute("aria-expanded", String(expanded));
      elements.expandPreview.innerHTML = previewExpandIcon(expanded);
      if (expanded) {
        const fullscreenZoom = Math.max(200, Number(elements.previewZoom.value) || 140);
        elements.previewZoom.value = fullscreenZoom;
        document.querySelector("#preview-zoom-value").textContent = `${fullscreenZoom}%`;
        elements.tape.style.zoom = String(fullscreenZoom / 100);
      } else renderTape(store.get());
    });
    elements.loadButton.addEventListener("click", () => elements.file.click());
    elements.loadedName.addEventListener("click", () => elements.file.click());
    elements.file.addEventListener("change", async () => {
      try {
        const file = elements.file.files[0];
        const plan = await readJsonFile(file);
        plan.source = { ...plan.source, tool: "power-master", fileName: file.name };
        setLoadedBaseline(plan);
        clearHistories();
        store.set(plan);
        setStatus(elements.status, `Loaded ${plan.source.fileName}.`);
      } catch (error) { setStatus(elements.status, error.message, "error"); }
      elements.file.value = "";
    });
    document.querySelector("#remove-loaded-plan").addEventListener("click", () => {
      const plan = store.get();
      setLoadedBaseline(null);
      plan.source.fileName = null;
      elements.file.value = "";
      store.set(plan);
      setStatus(elements.status, "Loaded parameter file removed; current values are retained.");
    });
    document.querySelector("#save-button").addEventListener("click", () => {
      downloadJson("power-master-plan.json", store.get());
    });
    document.querySelector("#reset-button").addEventListener("click", () => {
      const resetToFile = Boolean(loadedBaseline);
      if (!confirm(resetToFile ? "Restore the parameters from the loaded file?" : "Reset all Power Master parameters to defaults?")) return;
      const plan = resetToFile ? structuredClone(loadedBaseline) : createDefaultPlan();
      plan.source.tool = "power-master";
      if (!resetToFile) {
        plan.source.fileName = null;
        plan.powerTargets = createDefaultPowerTargets(plan.athlete.thresholdPower);
      }
      clearHistories();
      store.set(plan);
      setStatus(elements.status, resetToFile ? `Restored ${plan.source.fileName}.` : "Power Master reset to defaults.");
    });

    store.subscribe(render);
    if (!store.loadLocal()) render(initial);
    else if (!store.get().powerTargets.length) {
      const restored = store.get();
      restored.powerTargets = createDefaultPowerTargets(restored.athlete.thresholdPower);
      store.set(restored);
    } else if (!loadedBaseline && store.get().source.fileName) {
      // Preserve the association for files loaded by builds predating the stored reset baseline.
      setLoadedBaseline(store.get());
      render(store.get());
    }
    restoreSectionAnchor();
