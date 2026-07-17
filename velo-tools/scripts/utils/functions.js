// General-purpose non-math helpers shared across both browser tools.
(function (global) {
"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

// Adds a synchronized range control beside bounded number inputs without
// taking ownership of their existing input/change handlers.
function enhanceNumberSliders(root = document) {
  root.querySelectorAll('input[type="number"][data-slider-max]').forEach((numberInput) => {
    let row = numberInput.parentElement?.classList.contains("number-slider-row") ? numberInput.parentElement : null;
    let slider = row?.querySelector(".number-slider") || null;
    if (!row) {
      row = document.createElement("div");
      row.className = "number-slider-row";
      numberInput.parentElement.insertBefore(row, numberInput);
      row.appendChild(numberInput);
    }
    if (!slider) {
      slider = document.createElement("input");
      slider.type = "range";
      slider.className = "number-slider";
      if (numberInput.classList.contains("demand-low")) slider.classList.add("number-slider--aerobic");
      if (numberInput.classList.contains("demand-high")) slider.classList.add("number-slider--hard");
      if (numberInput.classList.contains("demand-peak")) slider.classList.add("number-slider--sprint");
      slider.setAttribute("aria-label", `${numberInput.getAttribute("aria-label") || numberInput.closest("label")?.querySelector(".field-label")?.textContent?.trim() || "Number"} slider`);
      row.insertBefore(slider, numberInput);
      slider.addEventListener("input", () => {
        numberInput.value = slider.value;
        numberInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      slider.addEventListener("change", () => numberInput.dispatchEvent(new Event("change", { bubbles: true })));
      numberInput.addEventListener("input", () => {
        const numericValue = Number(numberInput.value);
        if (Number.isFinite(numericValue) && numericValue > Number(slider.max)) slider.max = String(numericValue);
        slider.value = numberInput.value;
      });
    }
    slider.min = numberInput.dataset.sliderMin || numberInput.min || "0";
    slider.max = String(Math.max(Number(numberInput.dataset.sliderMax) || 0, Number(numberInput.value) || 0));
    slider.step = numberInput.dataset.sliderStep || numberInput.step || "1";
    slider.value = numberInput.value;
    slider.disabled = numberInput.disabled;
  });
}

global.VeloUtils = { clone, escapeHtml, enhanceNumberSliders };
})(globalThis);
