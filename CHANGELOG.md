# Changelog

## 0.2.0 - 2026-11-04

- Store workspaces in IndexedDB, migrate older browser data and project schemas, and report storage failures while retaining JSON import and export.
- Model equipment, configurable interfaces, rack positions and connection endpoints explicitly.
- Check addressing, connectivity, rack occupancy, link compatibility, PoE and missing network information.
- Document pathways, risers and inter-floor routes, optional scale and estimated lengths, and human route reviews.
- Replace native prompts with application dialogs and show orientation and the illustrative angled view accurately.
- Split geometry, rendering and shared UI code into modules, consolidate rack styles, and retain legacy import migrations.
- Add unit and browser coverage, require tests before Pages deployment, and document architecture and limitations.
- Fix physical pathway and riser markers missing from the selected floor.
