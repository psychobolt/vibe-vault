# Velo Tools

A small browser-based cycling planning project built around two related tools:

- **Power Master** creates condition-specific pacing targets and a printable stem dashboard.
- **Fuel Master** combines a ride plan with athlete, route, and nutrition inputs to build a fueling strategy.

The tools are designed to share the same athlete and ride-planning model while keeping their specialized interfaces separate.

- [Power Master](https://psychobolt.github.io/vibe-vault/power-master.html)
- [Fuel Master](https://psychobolt.github.io/vibe-vault/fuel-master.html)

## Project structure

```text
velo-tools/
├── app.js                 # Shared initialization and persistence helpers
├── activity-parser.js     # Shared GPX/TCX route parsing
├── planning-model.js      # Shared schemas, calculations, profiles, and unit conversions
├── planning-ui.js         # Shared planning fields, validation, locking, and file controls
├── styles.css             # Shared design tokens and base controls
├── tool-shell.css         # Shared compact tool layout and responsive components
├── power-master.css       # Power-target editor and dashboard-specific styling
├── fuel-master.css        # Fueling, inventory, recipe, and summary styling
├── power-master.html      # Power planning and stem-dashboard interface
├── fuel-master.html       # Fueling calculator and recipe interface
├── legacy/                # Original pre-refactor HTML sources kept for reference
│   ├── power-master.html
│   └── fuel-master.html
└── README.md
```

Power Master owns detailed pacing targets. When its parameters are loaded into Fuel Master, the shared planning fields can be displayed as read-only and Fuel Master can focus on fueling calculations.

Power Master starts with the established seven condition targets and can add or replace them with duration-scaled profile templates. Target text and background colors are preserved in saved plans and the dashboard preview.

## Run locally

The shared JavaScript is delivered as classic browser scripts, so either HTML file can be opened directly. A local server is still convenient during development:

```bash
python3 -m http.server 8000 --directory velo-tools
```

Then open `http://localhost:8000/power-master.html` or `http://localhost:8000/fuel-master.html`.
