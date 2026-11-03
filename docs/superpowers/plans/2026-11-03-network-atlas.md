# Network Atlas implementation plan

**Goal:** Build a browser-local workspace for planning and documenting network equipment on a floor plan.

**Architecture:** A static browser application keeps a project in local storage. A small data module validates inventory imports and places assets into named zones; the interface renders the plan and equipment as an exportable isometric SVG.

**Stack:** HTML, CSS, browser JavaScript, Node's built-in test runner.

1. Test inventory parsing, management-link validation, and placement with representative inputs; implement the shared data logic.
2. Build the interactive project workspace, floor-plan upload, editable zones, equipment placement and cabling, and SVG/project exports.
3. Run the data tests and exercise the application in a browser; package and publish the private Site.

Key constraints: preserve existing placed assets during auto-placement; reject unsafe management links; do not send project data to a server; report unsupported inventory rows and storage errors.
