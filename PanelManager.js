import * as THREE from 'three';
import { Panel } from './Panel.js';

const MAX_PANEL_ROWS = 10; // Limit number of rows

export class PanelManager {
    constructor(scene, camera, domElement, initialConfig) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.initialConfig = initialConfig; // Store config

        this.panels = [];
        this.panelMap = new Map(); // For quick lookup by ID
        this.nextPanelId = 0;

        // Grid state from config
        this.gridUnitsX = initialConfig.gridUnitsX || 6;
        this.gridCellWidth = initialConfig.gridCellWidth || 2.0; // Base width of a 1/6 panel
        this.gridSpacingPx = initialConfig.gridSpacingPx || 10; // Store initial spacing in pixels
        this.gridSpacing = 0; // World units, calculated by setSpacing
        this.gridOrigin = new THREE.Vector3(0, 0, 0); // Center of the grid system

        // Interaction state
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Interaction plane
        this.intersectionPoint = new THREE.Vector3();

        this.selectedPanel = null;
        this.draggingPanel = null;
        this.resizingPanel = null;
        this.dragOffset = new THREE.Vector3();
        this.initialPanelWidthUnits = 0;
        this.initialMouseX = 0;
        this.initialGridX = 0; // Store initial gridX for left resize

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
        this.domElement.addEventListener('pointerleave', this._onPointerUp.bind(this), false);
    }

    // --- Pixel to World Conversion ---
    _calculatePixelToWorldRatio() {
        // Estimate world height at z=0 based on camera FOV and distance
        // This is an approximation, assumes grid is near z=0 plane relative to camera distance
        const distance = this.camera.position.z; // Use camera's Z distance
        if (distance <= 0) return 0.01; // Avoid division by zero or negative distance
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const worldHeight = 2 * Math.tan(vFov / 2) * distance;
        return worldHeight / window.innerHeight;
    }

    setSpacing(pixels) {
        this.gridSpacingPx = pixels; // Store current pixel value
        const ratio = this._calculatePixelToWorldRatio();
        this.gridSpacing = pixels * ratio;
        console.log(`Set spacing: ${pixels}px -> ${this.gridSpacing.toFixed(3)} world units`);
        this.updateLayout(); // Recalculate layout whenever spacing changes
    }

    getCurrentSpacingPx() {
        return this.gridSpacingPx;
    }

    // --- Panel Management ---

    addPanel(config) {
        const id = this.nextPanelId++;
        // Pass manager reference and grid cell width to Panel
        config.panelManager = this;
        config.gridCellWidth = this.gridCellWidth;
        const panel = new Panel(id, config, this.scene);
        this.panels.push(panel);
        this.panelMap.set(id.toString(), panel);
        this.updateLayout();
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

    updateLayout() {
        console.log('Updating layout...');
        // 1. Calculate total world width available
        const totalUnitsWidth = this.gridUnitsX;
        const totalGridWidth = totalUnitsWidth * this.gridCellWidth + Math.max(0, totalUnitsWidth - 1) * this.gridSpacing;
        this.gridOrigin.x = -totalGridWidth / 2;

        // 2. Determine panel dimensions and positions
        const grid = this._buildLogicalGrid(); // Arrange panels in logical rows/cols

        // NEW Height Logic: Default height is gridCellWidth, making 1/6 panels square.
        // Height might be overridden later by JS content per panel. For now, it's fixed per row.
        const rowHeight = this.gridCellWidth; // Default height is the width of one cell
        const totalGridHeight = grid.length * rowHeight + Math.max(0, grid.length - 1) * this.gridSpacing;
        this.gridOrigin.y = totalGridHeight / 2; // Center vertically

        // 3. Position each panel
        let currentY = this.gridOrigin.y;

        grid.forEach((row, rowIndex) => {
            let currentX = this.gridOrigin.x;
            const processedInRow = new Set(); // Avoid processing same panel multiple times if it spans cols

            row.forEach((panelRef, colIndex) => {
                if (panelRef && !processedInRow.has(panelRef.id)) {
                    const panel = panelRef; // Get the actual panel object
                    processedInRow.add(panel.id);

                    // Ensure panel starts at its logical gridX position
                    currentX = this.gridOrigin.x + panel.gridX * (this.gridCellWidth + this.gridSpacing);

                    const panelWidth = panel.widthUnits * this.gridCellWidth + Math.max(0, panel.widthUnits - 1) * this.gridSpacing;
                    const panelHeight = rowHeight; // Use the fixed row height

                    const posX = currentX + panelWidth / 2;
                    const posY = currentY - panelHeight / 2;
                    const posZ = 0;

                    // Update panel's visual transform
                    // This now includes size, potentially triggering geometry rebuild in Panel
                    panel.setSizeAndPosition(panelWidth, panelHeight, new THREE.Vector3(posX, posY, posZ));

                     console.log(`Panel <span class="math-inline">\{panel\.id\} Layout\: grid\[</span>{rowIndex},<span class="math-inline">\{colIndex\}\] W\=</span>{panelWidth.toFixed(2)}, H=<span class="math-inline">\{panelHeight\.toFixed\(2\)\}, Pos\=\(</span>{posX.toFixed(2)}, ${posY.toFixed(2)})`);

                } else if (!panelRef) {
                    // This cell is empty, handled by starting next panel at correct gridX
                }
            });
            currentY -= (rowHeight + this.gridSpacing); // Move to next row position
        });
        console.log('Layout update complete.');
    }

    _buildLogicalGrid() {
         // Simpler grid build assuming fixed height (1 unit high per row)
         const grid = [];
         const occupied = new Set(); // Keep track of "row,col" strings

         const sortedPanels = [...this.panels].sort((a, b) => {
             if (a.gridY !== b.gridY) return a.gridY - b.gridY;
             return a.gridX - b.gridX;
         });

         let maxRow = -1;
         sortedPanels.forEach(panel => {
             // Clamp position and size
             panel.widthUnits = Math.max(1, Math.min(panel.widthUnits, this.gridUnitsX));
             panel.gridX = Math.max(0, Math.min(panel.gridX, this.gridUnitsX - panel.widthUnits));
             panel.gridY = Math.max(0, panel.gridY);

             maxRow = Math.max(maxRow, panel.gridY);

             // Ensure grid array is large enough
             while (grid.length <= panel.gridY) {
                 grid.push(Array(this.gridUnitsX).fill(null));
             }

             // Check for overlaps and place panel reference
             let canPlace = true;
             for (let i = 0; i < panel.widthUnits; i++) {
                 const key = `<span class="math-inline">\{panel\.gridY\},</span>{panel.gridX + i}`;
                 if (occupied.has(key)) {
                    console.warn(`Overlap placing Panel ${panel.id} at ${key}`);
                    canPlace = false;
                    //break; // Simple overlap handling: skip panel if overlap
                 }
             }

             if (canPlace) {
                for (let i = 0; i < panel.widthUnits; i++) {
                     const key = `<span class="math-inline">\{panel\.gridY\},</span>{panel.gridX + i}`;
                     grid[panel.gridY][panel.gridX + i] = panel; // Store reference
                     occupied.add(key);
                 }
             } else {
                 // TODO: Handle placement failure (e.g., try next row?)
                 console.error(`Failed to place Panel ${panel.id} due to overlap.`);
             }
         });

        // Return only the used rows (or empty if no panels)
         return grid;
    }

    // --- Interaction Handling ---

    _updateMouse(event) {
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    }

    _getIntersectedPanel(event) {
        // Raycasting logic (same as before)
        this._updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const interactionObjects = this.panels.flatMap(p => p.getRaycastObjects());
        if (interactionObjects.length === 0) return null;
        const intersects = this.raycaster.intersectObjects(interactionObjects, false);
        if (intersects.length > 0) {
            const intersectedObject = intersects[0].object;
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
        // Interaction logic (largely same as before, but store initialGridX for resize)
        event.preventDefault();
        this.isMouseDown = true;
        const intersection = this._getIntersectedPanel(event);
        this.selectedPanel = intersection ? intersection.panel : null;

        if (!this.selectedPanel) {
             if (!this.settingsPanelElement.contains(event.target) && !this.jsCodePopupElement.contains(event.target)) {
                this.closeSettingsPanel(); this.closeJsCodePopup();
             } return;
        }

        this.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(this.plane.normal).negate(), intersection.point);
        if (this.raycaster.ray.intersectPlane(this.plane, this.intersectionPoint)) {
            const objectName = intersection.objectName;
            const panel = this.selectedPanel;
            if (objectName.startsWith('panelGear_')) {
                this.openSettingsPanel(panel);
            } else if (objectName.startsWith('panelHandle_Top_') || objectName.startsWith('panelHandle_Bottom_')) {
                this.draggingPanel = panel;
                this.domElement.style.cursor = 'grabbing';
                this.dragOffset.copy(this.intersectionPoint).sub(panel.meshGroup.position);
                 this._startJiggleEffect(panel);
            } else if (objectName.startsWith('panelHandle_Left_') || objectName.startsWith('panelHandle_Right_')) {
                 this.resizingPanel = { panel: panel, handle: objectName.includes('Left') ? 'left' : 'right' };
                 this.domElement.style.cursor = 'ew-resize';
                 this.initialPanelWidthUnits = panel.widthUnits;
                 this.initialMouseX = this.intersectionPoint.x;
                 this.initialGridX = panel.gridX; // Store initial gridX for left resize adjustment
            }
        }
    }

    _onPointerMove(event) {
        // Interaction logic (largely same as before, but adjust resize logic)
        event.preventDefault();
        this._updateMouse(event);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (!this.raycaster.ray.intersectPlane(this.plane, this.intersectionPoint)) return;

        // --- Hover effect logic (same as before) ---
        const intersection = this._getIntersectedPanel(event);
        const hoverObjectName = intersection ? intersection.objectName : null;
        if (!this.isMouseDown) {
             if (hoverObjectName?.startsWith('panelGear_')) this.domElement.style.cursor = 'pointer';
             else if (hoverObjectName?.startsWith('panelHandle_Top_') || hoverObjectName?.startsWith('panelHandle_Bottom_')) this.domElement.style.cursor = 'grab';
             else if (hoverObjectName?.startsWith('panelHandle_Left_') || hoverObjectName?.startsWith('panelHandle_Right_')) this.domElement.style.cursor = 'ew-resize';
             else this.domElement.style.cursor = 'default';
        }
         // --- End Hover ---


        if (this.draggingPanel) {
            const targetPos = this.intersectionPoint.clone().sub(this.dragOffset);
            this.draggingPanel.targetPosition.copy(targetPos);
             // Snap preview logic could go here
        }

        if (this.resizingPanel) {
             const panel = this.resizingPanel.panel;
             const currentMouseX = this.intersectionPoint.x;
             const deltaX = currentMouseX - this.initialMouseX;
             const deltaUnits = Math.round(deltaX / (this.gridCellWidth + this.gridSpacing));

             let newWidthUnits = this.initialPanelWidthUnits;
             let newGridX = this.initialGridX; // Start with initial X

             if (this.resizingPanel.handle === 'right') {
                 newWidthUnits += deltaUnits;
             } else { // Resizing left handle
                 newWidthUnits -= deltaUnits;
                 newGridX += deltaUnits; // Move gridX when pulling left handle
            }

            // Clamp width (1 to TOTAL_GRID_UNITS_X)
            newWidthUnits = THREE.MathUtils.clamp(newWidthUnits, 1, this.gridUnitsX);
            // Clamp gridX (0 to prevent going off left edge)
             newGridX = Math.max(0, newGridX);
            // Prevent panel from exceeding right edge due to gridX change
             newWidthUnits = Math.min(newWidthUnits, this.gridUnitsX - newGridX);
             // Ensure width is still at least 1 after right-edge clamping
             newWidthUnits = Math.max(1, newWidthUnits);


            // Apply changes if they are valid and different
            if (panel.widthUnits !== newWidthUnits || panel.gridX !== newGridX) {
                 console.log(`Resizing Panel <span class="math-inline">\{panel\.id\}\: DeltaUnits\=</span>{deltaUnits}, NewWidth=<span class="math-inline">\{newWidthUnits\}, NewGridX\=</span>{newGridX}`);
                 panel.widthUnits = newWidthUnits;
                 panel.gridX = newGridX; // Update logical grid position
                 this.updateLayout(); // Re-layout immediately
            }
        }
    }

    _onPointerUp(event) {
        // Interaction logic (largely same as before)
        event.preventDefault();
        this.isMouseDown = false;
        this.domElement.style.cursor = 'default';
        this._stopJiggleEffect();

        if (this.draggingPanel) {
            const panel = this.draggingPanel;
            const finalPos = panel.targetPosition;
            const { gridX, gridY } = this._getGridSlotFromPosition(finalPos);

            // Prevent panel going off edge during drag/drop
            const clampedGridX = Math.max(0, Math.min(gridX, this.gridUnitsX - panel.widthUnits));

            // TODO: Overlap check before setting final position
            panel.gridX = clampedGridX;
            panel.gridY = Math.max(0, gridY); // Ensure gridY is non-negative

            this.draggingPanel = null;
            this.updateLayout();
        }

        if (this.resizingPanel) {
             // Width and gridX already updated during move
             this.resizingPanel = null;
             this.updateLayout(); // Final layout update
        }
        this.selectedPanel = null;
    }

    _getGridSlotFromPosition(position) {
        // Position to Grid logic (Needs update for fixed row height)
        const relativeX = position.x - this.gridOrigin.x;
        const relativeY = this.gridOrigin.y - position.y; // Y increases downwards

        const gridX = Math.round(relativeX / (this.gridCellWidth + this.gridSpacing));

        // Simpler Y calculation with fixed row height
        const rowHeightWithSpacing = this.gridCellWidth + this.gridSpacing;
        const gridY = Math.floor(relativeY / rowHeightWithSpacing);

        return {
            gridX: Math.max(0, gridX),
            gridY: Math.max(0, gridY) // Clamp Y >= 0
        };
    }

    // --- Settings UI --- (Mostly same as before)
    openSettingsPanel(panel) { /* ... */
        if (!panel) return;
        document.getElementById('settings-panel-id').value = panel.id;
        document.getElementById('settings-title').textContent = `Settings: ${panel.title}`;
        document.getElementById('corner-radius').value = panel.cornerRadius;
        document.getElementById('bevel-size').value = panel.bevelSize;
        document.getElementById('screen-opacity').value = panel.screenOpacity;
        document.getElementById('panel-spacing').value = this.getCurrentSpacingPx();
        document.getElementById('texture-upload').value = ''; // Clear file input
         document.getElementById('apply-to-all').checked = false; // Default to single panel
        this.settingsPanelElement.style.display = 'block';
         this.closeJsCodePopup();
    }
    closeSettingsPanel() { this.settingsPanelElement.style.display = 'none'; }
    closeJsCodePopup() { this.jsCodePopupElement.style.display = 'none'; }

    applySettings(panelId, settings, applyToAll) { /* ... */
        if (applyToAll) {
            this.panels.forEach(p => p.applySettings(settings));
        } else {
            const panel = this.getPanelById(panelId);
            if (panel) panel.applySettings(settings);
        }
        //
