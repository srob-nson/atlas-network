# Projects, buildings and floors

## Goal

Let users maintain multiple local projects, each with buildings and multiple floor plans, and document connections between equipment on different floors.

## Approach

Use the selected project → building → floor hierarchy. Each floor owns its plan, zones, equipment and same-floor cable geometry; the project owns connections so endpoints on different floors can be linked. Keeping each floor as a separate project was considered but would make building navigation and project-wide connections awkward.

## Workspace

Provide controls to create, select and rename projects, buildings and floors. A new project starts with one building and one empty ground floor; a new building starts with one empty floor. Switching floors changes the visible plan, equipment, racks and floor-local routes. Each floor can have its own uploaded image. Selection and view gestures reset when switching floors.

Connections can be created between equipment on any floors within the same project, including by choosing a destination device and port from the rack view. The connections list identifies both endpoints and their building and floor, and supports removal. A cross-floor connection appears as an endpoint indicator on each relevant floor and can be inspected from the connection list; it does not imply a physical route between plans. Floor-specific waypoints remain available for same-floor connections. Port occupancy is enforced across the whole project. Deleting equipment removes its connections after confirmation.

Project JSON export includes all buildings, floors, equipment and connections. Import validates the entire project before changing stored data. Existing single-floor local data and JSON imports migrate into one building and floor without losing the image, equipment, racks, ports or routes. Existing projects remain available when a new project is created. Local storage and JSON backups remain browser-local; no server or collaboration is added.

## Validation

Test migration, multi-floor round trips, invalid references, cross-floor port occupancy and deletion, and switching floors without losing edits. Exercise creation and navigation in a browser, including cross-floor connection creation and export/import. Preserve existing floor navigation and rack behavior.
