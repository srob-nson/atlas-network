# Canvas Navigation and Cable Routing Implementation Plan

> **For implementation:** Work through the tasks in order, using the existing browser-local application. Obtain the user's permission before committing or pushing.

**Goal:** Make the floor plan easy to navigate and let users shape cables by moving fixed points on a visible dot grid.

**Architecture:** Keep the existing SVG scene, floor-plan coordinates and browser-local project. Add temporary view pan/zoom state and store an ordered list of floor-plan waypoints per cable; project the same route into both views. Separate navigation gestures from equipment, zone and cable editing so existing interactions continue to work.

**Tech stack:** Vanilla JavaScript, SVG, CSS, localStorage, JSON, Node's built-in test runner and the existing Chrome DevTools browser test.

## Scope and proposed interaction

- Zoom using the wheel or trackpad over the interactive area, centered on the pointer. Pinch zoom around the midpoint on touch devices. Keep the existing buttons, rotation and reset; reset returns zoom, pan and rotation to their initial values. Page scrolling outside the interactive area stays normal.
- Press and drag empty scene space to move the plan with the pointer. A short click retains existing zone selection behavior. Equipment dragging, placing equipment, drawing zones and connecting devices take precedence over panning. Constrain neither pan nor zoom to a fixed viewport edge; reset always recovers the plan.
- Select a cable directly on the plan or from the connections list. Show a subtle, evenly spaced dot grid anchored to floor-plan coordinates, not to the screen, and make the selected route and its control points clear. Dot spacing is 5 floor-plan units (a 21 × 21 grid across the 0–100 plan).
- Drag an existing control point onto a grid dot; it stays fixed there until moved or removed. Add a point by clicking a segment, inserting the snapped point between that segment's existing neighbours; dragging the new point immediately is also supported. Provide a visible remove action for a selected point and a reset-to-automatic-route action for the cable. A click without a drag must not accidentally move a point.
- Every cable segment is horizontal or vertical in floor-plan coordinates. Between consecutive fixed points, draw a deterministic elbow through `(next.x, previous.y)` when both coordinates differ; omit zero-length segments. These generated elbows are not fixed control points. Project the resulting orthogonal route into both views; a projected 3D segment may appear diagonal on screen. Equipment endpoints can be off-grid and remain attached to equipment, with the same elbow rule connecting them to the nearest fixed control point.
- The cable endpoints follow their equipment; manually placed intermediate points remain at their floor-plan positions when equipment moves. A route without manual points uses today's automatic elbow. Route edits appear in both plan and 3D views, persist locally, survive JSON export/import and appear in SVG export. Editor dots and handles do not appear in SVG exports.
- Make cable selection and point editing operable by keyboard as well as pointer: focus/select a cable; focus a point and use arrow keys to move one grid step, Delete/Backspace to remove it, and Escape to cancel an active edit. Provide labelled controls and visible focus. The user can add a point through a labelled control and select its grid location with the keyboard.
- View position is temporary. Cabinet views, rack assignments, ports, engineering cable lengths and automatic obstacle avoidance are outside this plan. Preserve the existing untracked broader planning document.

## Files and interfaces

- `dist/app.js`: scene projection, pointer gesture arbitration, route editor, selection, view reset and SVG export.
- `dist/model.js`: `restoreProject(input)` validates and preserves optional `waypoints: [{x, y}]`; absent waypoints become `[]`. Coordinates are finite and within 0–100, snapped to the 5-unit grid for manually edited routes. Reject malformed imported routes rather than silently discarding them.
- `dist/styles.css` and, if needed, `dist/index.html`: grid, controls, focus and accessible instructions; retain responsive layout.
- `tests/model.test.mjs`: legacy and routed project round trips and invalid geometry.
- `tests/browser-interactions.mjs`: extend existing mouse, keyboard and touch interaction coverage; keep its storage restoration.
- `README.md`: brief navigation and cable editing instructions. Update existing cache-busting asset versions as needed for GitHub Pages.

## Task 1: Persist and validate manual routes

- [ ] Add model tests for an old cable with no waypoints, ordered waypoint round trip through JSON, and rejection of non-array points, non-numeric/non-finite, out-of-bounds and off-grid coordinates. Confirm existing assets and cable endpoints survive unchanged.
- [ ] Run `npm test` and confirm the new route tests fail on the existing implementation.
- [ ] Update `restoreProject` to retain validated waypoints, default missing ones to `[]`, and preserve all existing validation. New cable creation starts with an empty route. Do not change the storage key.
- [ ] Run `npm test`; all model tests pass. Confirm an invalid import leaves the current project intact.

## Task 2: Navigate the interactive area

- [ ] Extend browser tests to assert pointer-anchored wheel zoom, midpoint pinch zoom, blank-space drag, zoom limits, and reset. Test in plan and 3D views, including after rotation and at narrow viewport sizes; allow less than one screen pixel of anchor error.
- [ ] Test that a click on a zone still selects it, equipment drags without jumping, placement/zone/connection modes still work, and a cancelled pointer gesture restores the original state. Test a second finger starting during a drag and lifting either finger first.
- [ ] Add pan state in SVG view coordinates and update the viewBox. Convert client positions through the SVG's current inverse screen transform; use the existing inverse projection and rotation for floor coordinates. Use pointer capture and a movement threshold to distinguish clicks from drags. On transition to pinch, cancel an unfinished edit cleanly; never save its partial state.
- [ ] Preserve existing zoom limits and buttons; reset pan on reset, new project and import. Consume wheel events only over the interactive area. Keep browser zoom controls and page scrolling outside it available.
- [ ] Run `npm test` and the browser suite described under Verification. Confirm all navigation and existing interactions pass.

## Task 3: Edit cables on the dot grid

- [ ] Add browser tests for selecting a cable in either view, adding a point in the correct segment order, snapping/dragging it, removing it, reset, and moving an endpoint while points stay fixed. Check a route with multiple points, including points that differ in both coordinates, and assert every floor-plan segment is horizontal or vertical. Verify off-grid equipment endpoints remain attached and are connected by orthogonal segments after equipment movement. Verify editing after pan, zoom and each rotation, including a point at the plan edge.
- [ ] Add tests for keyboard selection, adding/moving/removing a point, focus visibility, Escape/cancel, pointer cancellation, and touch pinch during a point drag. Verify a dragged cable point cannot also start a pan or asset drag.
- [ ] Render a floor-anchored dot grid and accessible point handles only while editing a selected cable. Increase the cable hit target without changing its visual stroke. Insert new points at the selected rendered segment in route order between its neighbouring fixed points, clamp and snap to the nearest dot, and save only completed edits. Recompute generated elbows after every point or endpoint move; do not persist generated elbows as fixed points. Provide an explicit, accessible point-add flow and remove/reset controls.
- [ ] Build the orthogonal floor-plan path from endpoints and the same ordered waypoint list before projecting it into plan or 3D. Render the existing automatic elbow when the list is empty. Keep equipment endpoints attached even when equipment moves. Avoid changing existing asset and connection deletion behavior.
- [ ] Exclude editing grid, handles and hit targets from SVG export while retaining the visible routed cable. Test exported SVG geometry and the JSON export/import round trip.
- [ ] Run model and browser suites; exercise both views and confirm there are no console exceptions.

## Task 4: Finish and verify

- [ ] Update README instructions for wheel/pinch, blank-space pan, selecting cables, adding/dragging/removing points and resetting routes. Update asset query versions where needed so a deployed page fetches the changed modules.
- [ ] Run `npm test`, `node --check dist/app.js`, `node --check dist/model.js`, and `git diff --check`.
- [ ] Serve `dist` on `127.0.0.1:5173`, launch Chrome with debugging on port `9223`, and run `node tests/browser-interactions.mjs`; expect `Browser interaction checks passed.` Stop only processes started for verification.
- [ ] Verify the site under a non-root path matching `/atlas-network/`, including module loading, persistence, route editing and SVG export. After a separately authorized push/deploy, confirm the GitHub Pages workflow succeeds and the published site serves the intended version.
- [ ] Review the diff against this plan and preserve the user's existing untracked document. Do not commit or push without permission.

## Review focus

- Old project data and invalid waypoint imports: Task 1 tests backward compatibility and atomic rejection.
- Orthogonal routing and off-grid endpoints: Task 3 tests generated elbows and movement without diagonal floor-plan segments.
- Zoom, rotation and viewport changes: Tasks 2–3 test the coordinate transforms and anchor accuracy.
- Interrupted gestures and multiple touch pointers: Tasks 2–3 test cancellation and gesture precedence.
- Keyboard access and dense cable hit targets: Task 3 tests all editing operations and focus.
- SVG and deployed subpath: Tasks 3–4 test clean route export and relative asset loading.
