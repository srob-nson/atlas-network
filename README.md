# Titan

A browser-local workspace for placing network equipment and cable connections on floor plans across projects, buildings and floors. The initial project contains example data.

Run locally with `python3 -m http.server 8000 --directory dist`, then open `http://localhost:8000`. Run the data checks with `npm test`.

## Start a design

1. Create a project, building and floor using the sidebar controls, then upload a PNG, JPEG, or WebP floor plan (up to 2 MB). Choose **Trace floor outline**, click around its boundary, and finish the outline. New floors inherit the outline; upload a separate image for each floor. Switch floors using the sidebar selectors.
2. Add equipment or import a CSV using the template in Equipment. Each row is an item; `name` and `type` are required, and `ip`, `management_url` and `model` are optional. Supported types are `cabinet`, `switch`, `router`, `firewall`, `access_point`, and `patch_panel`. Names and IP addresses allow up to 80 characters, models up to 120, and management URLs up to 500.
3. The equipment inventory is shared across the project. Select an item and change its Building / floor in the details to move it without importing the CSV again. Connections remain, while its floor position and route points are reset. Select an item to open its details, or drag it directly on the floor plan. Use the details overlay to edit it, place it manually, open its HTTP(S) management interface, or connect it to another placed item. Placing a switch, firewall or router creates a rack at that position and puts the device inside. Auto-placement does the same for unplaced equipment and leaves already placed equipment where it is.
4. Export the current view as SVG for documentation, or export the project as JSON to back it up or move it to another browser. Import a JSON export from the same menu to restore it.

Projects and floor-plan images are stored in the current browser. JSON exports include the whole selected project; existing single-floor projects and backups migrate automatically. Equipment can connect across floors using the equipment details or rack port selector. Cross-floor connections show an endpoint on each plan, but do not show a physical route between floors. Clearing site data can remove them; export a JSON backup. The isometric view and cable paths are illustrative, not measured or engineered: routes, physical clearance, rack capacity, and equipment suitability need review. This first version covers networking equipment; endpoints and OT assets are not included.

### Navigating and routing cables

Double-click equipment on the floor plan, then double-click another item to connect them. Use Cancel or Escape to stop connecting.

Use the mouse wheel, trackpad scroll or trackpad pinch over the floor plan to zoom around the pointer; touch screens also support pinch to zoom. Drag empty plan space to pan; Reset view restores the original position, zoom and rotation.

Select a cable on the plan or in Connections to edit its route. Click a segment to add a grid point, then drag points to move them. Select a point to remove it, or reset the route to automatic. The Add point control also creates a keyboard-focusable point: use arrow keys to move it and Delete or Backspace to remove it. Escape cancels an active drag. Cable points remain fixed when equipment moves and are saved with the project.

### Racks and port connections

Open **Racks** in the sidebar or select a cabinet on the floor plan. Use the cabinet field in equipment details to change a device’s rack assignment. Access points stay outside racks. Racked devices are hidden on the floor plan; cables to other locations terminate at the cabinet. Rack panels are illustrative and do not represent a specific model or rack-unit layout.

Double-click a free port, then choose a device and port from **Connect to**; the connection saves immediately. Choose a colour before connecting, or select a connected port to change its colour. Alternatively, double-click a second free port in the rack. Double-click either connected port to remove the connection. Keyboard users can focus a port and press Enter. Switches and patch panels start with 48 ports; routers and firewalls start with four. Connections within a rack are drawn between ports. The switch and firewall panel styling is FortiSwitch- and FortiGate-inspired, not a model-specific hardware layout.
