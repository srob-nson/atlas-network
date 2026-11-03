# Projects, buildings and floors Implementation Plan

**Goal:** Support multiple local projects, buildings and floors with cross-floor connections.

**Architecture:** Store a workspace of projects, buildings and floor-local assets; store cables per project. Adapt the existing floor editor to the selected floor, preserving its existing interactions. Validate imports and migrate legacy data before use.

**Tech Stack:** Browser JavaScript, localStorage, Node tests.

**Spec:** `docs/superpowers/specs/2026-11-03-projects-buildings-floors-design.md`

1. Add model tests and validation for workspace migration, complete project round trips, invalid references and port occupancy.
2. Implement persistent hierarchy and selection controls, floor switching, and non-destructive creation and rename operations.
3. Connect across floors through equipment and rack interfaces; show endpoint indicators and locations, enforce port occupancy and preserve routes on same-floor connections.
4. Update backup/import and documentation. Run model and browser checks, including migration and switching; inspect changes for regressions.
