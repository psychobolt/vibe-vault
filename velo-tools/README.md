# Velo Tools

<p align="center"><img src="./icons/velo-tools.svg" width="144" alt="Velo Tools aero road bicycle logo"></p>

A small browser-based cycling planning project built around two related tools:

- **[Power Master](https://psychobolt.github.io/vibe-vault/velo-tools/power-master.html)** creates condition-specific pacing targets and a printable stem dashboard.
- **[Fuel Master](https://psychobolt.github.io/vibe-vault/velo-tools/fuel-master.html)** combines a ride plan with athlete, route, and nutrition inputs to build a fueling strategy.
- **Conditions Master** will analyze weather, wind, surface, and route conditions before power planning.

The tools are designed to share the same athlete and ride-planning model while keeping their specialized interfaces separate. Open `index.html` to choose a tool.

## Screenshots

### Power Master

<p><img src="./screenshots/power-master-desktop.jpg" width="68%" alt="Power Master desktop workspace"><img src="./screenshots/power-master-mobile.jpg" width="24%" alt="Power Master mobile workspace"></p>

### Fuel Master

<p><img src="./screenshots/fuel-master-desktop.jpg" width="68%" alt="Fuel Master desktop workspace"><img src="./screenshots/fuel-master-mobile.jpg" width="24%" alt="Fuel Master mobile workspace"></p>

These maintained screenshots should be refreshed whenever a feature milestone is considered ready for review or release.

## Preview suggestions

- Add a real photograph of the printed Power Master dashboard taped to a bicycle stem so the physical scale and on-bike readability are clear.
- Support an interactive 3D preview using a traditional bicycle stem model. The user should be able to rotate the model, inspect the dashboard from riding and side angles, and confirm the selected stem width and dashboard length before printing.

## Project structure

```text
velo-tools/
├── scripts/
│   ├── app.js             # Shared observable stores, persistence, downloads, and status helpers
│   ├── activity-parser.js # Shared GPX/TCX route parsing
│   ├── planning-model.js  # Shared schemas, calculations, profiles, and plan normalization
│   ├── planning-ui.js     # Shared planning fields, validation, locking, and file controls
│   ├── power-master.js    # Power Master controller and dashboard rendering
│   ├── fuel-master.js     # Fuel Master controller, fueling logic, and recipe rendering
│   └── utils/
│       ├── math.js        # Pure rounding, conversion, clamping, and distance helpers
│       ├── functions.js   # General cloning and HTML-escaping helpers
│       └── model-config.js # Debug viewports and temporary math-model overrides
├── styles.css             # Shared design tokens and base controls
├── tool-shell.css         # Shared compact tool layout and responsive components
├── power-master.css       # Power-target editor and dashboard-specific styling
├── fuel-master.css        # Fueling, inventory, recipe, and summary styling
├── power-master.html      # Power planning and stem-dashboard interface
├── fuel-master.html       # Fueling calculator and recipe interface
├── index.html             # Landing page for choosing either tool
├── landing.css            # Landing-page presentation
├── icons/                 # Logos, bookmark icons, and scalable feature artwork
├── screenshots/           # Maintained desktop and mobile previews
└── README.md
```

Power Master owns detailed pacing targets. When its parameters are loaded into Fuel Master, the shared planning fields can be displayed as read-only and Fuel Master can focus on fueling calculations.

Power Master keeps its latest plan in local browser storage. Opening Fuel Master from Power Master's navigation can preload that plan into **Load Power Parameters** without moving a file; a JSON file remains available for portable or archived plans. Fuel Master's pinned **Fuel Parameters** toolbar is independent and only loads, saves, or resets fueling parameters.

Power Master starts with the established seven condition targets and can add or replace them with duration-scaled profile templates. Target text and background colors are preserved in saved plans and the dashboard preview.

Power Master's Plan Summary owns demand alignment because it compares the detailed target-row workload against combined aerobic, hard-effort, and sprint demand. The `−`, `+`, and recalculate adjustment controls appear only when the displayed alignment is outside ±0.9%. Fuel Master does not repeat Power Master's workload when detailed power parameters are loaded.

Manual and imported demand profiles are matched from the normalized aerobic, hard-effort, and sprint allocation rather than route terrain. This mirrors Xert's published Focus concept more closely, while remaining an approximation: Xert's athlete-specific Focus and its separate Pure/Mixed/Polar Specificity calculation are proprietary and are not reproduced by the summarized target rows.

Power-target dragging uses a pinned SortableJS CDN build for animated desktop reordering. The existing native drag implementation remains available as a fallback when the CDN cannot be reached, and compact layouts retain explicit up/down controls.

The controllers now live outside the HTML documents, and both shared planning state and Fuel Master's specialized settings use observable stores. This provides clean component boundaries for an incremental Alpine.js migration.

Suitable bounded numeric fields place a range slider beside precise number entry, following the Stem Dashboard control pattern. This includes planning inputs, fueling quantities, Profile Target duration, and Power Target watts and duration.

Fuel Master records the carbohydrate source of a commercial drink base separately from its serving size. Known sucrose, dextrose, maltodextrin, or 2:1 dual-source bases are included in the complete-bottle glucose/fructose calculation. Products that disclose ingredients but not their proportions, including the default sucrose-and-dextrose Gatorade base, retain an explicit unknown-ratio warning instead of claiming a precise blend.

Editable sections are collapsible. Their pin links set a stable URL hash so reloading the page returns to the selected section, while edit-history and reset actions stay hidden whenever a section is collapsed.

## Alpine.js migration

Migrating to Alpine.js remains a recommended next refactor, but it should be incremental rather than a wholesale rewrite. The calculation layer, schemas, storage helpers, and activity parser are already separated well enough to reuse unchanged.

The remaining blockers are UI lifecycle concerns:

- `renderPlanningUI()` and the two controllers still replace substantial DOM fragments with `innerHTML`, then manually attach event listeners again.
- State is split between observable stores and direct DOM reads for fueling inventory, dashboard appearance, file inputs, and exported recipe content.
- SortableJS and the pinned/floating section system move or recreate live DOM nodes, so Alpine component ownership and cleanup boundaries must be defined first.
- The classic global-script namespaces (`VeloPlanning`, `VeloApp`, and related globals) still rely on script order rather than ES module imports.
- Section-local undo/redo, loaded-file baselines, and Power-to-Fuel handoff need one documented state contract before becoming Alpine stores.

A safe migration order is:

1. Convert shared planning fields into one `Alpine.data("planningForm")` component without changing the math model.
2. Convert Power Target rows into an Alpine list and keep SortableJS behind an `x-init` adapter.
3. Convert Fuel inventory and recipe controls into a separate Alpine component.
4. Move pin/fullscreen behavior into an Alpine-aware utility that cleans up listeners when nodes move.
5. Replace the remaining global namespaces with ES modules after both pages no longer depend on imperative rerenders.

Until the first two steps are complete, adding Alpine.js would mostly wrap the existing imperative renderer and create two competing owners for the same DOM.

## Run locally

The shared JavaScript is delivered as classic browser scripts, so either HTML file can be opened directly. A local server is still convenient during development:

```bash
python3 -m http.server 8000 --directory velo-tools
```

Then open `http://localhost:8000/power-master.html` or `http://localhost:8000/fuel-master.html`.

## Debug profiles

Add `debug_profile` to either tool URL to show the **Config Parameters** JSON editor before the shared planning steps. The editor can add and temporarily override a named calculation model for the current browser session.

- `?debug_profile=0` keeps the normal viewport and opens the configuration editor.
- `?debug_profile=mobile1` renders the tool in a true 360 px iframe viewport.
- `?debug_profile=mobile2` renders the tool in a true 414 px iframe viewport.

Removing `debug_profile` disables both the editor and all stored debug overrides.

## License

[MIT licensed](./LICENSE). Copyright (c) 2026 psychobolt.
