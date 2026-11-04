# Titan

A browser-local workspace for placing network equipment and cable connections on floor plans across projects, buildings and floors. The initial project contains example data.

Run locally with `python3 -m http.server 8000 --directory dist`, then open `http://localhost:8000`. Run the data checks with `npm test`.

The browser checks use an isolated Chrome profile and clear its preview data. Serve the repository root on port 5173, start Chrome with remote debugging on port 9223, and run the `tests/browser-*.mjs` scripts (except `browser-storage.mjs`, which is a helper).

## Start a design

1. Create a project, building and floor using the sidebar controls, then upload a PNG, JPEG, or WebP floor plan (up to 2 MB). Choose **Trace floor outline**, click around its boundary, and finish the outline. New floors inherit the outline; upload a separate image for each floor. Switch floors using the sidebar selectors.
2. Add equipment or import a CSV using the template in Equipment. Each row is an item; `name` and `type` are required, and `ip`, `management_url`, `vendor` and `model` are optional. Supported types are `cabinet`, `switch`, `router`, `firewall`, `access_point`, `patch_panel`, `plc`, `rtu`, `hmi`, `engineering_workstation`, `server`, `workstation`, `ip_camera`, `nvr`, `access_controller`, `sensor`, `meter`, `drive`, `ied`, `gateway`, `printer`, and `other`. Use `other` and the model field for devices outside these categories. Names and IP addresses allow up to 80 characters, vendor and model up to 120, and management URLs up to 500.
3. The equipment inventory is shared across the project. Select an item and change its Building / floor in the details to move it without importing the CSV again. Connections remain, while its floor position and route points are reset. Select an item to open its details, or drag it directly on the floor plan. Use the details overlay to edit it, place it manually, open its HTTP(S) management interface, or connect it to another placed item. Placement leaves equipment on the floor plan; add a cabinet and assign equipment to it when needed. Auto-placement leaves already placed equipment where it is.
4. Export the current view as SVG for documentation, or export the project as JSON to back it up or move it to another browser. Import a JSON export from the same menu to restore it.

Projects and floor-plan images are stored in IndexedDB in the current browser. JSON exports include the whole selected project and its schema version; existing browser data and unversioned backups migrate automatically. If browser storage fails, the status reports that changes are unsaved: export each affected project before leaving. Equipment can connect across floors using the equipment details or rack port selector. Cross-floor connections show an endpoint on each plan, but do not show a physical route between floors. Clearing site data can remove them; export a JSON backup. The isometric view and cable paths are illustrative, not measured or engineered: routes, physical clearance, rack capacity, and equipment suitability need review.

### Navigating and routing cables

Double-click equipment on the floor plan, then double-click another item and choose a free interface on each device. Use Cancel or Escape to stop connecting. Older device-only connections remain visible with unspecified interfaces; select one in Connections and choose its interfaces when known.

Use the mouse wheel, trackpad scroll or trackpad pinch over the floor plan to zoom around the pointer; touch screens also support pinch to zoom. Drag empty plan space to pan; Reset view restores the original position, zoom and rotation.

Select a cable on the plan or in Connections to edit its route. Click a segment to add a grid point, then drag points to move them. Select a point to remove it, or reset the route to automatic. The Add point control also creates a keyboard-focusable point: use arrow keys to move it and Delete or Backspace to remove it. Escape cancels an active drag. Cable points remain fixed when equipment moves and are saved with the project.

### Racks and port connections

Set a rack's capacity in U in its equipment details. For a device, enter its starting U and height, then choose the rack. Assignments cannot overlap or exceed capacity. Older assignments with unknown positions remain assigned. If several devices have unknown positions, unassign the others while setting the first position, then reassign them. Racked devices are hidden on the floor plan; cables to other locations terminate at the cabinet. Open **Racks** in the sidebar or select a cabinet on the floor plan to see devices and their U positions.

Set the number of ports in device details, then edit each interface name, speed and media. New devices have no assumed interfaces; connected ports cannot be removed by reducing the count. Double-click a free port in a rack, then choose a device and port from **Connect to**, or double-click another free port in the rack. Choose a colour before connecting, or select a connected port to change its colour. Double-click either connected port to remove the connection. Keyboard users can focus a port and press Enter. Connections within a rack are drawn between ports.

### Engineering validation

Choose **Validate design** to review errors, warnings and missing information. Select a finding's links to open the affected device, interface, rack or connection. Run validation again after editing to refresh the findings.

Set the network and VRF names in equipment details; duplicate IP addresses are compared only when both names are specified and match exactly. Use an explicit name such as `default` for a default VRF. Missing IP, network or VRF values are reported as missing information.

For each interface, enter its speed with units, media and PoE role. Titan compares recognized copper and fiber media, and warns when declared speeds differ because negotiation may still be possible. Unrecognized or missing values are reported as unknown. For PoE, set the supplying and powered interface roles, the supplying device's budget in watts and the powered device's demand in watts. The total counts each powered device once per source; a device with multiple sources has an unknown load split. These checks do not model PoE classes, power loss, supported speed ranges or physical cable suitability.
