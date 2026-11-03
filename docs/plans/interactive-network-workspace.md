# Interactive Navigation, Cable Routing and Rack Views

## Summary

Extend the floor-plan workspace with pointer-centered zoom, blank-space panning, editable cable waypoints, and cabinet front views. Keep equipment and connections in the existing browser-local project, with backward-compatible JSON import.

## Implementation changes

- Add mouse-wheel and touch-pinch zoom within the interactive area. Keep the existing zoom buttons and reset control; reset restores zoom, pan and rotation. Dragging blank space pans the view, while equipment dragging and placement modes retain their current behavior. Convert pointer coordinates through the current view transform so editing remains accurate after zoom, pan or rotation.
- Let users select a cable and add, drag or remove waypoints snapped to a visible floor-plan grid. Store waypoints in floor-plan coordinates, and render them in both plan and 3D views. Endpoints remain attached to their equipment when it moves; waypoints remain fixed until edited. Offer a control to reset a cable to its automatic route.
- Keep cabinets and their contents as inventory assets. Allow an existing device to be assigned to a cabinet with a starting rack unit and height; prevent overlapping placements and placements outside the cabinet’s configured capacity. Unassigning a device or deleting its cabinet preserves the device and its connections.
- Add a cabinet front dialog showing numbered rack units, equipment names, and user-defined port labels. Allow users to add, edit and remove ports and optionally select ports at either end of a cable. Keep equipment-only cables valid. Prevent removing a port that is in use unless the user confirms clearing its cable endpoint.
- Extend project persistence and JSON export/import for cabinet assignments, rack positions, ports, cable endpoint ports and waypoints. Existing projects load with no rack assignments, ports or manual waypoints. Validate references and geometry on import; preserve existing asset and connection data. Include the current routed cable geometry in SVG exports.

## Test plan

- Test project import and export round trips, including old projects and invalid rack, port and waypoint data.
- Test rack occupancy, assignment and unassignment, cabinet removal, port removal, and preservation of connected devices.
- Test waypoint snapping, editing, reset and endpoint movement; verify coordinates under zoom, pan and rotation.
- Exercise mouse and touch navigation, equipment dragging, placement modes, rack dialog keyboard access, and cable editing in both views. Run the existing test suite and verify the deployed site at its GitHub Pages path.

## Assumptions

- Use a configurable cabinet capacity with a 42U default; equipment defaults to 1U until edited.
- Ports are user-defined labels, not a hardware catalogue or automatic port discovery. Existing equipment-to-equipment connections remain supported.
- Cable segments connect grid waypoints directly; they do not have to remain orthogonal. Multiple connections between the same equipment are allowed when distinct ports are specified.
- View position is temporary, while rack and cable edits are saved with the project. Physical cable length and engineering constraints remain out of scope.
