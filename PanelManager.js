import * as THREE from 'three';
import { Panel } from './Panel.js';

const TOTAL_GRID_UNITS_X = 6; // Total width units (1/6ths)
const BASE_PANEL_ASPECT_RATIO = 5 / 3; // Intrinsic aspect ratio (width/height) for scaling
const MAX_PANEL_ROWS = 10; // Limit number of rows

export class PanelManager {
    constructor(scene, camera, domElement) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;

        this.panels = [];
        this.panelMap = new Map(); // For quick lookup by ID
        this.nextPanelId = 0;

        // Grid state
        this.gridSpacing = 0.2; // Spacing in world units (adjust based on scale)
        this.gridCellWidth = 2.0; // Base width of a 1/6th panel in world units
        this.gridOrigin = new THREE.Vector3(0, 0, 0); // Center of the grid system

        // Interaction state
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Interaction plane
        this.intersectionPoint = new THREE.Vector3(); // Where ray hits plane

        this.selectedPanel = null;
        this.draggingPanel = null;
        this.resizingPanel = null; // { panel: Panel, handle: 'left' | 'right' }
        this.dragOffset = new THREE.Vector3();
        this.initialPanelWidthUnits = 0;
        this.initialMouseX = 0;

        this.isMouseDown = false;
        this.jiggleTimeout = null;

        // UI Refs
        this.settingsPanelElement = document.getElementById('settings-panel');
        this.jsCodePopupElement = document.getElementById('js-code-popup');


        this._addEventListeners();
    }

    _addEventListeners() {
        this.domElement.addEventListener('pointerdown', this._onPointerDown.bind(this), false);
        this.domElement.addEventListener('pointermove', this._onPointerMove.bind(this), false);
        this.domElement.addEventListener('pointerup', this._onPointerUp.bind(this), false);
        this.domElement.addEventListener('pointerleave', this._onPointerUp.bind(this), false); // Treat leave as up
    }

    _removeEventListeners() {
        // Implementation to remove listeners if needed
    }

    // --- Panel Management ---

    addPanel(config) {
        const id = this.nextPanelId++;
        const panel = new Panel(id, config, this.scene);
        this.panels.push(panel);
        this.panelMap.set(id.toString(), panel); // Store by string ID for consistency with HTML values
        this.updateLayout(); // Recalculate grid after adding
        return panel;
    }

    removePanel(panelId) {
        const idStr = panelId.toString();
        const panel = this.panelMap.get(idStr);
        if (panel) {
            panel.dispose();
            this.panels = this.panels.filter(p => p.id !== panel.id);
            this.panelMap.delete(idStr);
            this.updateLayout();
        }
    }

    getPanelById(panelId) {
         return this.panelMap.get(panelId.toString());
    }


    // --- Layout Logic ---

    setSpacing(pixels) {
        // Convert pixel spacing to world units (this needs calibration based on camera distance/FOV)
        // This is a rough approximation - a better way involves unprojecting screen points
        const worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
        const pixelToWorld = worldHeight / window.innerHeight;
        this.gridSpacing = pixels * pixelToWorld;
        this.updateLayout();
    }


    updateLayout() {
        // 1. Calculate total world width available (can be dynamic based on panels, or fixed)
        const totalUnitsWidth = TOTAL_GRID_UNITS_X;
        const totalGridWidth = totalUnitsWidth * this.gridCellWidth + (totalUnitsWidth -1) * this.gridSpacing;
        this.gridOrigin.x = -totalGridWidth / 2; // Center the grid horizontally

        // 2. Determine panel dimensions based on grid units
        let currentY = 0; // Start from top or center? Let's center vertically later
        const panelHeights = []; // Store calculated height for each row

        const grid = this._buildLogicalGrid(); // Create a 2D array representing panel occupation

        grid.forEach((row, rowIndex) => {
             let maxPanelHeightInRow = 0;
             row.forEach(panel => {
                 if (panel) {
                     const panelWidth = panel.widthUnits * this.gridCellWidth + (panel.widthUnits - 1) * this.gridSpacing;
                     const panelHeight = panelWidth / BASE_PANEL_ASPECT_RATIO; // Height based on aspect ratio
                     maxPanelHeightInRow = Math.max(maxPanelHeightInRow, panelHeight);
                 }
             });
            panelHeights[rowIndex] = maxPanelHeightInRow;
        });

         const totalGridHeight = panelHeights.reduce((sum, h) => sum + h, 0) + Math.max(0, panelHeights.length - 1) * this.gridSpacing;
         this.gridOrigin.y = totalGridHeight / 2; // Center vertically


        // 3. Position each panel
        currentY = this.gridOrigin.y; // Start from top edge of centered grid

        grid.forEach((row, rowIndex) => {
            let currentX = this.gridOrigin.x;
             const rowHeight = panelHeights[rowIndex];

            row.forEach(panel => {
                 if (panel) {
                     const panelWidth = panel.widthUnits * this.gridCellWidth + (panel.widthUnits - 1) * this.gridSpacing;
                     //const panelHeight = panelWidth / BASE_PANEL_ASPECT_RATIO; // Use calculated height

                     const posX = currentX + panelWidth / 2;
                     const posY = currentY - rowHeight / 2; // Position center Y within the row's height
                     const posZ = 0; // Flat grid for now

                    // Update panel's visual transform
                    panel.updateTransform(panelWidth, rowHeight, new THREE.Vector3(posX, posY, posZ));

                     currentX += panelWidth + this.gridSpacing;
                 } else {
                     // This accounts for empty slots if a panel doesn't start at gridX 0
                     // Assumes panel.gridX was used correctly in _buildLogicalGrid
                     // This simple iteration might need refinement for complex empty spaces
                      currentX += this.gridCellWidth + this.gridSpacing; // Move past empty unit slot
                 }
             });
             currentY -= (rowHeight + this.gridSpacing); // Move to next row position
        });
    }

    // Helper to arrange panels logically based on their gridX/gridY properties
    _buildLogicalGrid() {
         const grid = Array.from({ length: MAX_PANEL_ROWS }, () => Array(TOTAL_GRID_UNITS_X).fill(null));
         const placedPanels = new Set();

         // Sort panels primarily by Y, then by X for consistent placement
         const sortedPanels = [...this.panels].sort((a, b) => {
             if (a.gridY !== b.gridY) return a.gridY - b.gridY;
             return a.gridX - b.gridX;
         });

        let maxRow = 0;
         sortedPanels.forEach(panel => {
             // Ensure panel fits within bounds
             panel.gridX = Math.max(0, Math.min(panel.gridX, TOTAL_GRID_UNITS_X - panel.widthUnits));
             panel.gridY = Math.max(0, panel.gridY);

             // Naive placement: Place it, overwriting anything underneath for now
             // A more robust system would prevent overlaps or shift panels down.
             if (panel.gridY < MAX_PANEL_ROWS) {
                maxRow = Math.max(maxRow, panel.gridY);
                 for (let i = 0; i < panel.widthUnits; i++) {
                     if (panel.gridX + i < TOTAL_GRID_UNITS_X) {
                        // TODO: Handle overlaps better. This just overwrites.
                        // if (grid[panel.gridY][panel.gridX + i] !== null) {
                        //     console.warn(`Overlap detected for panel ${panel.id}`);
                        // }
                         grid[panel.gridY][panel.gridX + i] = panel; // Place reference in grid slots it occupies
                         // Mark only the starting slot visually for the layout loop? No, use the reference.
                     }
                 }
             } else {
                 console.warn(`Panel ${panel.id} placed outside max rows.`);
             }
         });

        // Return only the used rows + 1 (or at least 1 row)
         return grid.slice(0, maxRow + 1);
    }


    // --- Interaction Handling ---

    _updateMouse(event) {
        // Calculate mouse position in normalized device coordinates (-1 to +1)
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    _getIntersectedPanel(event) {
        this._updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        const interactionObjects = this.panels.flatMap(p => p.getRaycastObjects());
        if (interactionObjects.length === 0) return null;

        const intersects = this.raycaster.intersectObjects(interactionObjects, false); // Don't check children recursively here

        if (intersects.length > 0) {
            const intersectedObject = intersects[0].object;
            // Find the panel this object belongs to (using the name convention)
            const match = intersectedObject.name.match(/panel(Frame|Screen|Header|Gear|Handle_.*)_(\d+)/);
            if (match) {
                const panelId = match[2];
                const panel = this.getPanelById(panelId);
                if (panel) {
                    return { panel, object: intersectedObject, point: intersects[0].point, objectName: intersectedObject.name };
                }
            }
        }
        return null;
    }

    _onPointerDown(event) {
        event.preventDefault();
        this.isMouseDown = true;

        const intersection = this._getIntersectedPanel(event);
        this.selectedPanel = intersection ? intersection.panel : null;

        if (!this.selectedPanel) {
            // Clicked outside panels, potentially close UI
             if (!this.settingsPanelElement.contains(event.target) && !this.jsCodePopupElement.contains(event.target)) {
                this.closeSettingsPanel();
                this.closeJsCodePopup();
             }
            return;
        }

        // Update interaction plane to be at the depth of the clicked panel
        this.plane.setFromNormalAndCoplanarPoint(
            this.camera.getWorldDirection(this.plane.normal).negate(), // Normal facing camera
            intersection.point // Coplanar with intersection point
        );

        // Get intersection point on the interaction plane
        if (this.raycaster.ray.intersectPlane(this.plane, this.intersectionPoint)) {

            const objectName = intersection.objectName;
            const panel = this.selectedPanel;

            if (objectName.startsWith('panelGear_')) {
                this.openSettingsPanel(panel);
            } else if (objectName.startsWith('panelHandle_Top_') || objectName.startsWith('panelHandle_Bottom_')) {
                this.draggingPanel = panel;
                this.domElement.style.cursor = 'grabbing';
                // Calculate offset from panel center to grab point
                this.dragOffset.copy(this.intersectionPoint).sub(panel.meshGroup.position);
                 this._startJiggleEffect(panel); // Start jiggle for others
            } else if (objectName.startsWith('panelHandle_Left_') || objectName.startsWith('panelHandle_Right_')) {
                 this.resizingPanel = {
                    panel: panel,
                    handle: objectName.includes('Left') ? 'left' : 'right'
                 };
                 this.domElement.style.cursor = 'ew-resize';
                 this.initialPanelWidthUnits = panel.widthUnits;
                 this.initialMouseX = this.intersectionPoint.x; // Store initial grab X in world coords
            } else {
                 // Clicked on panel body/screen - potentially allow drag here too?
                 // this.draggingPanel = panel; // Uncomment to allow dragging whole body
                 // this.domElement.style.cursor = 'grabbing';
                 // this.dragOffset.copy(this.intersectionPoint).sub(panel.meshGroup.position);
            }
        }
    }

    _onPointerMove(event) {
        event.preventDefault();

        // Update mouse and raycaster for hover effects or continuous interaction
        this._updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Get intersection with the interaction plane
        if (!this.raycaster.ray.intersectPlane(this.plane, this.intersectionPoint)) {
            return; // No intersection with plane
        }

        // Hover effect
        const intersection = this._getIntersectedPanel(event);
        const hoverPanel = intersection ? intersection.panel : null;
        const hoverObjectName = intersection ? intersection.objectName : null;

        if (!this.isMouseDown) { // Only update cursor if not actively dragging/resizing
            if (hoverObjectName?.startsWith('panelGear_')) {
                this.domElement.style.cursor = 'pointer';
            } else if (hoverObjectName?.startsWith('panelHandle_Top_') || hoverObjectName?.startsWith('panelHandle_Bottom_')) {
                 this.domElement.style.cursor = 'grab';
            } else if (hoverObjectName?.startsWith('panelHandle_Left_') || hoverObjectName?.startsWith('panelHandle_Right_')) {
                this.domElement.style.cursor = 'ew-resize';
            } else if (hoverPanel) {
                 this.domElement.style.cursor = 'default'; // Or 'move' if dragging body enabled
            }
             else {
                this.domElement.style.cursor = 'default';
            }
        }


        // Handle Dragging
        if (this.draggingPanel) {
            const targetPos = this.intersectionPoint.clone().sub(this.dragOffset);
            this.draggingPanel.targetPosition.copy(targetPos); // Update target for smooth follow

            // --- Snap Logic Preview (Optional but good UX) ---
            // Calculate which grid cell the targetPos falls into
            const { gridX, gridY } = this._getGridSlotFromPosition(targetPos);
            // Maybe visually highlight the target grid slot? (Advanced)
        }

        // Handle Resizing
        if (this.resizingPanel) {
             const panel = this.resizingPanel.panel;
             const currentMouseX = this.intersectionPoint.x;
             const deltaX = currentMouseX - this.initialMouseX;

            // Convert world space deltaX to grid units delta
            // This assumes panel wasn't moved, only resized. More complex if both allowed simultaneously.
            const deltaUnits = Math.round(deltaX / (this.gridCellWidth + this.gridSpacing));

            let newWidthUnits = this.initialPanelWidthUnits;

             if (this.resizingPanel.handle === 'right') {
                 newWidthUnits += deltaUnits;
             } else { // Resizing left handle
                 newWidthUnits -= deltaUnits;
                 // Adjust gridX as well when pulling left handle
                 // This is tricky - needs careful calculation based on how much width changed
                 // Simplified: Assume gridX changes by -deltaUnits. Needs validation.
                  // panel.gridX = initialGridX - deltaUnits; // Store initialGridX on pointer down
            }


            // Clamp width (1 to TOTAL_GRID_UNITS_X) and ensure it doesn't exceed grid boundaries
            newWidthUnits = THREE.MathUtils.clamp(newWidthUnits, 1, TOTAL_GRID_UNITS_X);
             const maxPossibleWidth = TOTAL_GRID_UNITS_X - panel.gridX; // Max width from current X pos
             newWidthUnits = Math.min(newWidthUnits, maxPossibleWidth);


            if (panel.widthUnits !== newWidthUnits) {
                panel.widthUnits = newWidthUnits;
                 // Re-layout the entire grid to reflect the size change immediately
                this.updateLayout();
            }
        }
    }

    _onPointerUp(event) {
        event.preventDefault();
        this.isMouseDown = false;
        this.domElement.style.cursor = 'default'; // Reset cursor

        this._stopJiggleEffect(); // Stop jiggling when drag ends


        if (this.draggingPanel) {
            // --- Final Snap Logic ---
            const panel = this.draggingPanel;
            const finalPos = panel.targetPosition; // Use the last target position
            const { gridX, gridY } = this._getGridSlotFromPosition(finalPos);

            // TODO: Collision detection - check if target slot is occupied
            // If occupied, either don't move, or shift other panels (complex)
            // For now, just move it:
            panel.gridX = Math.max(0, Math.min(gridX, TOTAL_GRID_UNITS_X - panel.widthUnits)); // Clamp X
            panel.gridY = Math.max(0, gridY); // Clamp Y

            this.draggingPanel = null;
            this.updateLayout(); // Final layout update
        }

        if (this.resizingPanel) {
             // Final width was already set during move, just clear state
             this.resizingPanel = null;
             this.updateLayout(); // Ensure layout is correct after resize potentially changed row heights etc.
        }

        this.selectedPanel = null; // Clear selection after action
    }

    // Convert world position to grid indices
    _getGridSlotFromPosition(position) {
        // Adjust position relative to grid origin
        const relativeX = position.x - this.gridOrigin.x;
        const relativeY = this.gridOrigin.y - position.y; // Y increases downwards in grid logic

        const gridX = Math.floor(relativeX / (this.gridCellWidth + this.gridSpacing));

        // Calculating gridY is harder as rows have variable height.
        // Iterate through calculated row heights to find the correct row.
        let cumulativeHeight = 0;
        let gridY = 0;
        const panelHeights = this._calculateRowHeights(); // Need this helper or store heights
         for (let i = 0; i < panelHeights.length; i++) {
            const rowBottom = cumulativeHeight + panelHeights[i];
             if (relativeY < rowBottom) {
                gridY = i;
                break;
             }
            cumulativeHeight += panelHeights[i] + this.gridSpacing;
            gridY = i + 1; // If it's below the last calculated row
         }


        return { gridX: Math.max(0, gridX), gridY: Math.max(0, gridY) };
    }

    _calculateRowHeights() {
         // Duplicates some logic from updateLayout - refactor potential
         const panelHeights = [];
         const grid = this._buildLogicalGrid();
          grid.forEach((row, rowIndex) => {
             let maxPanelHeightInRow = 0;
             // Find unique panels in the row (since grid stores references in multiple slots)
             const panelsInRow = [...new Set(row.filter(p => p !== null))];
             panelsInRow.forEach(panel => {
                 const panelWidth = panel.widthUnits * this.gridCellWidth + (panel.widthUnits - 1) * this.gridSpacing;
                 const panelHeight = panelWidth / BASE_PANEL_ASPECT_RATIO;
                 maxPanelHeightInRow = Math.max(maxPanelHeightInRow, panelHeight);
             });
             // Assign a minimum height even if row is empty? Maybe not.
             panelHeights[rowIndex] = maxPanelHeightInRow > 0 ? maxPanelHeightInRow : (this.gridCellWidth / BASE_PANEL_ASPECT_RATIO); // Fallback height if row is empty but exists
         });
         return panelHeights;
    }


    // --- Settings UI ---

    openSettingsPanel(panel) {
        if (!panel) return;
        // Populate panel with current settings
        document.getElementById('settings-panel-id').value = panel.id;
        document.getElementById('settings-title').textContent = `Settings: ${panel.title}`;
        document.getElementById('corner-radius').value = panel.cornerRadius;
        document.getElementById('bevel-size').value = panel.bevelSize;
        document.getElementById('screen-opacity').value = panel.screenOpacity;
        document.getElementById('panel-spacing').value = Math.round(this.gridSpacing / (this._calculatePixelToWorldRatio() || 0.01)); // Convert back to pixels
        document.getElementById('texture-upload').value = ''; // Clear file input
         document.getElementById('apply-to-all').checked = false; // Default to single panel

        this.settingsPanelElement.style.display = 'block';
         this.closeJsCodePopup(); // Close code editor if open
    }

    closeSettingsPanel() {
        this.settingsPanelElement.style.display = 'none';
    }

     closeJsCodePopup() {
        this.jsCodePopupElement.style.display = 'none';
    }

     _calculatePixelToWorldRatio() {
         const worldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z;
         return worldHeight / window.innerHeight;
     }


    applySettings(panelId, settings, applyToAll) {
        if (applyToAll) {
            this.panels.forEach(p => p.applySettings(settings));
        } else {
            const panel = this.getPanelById(panelId);
            if (panel) {
                panel.applySettings(settings);
            }
        }
        // Applying settings might change panel appearance/size needs, potentially requiring layout update
         this.updateLayout(); // Update layout if settings could affect size/aspect indirectly
    }

    // --- Animation / Effects ---
     _startJiggleEffect(draggedPanel) {
         clearTimeout(this.jiggleTimeout);
         this.jiggleTimeout = setTimeout(() => { // Add a small delay before jiggle starts
             this.panels.forEach(p => {
                 if (p !== draggedPanel) {
                     const angle = (Math.random() - 0.5) * 0.02; // Small random angle in radians
                     const xOffset = (Math.random() - 0.5) * 0.05;
                     const yOffset = (Math.random() - 0.5) * 0.05;
                     p.targetQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
                    // Add offset to existing target position, not absolute
                    p.targetPosition.add(new THREE.Vector3(xOffset, yOffset, 0));
                 }
             });
         }, 150); // 150ms delay
     }

    _stopJiggleEffect() {
        clearTimeout(this.jiggleTimeout);
        this.panels.forEach(p => {
            // Reset rotation and position offsets smoothly via the update loop lerp/slerp
            p.targetQuaternion.identity(); // Target identity quaternion (no rotation)
            // Recalculate correct target position from grid layout
            // This needs the panel's final gridX/gridY BEFORE calling updateLayout
            // Or, updateLayout sets the targetPosition directly. Let's assume updateLayout handles it.
        });
        // Call updateLayout() here or ensure it's called after snap to reset target positions correctly.
        // Already called in _onPointerUp after snap logic.
    }


    update(deltaTime) {
        // Update individual panel animations (smooth movement, jiggle recovery)
        this.panels.forEach(panel => panel.update(deltaTime));
    }

    dispose() {
        this._removeEventListeners();
        this.panels.forEach(panel => panel.dispose());
        this.panels = [];
        this.panelMap.clear();
        // Dispose other resources if necessary
    }
}
