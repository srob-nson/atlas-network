# Network Atlas

A browser-local workspace for placing network equipment and cable connections on a floor plan. The initial project contains example data.

Run locally with `python3 -m http.server 8000 --directory dist`, then open `http://localhost:8000`. Run the data checks with `npm test`.

## Start a design

1. Use **Export → Start a blank project**, then upload a PNG, JPEG, or WebP floor plan (up to 2 MB).
2. Add zones by choosing two corners on the plan, then name or adjust each zone in the inspector.
3. Add equipment or import a CSV. The required columns are `name,type`; optional columns are `zone,ip,management_url,model`. Supported types are `cabinet`, `switch`, `router`, `firewall`, `access_point`, and `patch_panel`. A zone name must match an existing zone to be assigned automatically.
4. Select an item to open its details, or drag it directly on the floor plan. Dragging updates its zone and connected cable lines. Use the details overlay to edit it, place it manually, open its HTTP(S) management interface, or connect it to another placed item. Auto-placement arranges unplaced items inside their assigned zones and leaves already placed items where they are.
5. Export the current view as SVG for documentation, or export the project as JSON to back it up or move it to another browser. Import a JSON export from the same menu to restore it.

Projects and floor-plan images are stored in the current browser. Clearing site data can remove them; export a JSON backup. The isometric view and cable paths are illustrative, not measured or engineered: zones, routes, physical clearance, rack capacity, and equipment suitability need review. This first version covers networking equipment; endpoints and OT assets are not included.

### Navigating and routing cables

Use the wheel over the floor plan to zoom around the pointer, or pinch on a touch screen. Drag empty plan space to pan; Reset view restores the original position, zoom and rotation.

Select a cable on the plan or in Connections to edit its route. Click a segment to add a grid point, then drag points to move them. Select a point to remove it, or reset the route to automatic. The Add point control also creates a keyboard-focusable point: use arrow keys to move it and Delete or Backspace to remove it. Escape cancels an active drag. Cable points remain fixed when equipment moves and are saved with the project.

### Racks and port connections

Open **Racks** in the sidebar or select a cabinet on the floor plan. Rack-mountable devices are automatically assigned to the first cabinet in their zone; use the cabinet field in equipment details to change the assignment. Access points stay outside racks. Racked devices are hidden on the floor plan; cables to other locations terminate at the cabinet. Rack panels are illustrative and do not represent a specific model or rack-unit layout.

Select a device or port to configure port speeds, add or remove ports, and create or edit connections by port, label and colour. Switches and patch panels start with 48 ports; routers and firewalls start with four. Connections within a rack are drawn between ports. Named ports can have one connection each. Connections appear in the project connection list and on the floor plan when both endpoints are placed; labels and colours are saved in project exports.
