// Shared browser utilities exposed globally so sibling file:// pages can reuse them.
(function (global) {
"use strict";
const { normalizePlan } = global.VeloPlanning;
const { clone } = global.VeloUtils;
const { wholeNumber } = global.VeloMath;

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

// Small domain stores keep non-plan state (for example Fuel Master's pantry)
// observable without merging unrelated fields into the shared planning schema.
// Alpine adapters can subscribe to the same interface during incremental migration.
function createStateStore(storageKey, initialState, normalize = (value) => value) {
  let state = clone(initialState);
  const listeners = new Set();

  return {
    get: () => clone(state),
    set(next, { persist = true } = {}) {
      state = clone(normalize(clone(next)));
      if (persist) localStorage.setItem(storageKey, JSON.stringify(state));
      listeners.forEach((listener) => listener(clone(state)));
    },
    loadLocal() {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return false;
      try {
        state = clone(normalize(JSON.parse(saved)));
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

// Shared metric renderer keeps both tools' summary cards structurally and
// accessibly consistent while allowing each tool to choose the useful fields.
function renderSummaryFields(container, fields) {
  if (!container) return;
  const fragment = global.document.createDocumentFragment();
  fields.filter(Boolean).forEach((field) => {
    const config = Array.isArray(field) ? { label: field[0], value: field[1] } : field;
    const { label, value, tooltip, tone, actions = [] } = config;
    const metric = global.document.createElement("div");
    metric.className = `metric${tone ? ` metric--${tone}` : ""}`;
    const caption = global.document.createElement("span");
    caption.textContent = String(label ?? "");
    if (tooltip) {
      const help = global.document.createElement("span");
      help.className = "tooltip";
      help.tabIndex = 0;
      help.setAttribute("role", "note");
      help.setAttribute("aria-label", tooltip);
      help.dataset.tooltip = tooltip;
      help.textContent = "?";
      caption.append(" ", help);
    }
    const result = global.document.createElement("strong");
    result.textContent = String(value ?? "");
    metric.append(caption, result);
    if (actions.length) {
      const controls = global.document.createElement("div");
      controls.className = "metric-actions";
      actions.forEach((action) => {
        const button = global.document.createElement("button");
        button.type = "button";
        button.className = `metric-action${action.kind ? ` metric-action--${action.kind}` : ""}`;
        button.dataset.summaryAction = action.action;
        button.title = action.label;
        button.setAttribute("aria-label", action.label);
        button.textContent = action.text;
        button.disabled = action.disabled === true;
        controls.append(button);
      });
      metric.append(controls);
    }
    fragment.append(metric);
  });
  container.replaceChildren(fragment);
}

function wholeWatts(value) {
  return wholeNumber(value);
}

// Shared sticky-toolbar behavior keeps the compact parameter controls identical
// across both tools and avoids page-specific scroll handlers drifting apart.
function attachStickyActions(element, top = 8) {
  if (!element) return () => {};
  const update = () => element.classList.toggle("is-sticky", element.classList.contains("is-section-pinned") && element.getBoundingClientRect().top <= top);
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  element.addEventListener("sectionpinchange", update);
  update();
  return () => {
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
    element.removeEventListener("sectionpinchange", update);
  };
}

// Bookmark links restore a location after reload. Sticky toggles are a separate
// control because pinning changes layout behavior and should be reversible.
function attachSectionPins(root = global.document) {
  root.querySelectorAll("[data-sticky-target]").forEach((button) => {
    if (button.dataset.stickyBound) return;
    button.dataset.stickyBound = "true";
    const targetId = button.dataset.stickyTarget;
    const target = button.closest(`[id="${targetId}"]`) || global.document.getElementById(targetId);
    if (!target) return;
    const persistent = button.dataset.stickyPersist !== "false";
    const storageKey = `velo-sticky:${global.location.pathname}:${target.id}`;
    const stored = persistent ? global.localStorage.getItem(storageKey) : null;
    let pinned = stored == null ? button.dataset.stickyDefault === "true" : stored === "true";
    const dockTarget = target.id !== "parameter-actions";
    const dock = dockTarget ? getPinnedSectionDock() : null;
    const actionGroup = button.closest(".section-actions, .target-actions");
    // Fullscreen is intentionally reserved for workspaces that materially
    // benefit from the extra canvas. Ordinary form sections remain pinnable
    // without accumulating another window-management control.
    const fullscreenAllowed = target.id === "stem-dashboard-panel";
    const fullscreenButton = dockTarget && actionGroup && fullscreenAllowed ? ensureWindowAction(actionGroup, button, "section-fullscreen-toggle", "Fullscreen section", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>', "before") : null;
    const minimizeButton = dockTarget && actionGroup ? ensureWindowAction(actionGroup, button, "pinned-minimize-toggle", "Minimize pinned section", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>', "end") : null;
    const originalParent = target.parentNode;
    const originalNextSibling = target.nextSibling;
    let originMarker = null;
    let taskbar = null;
    const syncWindowActions = () => {
      const fullscreen = target.classList.contains("is-section-fullscreen");
      const minimized = target.classList.contains("is-floating-minimized");
      if (fullscreenButton) {
        fullscreenButton.classList.toggle("is-active", fullscreen);
        fullscreenButton.title = fullscreen ? "Restore section size" : "Fullscreen section";
        fullscreenButton.setAttribute("aria-label", fullscreenButton.title);
        fullscreenButton.innerHTML = fullscreen
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v6H3M15 3v6h6M21 15h-6v6M3 15h6v6"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';
      }
      if (minimizeButton) {
        minimizeButton.classList.toggle("is-window-active", pinned && target.classList.contains("is-floating-card"));
        minimizeButton.classList.toggle("is-active", minimized);
        minimizeButton.title = minimized ? "Restore pinned section" : "Minimize pinned section";
        minimizeButton.setAttribute("aria-label", minimizeButton.title);
        minimizeButton.innerHTML = minimized
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
      }
    };
    const setMinimized = (minimized) => {
      if (!pinned || !dockTarget) return;
      if (minimized && !target.classList.contains("is-floating-minimized")) {
        target.dataset.preMinimizeGeometry = JSON.stringify({
          custom: target.classList.contains("is-floating-custom"),
          left: target.style.left,
          top: target.style.top,
          width: target.style.width,
          height: target.style.height,
        });
      }
      target.classList.toggle("is-floating-minimized", minimized);
      if (minimized) target.classList.remove("is-section-fullscreen");
      else {
        try {
          const geometry = JSON.parse(target.dataset.preMinimizeGeometry || "null");
          if (geometry?.custom) {
            target.classList.add("is-floating-custom");
            for (const key of ["left", "top", "width", "height"]) {
              if (geometry[key]) target.style[key] = geometry[key];
              else target.style.removeProperty(key);
            }
          } else {
            target.classList.remove("is-floating-custom");
            for (const key of ["left", "top", "width", "height"]) target.style.removeProperty(key);
          }
        } catch { /* A stale taskbar snapshot should not prevent restoration. */ }
        delete target.dataset.preMinimizeGeometry;
      }
      if (target.matches("details")) target.open = true;
      dock.appendChild(target);
      syncWindowActions();
      arrangeFloatingCards(dock);
      target.dispatchEvent(new CustomEvent("sectionfullscreenchange", { detail: { fullscreen: false, minimized } }));
    };
    const setFullscreen = (fullscreen) => {
      if (!dockTarget) return;
      if (fullscreen && target.matches("details") && target.dataset.preFullscreenOpen == null) {
        target.dataset.preFullscreenOpen = String(target.open);
        target.open = true;
      }
      target.classList.toggle("is-section-fullscreen", fullscreen);
      if (fullscreen) target.classList.remove("is-floating-minimized");
      else if (target.matches("details") && target.dataset.preFullscreenOpen === "false") target.open = false;
      if (!fullscreen) delete target.dataset.preFullscreenOpen;
      syncWindowActions();
      if (pinned) arrangeFloatingCards(dock);
      target.dispatchEvent(new CustomEvent("sectionfullscreenchange", { detail: { fullscreen, minimized: false } }));
    };
    const ensureTaskbar = () => {
      taskbar = target.querySelector(":scope > .pinned-taskbar");
      if (taskbar) return;
      const heading = target.querySelector(":scope > .section-title .section-heading h2, :scope > summary.section-title .section-heading h2")
        || target.querySelector(".section-title .section-heading h2, summary.section-title .section-heading h2");
      const titleField = target.classList.contains("target-row") ? target.querySelector(':scope [data-key="label"]') : null;
      const fallbackHeading = target.querySelector(":scope > .section-title .section-heading > span, :scope > summary.section-title .section-heading > span")
        || target.querySelector(".section-title .section-heading > span, summary.section-title .section-heading > span");
      const title = heading?.textContent?.trim() || titleField?.value || fallbackHeading?.textContent?.trim() || "Pinned section";
      taskbar = global.document.createElement("div");
      taskbar.className = "pinned-taskbar";
      taskbar.tabIndex = 0;
      taskbar.setAttribute("role", "button");
      taskbar.setAttribute("aria-label", `Restore ${title}`);
      taskbar.innerHTML = `<strong>${escapeMarkup(title)}</strong><span><button type="button" class="pinned-taskbar-unpin" title="Unpin section" aria-label="Unpin section"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/><path d="M12 14v7"/></svg></button></span>`;
      taskbar.addEventListener("click", (event) => {
        if (event.target.closest(".pinned-taskbar-unpin")) return;
        setMinimized(false);
      });
      taskbar.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setMinimized(false);
      });
      taskbar.querySelector(".pinned-taskbar-unpin").addEventListener("click", (event) => {
        event.stopPropagation();
        button.click();
      });
      target.appendChild(taskbar);
    };
    const placeInDock = () => {
      const existing = [...dock.children].find((item) => item.id === target.id && item !== target);
      const wasMinimized = existing?.classList.contains("is-floating-minimized");
      const wasFullscreen = existing?.classList.contains("is-section-fullscreen");
      const preMinimizeGeometry = existing?.dataset.preMinimizeGeometry;
      existing?.remove();
      if (!originMarker?.isConnected) {
        originMarker = global.document.createComment(`Pinned section origin: ${target.id}`);
        target.before(originMarker);
      }
      if (target.matches("details") && target.dataset.pinnedOriginalOpen == null) target.dataset.pinnedOriginalOpen = String(target.open);
      if (target.matches("details") && !target.open) {
        target.open = true;
        target.classList.add("is-floating-minimized");
      }
      if (wasMinimized) target.classList.add("is-floating-minimized");
      if (wasFullscreen) target.classList.add("is-section-fullscreen");
      if (preMinimizeGeometry) target.dataset.preMinimizeGeometry = preMinimizeGeometry;
      dock.appendChild(target);
      dock.hidden = false;
      ensureTaskbar();
      attachFloatingCard(target, dock);
      syncWindowActions();
      arrangeFloatingCards(dock);
    };
    const restoreFromDock = () => {
      const minimized = target.classList.contains("is-floating-minimized");
      target.classList.remove("is-floating-minimized", "is-section-fullscreen", "is-first-minimized");
      detachFloatingCard(target);
      target.querySelector(":scope > .pinned-taskbar")?.remove();
      if (originMarker?.isConnected) originMarker.replaceWith(target);
      else if (originalParent?.isConnected) originalParent.insertBefore(target, originalNextSibling?.isConnected ? originalNextSibling : null);
      if (target.matches("details") && (target.dataset.pinnedOriginalOpen === "false" || minimized)) target.open = false;
      delete target.dataset.pinnedOriginalOpen;
      arrangeFloatingCards(dock);
      dock.hidden = !dock.children.length;
      syncWindowActions();
    };
    const render = () => {
      target.classList.toggle("is-section-pinned", pinned);
      button.classList.toggle("is-active", pinned);
      button.setAttribute("aria-pressed", String(pinned));
      button.title = button.dataset.stickyLabel
        ? `${pinned ? "Unpin" : "Pin"} ${button.dataset.stickyLabel}`
        : pinned ? "Unpin while scrolling" : "Pin while scrolling";
      button.setAttribute("aria-label", button.title);
      if (dockTarget) pinned ? placeInDock() : restoreFromDock();
      target.dispatchEvent(new CustomEvent("sectionpinchange"));
    };
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pinned = !pinned;
      if (persistent) global.localStorage.setItem(storageKey, String(pinned));
      render();
    });
    const bindWindowAction = (control, action) => {
      if (!control) return;
      control.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      }, true);
      control.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        action();
      }, true);
    };
    bindWindowAction(minimizeButton, () => setMinimized(!target.classList.contains("is-floating-minimized")));
    bindWindowAction(fullscreenButton, () => setFullscreen(!target.classList.contains("is-section-fullscreen")));
    if (fullscreenButton) {
      global.document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && target.classList.contains("is-section-fullscreen")) setFullscreen(false);
      });
    }
    render();
  });
}

function ensureWindowAction(group, pinButton, className, label, icon, position = "before") {
  let control = group.querySelector(`.${className}`);
  if (control) return control;
  control = global.document.createElement("button");
  control.type = "button";
  control.className = `icon-button ${className}`;
  control.title = label;
  control.setAttribute("aria-label", label);
  control.innerHTML = icon;
  if (position === "end") group.appendChild(control);
  else if (position === "after") pinButton.insertAdjacentElement("afterend", control);
  else group.insertBefore(control, pinButton);
  return control;
}

function escapeMarkup(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function getPinnedSectionDock() {
  let dock = global.document.querySelector(".pinned-section-dock");
  if (dock) return dock;
  dock = global.document.createElement("aside");
  dock.className = "pinned-section-dock";
  dock.setAttribute("aria-label", "Pinned sections");
  dock.hidden = true;
  global.document.body.appendChild(dock);
  global.addEventListener("resize", () => arrangeFloatingCards(dock), { passive: true });
  return dock;
}

function floatingGeometryKey(target) {
  return `velo-floating:${global.location.pathname}:${target.id}`;
}

function readFloatingGeometry(target) {
  try { return JSON.parse(global.localStorage.getItem(floatingGeometryKey(target)) || "null"); }
  catch { return null; }
}

function saveFloatingGeometry(target) {
  if (!target.classList.contains("is-floating-custom")) return;
  global.localStorage.setItem(floatingGeometryKey(target), JSON.stringify({
    left: parseFloat(target.style.left) || 0,
    top: parseFloat(target.style.top) || 0,
    width: parseFloat(target.style.width) || target.offsetWidth,
    height: parseFloat(target.style.height) || target.offsetHeight,
  }));
}

function isCompactFloatingLayout() {
  return global.matchMedia("(max-width: 640px)").matches;
}

function attachFloatingCard(target, dock) {
  target.classList.add("is-floating-card");
  const saved = readFloatingGeometry(target);
  if (saved) {
    target.classList.add("is-floating-custom");
    target.style.left = `${saved.left}px`;
    target.style.top = `${saved.top}px`;
    target.style.width = `${saved.width}px`;
    target.style.height = `${saved.height}px`;
    const targetRect = target.getBoundingClientRect();
    const conflicts = [...dock.children].some((card) => {
      if (card === target || !card.classList.contains("is-section-pinned")) return false;
      const cardRect = card.getBoundingClientRect();
      return targetRect.left < cardRect.right && targetRect.right > cardRect.left && targetRect.top < cardRect.bottom && targetRect.bottom > cardRect.top;
    });
    if (conflicts) {
      target.classList.remove("is-floating-custom");
      target.style.removeProperty("left");
      target.style.removeProperty("top");
      target.style.removeProperty("width");
      target.style.removeProperty("height");
      global.localStorage.removeItem(floatingGeometryKey(target));
    }
  }

  let resizeHandle = target.querySelector(":scope > .pinned-resize-handle");
  if (!resizeHandle) {
    resizeHandle = global.document.createElement("button");
    resizeHandle.type = "button";
    resizeHandle.className = "pinned-resize-handle";
    resizeHandle.title = "Resize pinned section";
    resizeHandle.setAttribute("aria-label", "Resize pinned section");
    resizeHandle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19h10V9M13 15l6-6M5 19 19 5"/></svg>';
    target.appendChild(resizeHandle);
  }

  const dragHandle = target.querySelector(":scope > .section-title, :scope > summary.section-title, :scope > .drag-handle") || target.querySelector(".section-title, .drag-handle");
  if (dragHandle && !dragHandle.dataset.floatingDragBound) {
    dragHandle.dataset.floatingDragBound = "true";
    dragHandle.classList.add("floating-card-drag-handle");
    dragHandle.addEventListener("mousedown", (event) => {
      if (!target.classList.contains("is-floating-card") || target.classList.contains("is-floating-minimized") || target.classList.contains("is-section-fullscreen") || isCompactFloatingLayout() || event.button !== 0 || event.target.closest("button, a, input, select, label, .section-actions")) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = target.offsetLeft;
      const startTop = target.offsetTop;
      let moved = false;
      const move = (moveEvent) => {
        const nextLeft = Math.min(Math.max(0, startLeft + moveEvent.clientX - startX), Math.max(0, dock.clientWidth - target.offsetWidth));
        const nextTop = Math.min(Math.max(0, startTop + moveEvent.clientY - startY), Math.max(0, dock.clientHeight - Math.min(target.offsetHeight, dock.clientHeight)));
        moved ||= Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3;
        target.style.left = `${nextLeft}px`;
        target.style.top = `${nextTop}px`;
      };
      const finish = () => {
        global.removeEventListener("mousemove", move);
        global.removeEventListener("mouseup", finish);
        if (moved) {
          target.classList.add("is-floating-custom");
          target.dataset.justDragged = "true";
          global.setTimeout(() => delete target.dataset.justDragged, 0);
          saveFloatingGeometry(target);
        }
      };
      global.addEventListener("mousemove", move);
      global.addEventListener("mouseup", finish);
    });
    dragHandle.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, label, .section-actions")) return;
      if (target.dataset.justDragged || (target.classList.contains("is-floating-card") && dragHandle.matches("summary"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
  }

  if (!resizeHandle.dataset.floatingResizeBound) {
    resizeHandle.dataset.floatingResizeBound = "true";
    resizeHandle.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); });
    resizeHandle.addEventListener("mousedown", (event) => {
      if (!target.classList.contains("is-floating-card") || target.classList.contains("is-floating-minimized") || target.classList.contains("is-section-fullscreen") || !isCompactFloatingLayout() || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const startHeight = target.offsetHeight;
      const move = (moveEvent) => {
        target.style.setProperty("--mobile-card-height", `${Math.min(Math.max(80, startHeight + moveEvent.clientY - startY), Math.max(80, global.innerHeight - 76))}px`);
      };
      const finish = () => {
        global.removeEventListener("mousemove", move);
        global.removeEventListener("mouseup", finish);
      };
      global.addEventListener("mousemove", move);
      global.addEventListener("mouseup", finish);
    });
  }

  // Desktop cards resize directly from their border. The visible corner handle is
  // reserved for compact layouts where a fine border target is difficult to use.
  if (!target.dataset.floatingEdgeResizeBound) {
    target.dataset.floatingEdgeResizeBound = "true";
    const edgeAt = (event) => {
      if (isCompactFloatingLayout() || target.classList.contains("is-floating-minimized") || target.classList.contains("is-section-fullscreen")) return null;
      const rect = target.getBoundingClientRect();
      const edge = 7;
      return {
        left: event.clientX - rect.left <= edge,
        right: rect.right - event.clientX <= edge,
        top: event.clientY - rect.top <= edge,
        bottom: rect.bottom - event.clientY <= edge,
      };
    };
    target.addEventListener("mousemove", (event) => {
      if (event.buttons) return;
      const edges = edgeAt(event);
      target.style.cursor = !edges ? "" : (edges.left && edges.top) || (edges.right && edges.bottom) ? "nwse-resize" : (edges.right && edges.top) || (edges.left && edges.bottom) ? "nesw-resize" : edges.left || edges.right ? "ew-resize" : edges.top || edges.bottom ? "ns-resize" : "";
    });
    target.addEventListener("mouseleave", () => { if (!target.dataset.isEdgeResizing) target.style.cursor = ""; });
    target.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const edges = edgeAt(event);
      if (!edges || !Object.values(edges).some(Boolean)) return;
      event.preventDefault();
      event.stopPropagation();
      target.dataset.isEdgeResizing = "true";
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = target.offsetLeft;
      const startTop = target.offsetTop;
      const startWidth = target.offsetWidth;
      const startHeight = target.offsetHeight;
      const startRight = startLeft + startWidth;
      const startBottom = startTop + startHeight;
      const move = (moveEvent) => {
        target.classList.add("is-floating-custom");
        let left = startLeft;
        let top = startTop;
        let width = startWidth;
        let height = startHeight;
        if (edges.left) {
          left = Math.max(0, Math.min(startRight - 360, startLeft + moveEvent.clientX - startX));
          width = startRight - left;
        }
        if (edges.right) width = Math.min(Math.max(360, startWidth + moveEvent.clientX - startX), dock.clientWidth - startLeft);
        if (edges.top) {
          top = Math.max(0, Math.min(startBottom - 120, startTop + moveEvent.clientY - startY));
          height = startBottom - top;
        }
        if (edges.bottom) height = Math.min(Math.max(120, startHeight + moveEvent.clientY - startY), dock.clientHeight - startTop);
        target.style.left = `${left}px`;
        target.style.top = `${top}px`;
        target.style.width = `${width}px`;
        target.style.height = `${height}px`;
      };
      const finish = () => {
        delete target.dataset.isEdgeResizing;
        target.style.cursor = "";
        global.removeEventListener("mousemove", move);
        global.removeEventListener("mouseup", finish);
        saveFloatingGeometry(target);
      };
      global.addEventListener("mousemove", move);
      global.addEventListener("mouseup", finish);
    }, true);
  }
}

function detachFloatingCard(target) {
  target.classList.remove("is-floating-card", "is-floating-custom");
  target.style.removeProperty("left");
  target.style.removeProperty("top");
  target.style.removeProperty("width");
  target.style.removeProperty("height");
  target.style.removeProperty("--mobile-card-height");
  target.style.removeProperty("--taskbar-left");
  target.style.removeProperty("--taskbar-width");
  target.querySelector(":scope > .pinned-resize-handle")?.remove();
}

function arrangeFloatingCards(dock) {
  if (!dock || dock.hidden) return;
  const allCards = [...dock.children].filter((card) => card.classList.contains("is-section-pinned"));
  const minimizedCards = allCards.filter((card) => card.classList.contains("is-floating-minimized"));
  const compact = isCompactFloatingLayout();
  const gap = compact ? 6 : 10;
  const occupied = [];
  const availableTaskbarWidth = compact ? global.innerWidth - gap * 2 : dock.clientWidth - gap * 2;
  const taskbarWidth = minimizedCards.length
    ? Math.max(1, Math.min(280, (availableTaskbarWidth - gap * (minimizedCards.length - 1)) / minimizedCards.length))
    : 0;
  minimizedCards.forEach((card, index) => {
    const left = gap + index * (taskbarWidth + gap);
    card.style.setProperty("--taskbar-left", `${left}px`);
    card.style.setProperty("--taskbar-width", `${taskbarWidth}px`);
    card.style.width = `${taskbarWidth}px`;
    card.style.height = "auto";
    const height = card.offsetHeight;
    if (!compact) {
      card.style.left = `${left}px`;
      card.style.top = `${Math.max(gap, dock.clientHeight - height - gap)}px`;
      occupied.push({ left, top: dock.clientHeight - height - gap, right: left + taskbarWidth, bottom: dock.clientHeight - gap });
    }
  });
  if (compact) return;
  const cards = allCards.filter((card) => !card.classList.contains("is-floating-minimized") && !card.classList.contains("is-section-fullscreen") && !card.classList.contains("is-floating-custom"));
  const defaultWidth = Math.min(400, Math.max(300, dock.clientWidth - gap * 2));
  occupied.push(...allCards
    .filter((card) => card.classList.contains("is-floating-custom") && !card.classList.contains("is-floating-minimized") && !card.classList.contains("is-section-fullscreen"))
    .map((card) => ({ left: card.offsetLeft, top: card.offsetTop, right: card.offsetLeft + card.offsetWidth, bottom: card.offsetTop + card.offsetHeight })));
  const overlaps = (candidate) => occupied.some((rect) => candidate.left < rect.right + gap && candidate.right + gap > rect.left && candidate.top < rect.bottom + gap && candidate.bottom + gap > rect.top);
  cards.forEach((card) => {
    card.style.width = `${defaultWidth}px`;
    card.style.height = "auto";
    const width = card.offsetWidth;
    const height = Math.min(card.offsetHeight, dock.clientHeight - gap * 2);
    let position = null;
    for (let top = gap; top <= Math.max(gap, dock.clientHeight - height - gap) && !position; top += 20) {
      for (let left = dock.clientWidth - width - gap; left >= gap; left -= 20) {
        const candidate = { left, top, right: left + width, bottom: top + height };
        if (!overlaps(candidate)) { position = candidate; break; }
      }
    }
    position ||= { left: gap, top: gap, right: gap + width, bottom: gap + height };
    card.style.left = `${position.left}px`;
    card.style.top = `${position.top}px`;
    occupied.push(position);
  });
}

function copyText(text) {
  const input = global.document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  global.document.body.appendChild(input);
  input.select();
  const copied = global.document.execCommand("copy");
  input.remove();
  if (copied) return true;
  if (global.navigator.clipboard?.writeText) {
    global.navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  return false;
}

// Section links copy a reloadable deep link without changing the current hash
// or moving the viewport. Opening the copied URL still restores the section.
function attachSectionLinks(root = global.document) {
  root.querySelectorAll("[data-section-link]").forEach((button) => {
    if (button.dataset.sectionLinkBound) return;
    button.dataset.sectionLinkBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const url = new URL(global.location.href);
      url.hash = button.dataset.sectionLink;
      if (copyText(url.href)) {
        const label = button.title.replace(/^Copy link to /, "");
        const original = button.title;
        button.title = "Link copied";
        button.setAttribute("aria-label", "Link copied");
        button.classList.add("is-copied");
        const status = global.document.querySelector("#status");
        if (status) setStatus(status, `Copied link to ${label}.`);
        setTimeout(() => {
          button.title = original;
          button.setAttribute("aria-label", original);
          button.classList.remove("is-copied");
        }, 1500);
      } else {
        button.title = "Unable to copy link";
      }
    });
  });
}

function attachToolSidebar(currentTool) {
  if (global.document.querySelector(".tool-sidebar")) return;
  const labels = { power: "Power Master", fuel: "Fuel Master" };
  const icons = {
    home: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8v10h-6v-6H9v6H3V11Z"/></svg>`,
    power: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 5 14h6l-1 8 9-13h-6V2Z"/></svg>`,
    fuel: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Z"/></svg>`,
  };
  const sidebar = global.document.createElement("nav");
  sidebar.className = "tool-sidebar is-collapsed";
  sidebar.setAttribute("aria-label", "Velo tools");
  sidebar.innerHTML = `
    <button class="tool-sidebar-toggle" type="button" aria-expanded="false" title="Open tool navigation" aria-label="Open tool navigation"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>
    <div class="tool-sidebar-links">
      <a href="./index.html" title="Home">${icons.home}<span>Home</span></a>
      <a href="./power-master.html" title="Power Master" ${currentTool === "power" ? 'class="is-current" aria-current="page"' : ""}>${icons.power}<span>${labels.power}</span></a>
      <a href="./fuel-master.html" title="Fuel Master" ${currentTool === "fuel" ? 'class="is-current" aria-current="page"' : ""}>${icons.fuel}<span>${labels.fuel}</span></a>
    </div>`;
  const toggle = sidebar.querySelector(".tool-sidebar-toggle");
  const storageKey = `velo-sidebar:${global.location.pathname}`;
  const toggleExpanded = () => {
    const expanded = sidebar.classList.toggle("is-expanded");
    sidebar.classList.toggle("is-collapsed", !expanded);
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.title = expanded ? "Close tool navigation" : "Open tool navigation";
    toggle.setAttribute("aria-label", toggle.title);
  };
  toggle.addEventListener("click", () => {
    if (sidebar.dataset.justDragged) return;
    toggleExpanded();
  });
  global.document.body.appendChild(sidebar);

  // The compact desktop rail can be parked near the current work area. Mobile
  // intentionally uses a fixed horizontal control strip instead.
  try {
    const saved = JSON.parse(global.localStorage.getItem(storageKey) || "null");
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top) && !global.matchMedia("(max-width: 640px)").matches) {
      sidebar.style.left = `${Math.max(0, Math.min(saved.left, global.innerWidth - sidebar.offsetWidth))}px`;
      sidebar.style.top = `${Math.max(0, Math.min(saved.top, global.innerHeight - sidebar.offsetHeight))}px`;
    }
  } catch { global.localStorage.removeItem(storageKey); }

  toggle.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || global.matchMedia("(max-width: 640px)").matches) return;
    const rect = sidebar.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      moved ||= Math.abs(dx) > 3 || Math.abs(dy) > 3;
      if (!moved) return;
      sidebar.style.left = `${Math.max(0, Math.min(rect.left + dx, global.innerWidth - sidebar.offsetWidth))}px`;
      sidebar.style.top = `${Math.max(0, Math.min(rect.top + dy, global.innerHeight - sidebar.offsetHeight))}px`;
    };
    const finish = () => {
      global.removeEventListener("mousemove", move);
      global.removeEventListener("mouseup", finish);
      if (!moved) return;
      sidebar.dataset.justDragged = "true";
      global.localStorage.setItem(storageKey, JSON.stringify({ left: sidebar.offsetLeft, top: sidebar.offsetTop }));
      global.setTimeout(() => delete sidebar.dataset.justDragged, 0);
    };
    global.addEventListener("mousemove", move);
    global.addEventListener("mouseup", finish);
  });
}

// Copied section links may include a hash; this one-time restoration handles
// planning sections rendered by JavaScript after the initial HTML is parsed.
function restoreSectionAnchor() {
  if (!global.location.hash) return;
  requestAnimationFrame(() => {
    const id = decodeURIComponent(global.location.hash.slice(1));
    global.document.getElementById(id)?.scrollIntoView({ block: "start" });
  });
}

// Actions placed inside a native details summary should run without also
// toggling the surrounding section. Links retain their normal hash behavior.
function protectSummaryActions(root = global.document) {
  root.querySelectorAll("summary .section-actions").forEach((actions) => {
    if (actions.dataset.summaryActionsBound) return;
    actions.dataset.summaryActionsBound = "true";
    actions.querySelectorAll("button, a").forEach((control) => control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (control.matches('a[href^="#"]:not([data-section-link])')) global.location.hash = control.hash;
    }));
  });
}

global.VeloApp = { attachSectionLinks, attachSectionPins, attachStickyActions, attachToolSidebar, createPlanStore, createStateStore, readJsonFile, downloadFile, downloadJson, renderSummaryFields, setStatus, wholeWatts, restoreSectionAnchor, protectSummaryActions };
})(globalThis);
