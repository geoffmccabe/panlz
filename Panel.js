import * as THREE from 'three';

const DEFAULT_PANEL_DEPTH = 0.1; // Thickness of the panel
const GEAR_ICON_SIZE = 0.5; // Relative size in panel units

// --- Default frame texture loading REMOVED ---

// Basic Gear Icon Geometry (same as before)
const gearShape = new THREE.Shape();
gearShape.moveTo(0.2, 0); gearShape.absarc(0, 0, 0.2, 0, Math.PI * 2, false);
gearShape.moveTo(0.1, 0); gearShape.absarc(0, 0, 0.1, 0, Math.PI * 2, true);
const gearGeometry = new THREE.ShapeGeometry(gearShape);
const gearMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide });

// Shared Loader
const textureLoader = new THREE.TextureLoader();


export class Panel {
    constructor(id, config, sceneRef) {
        this.id = id;
        this.scene = sceneRef;
        this.panelManager = config.panelManager; // Store reference to manager
        this.gridCellWidth = config.gridCellWidth; // Store base unit width

        this.title = config.title || `Panel ${id}`;
        this.gridX = config.gridX || 0;
        this.gridY = config.gridY || 0;
        this.widthUnits = config.widthUnits || 1;
        // Height units/calculation is handled by PanelManager layout

        // Appearance Settings
        this.cornerRadius = config.cornerRadius || 0.1;
        this.bevelSize = config.bevelSize || 0.02;
        this.screenOpacity = config.screenOpacity || 1.0;
        this.frameMaterial = null; // Will be created in _createMesh
        this.frameTexture = null; // <<< FIX APPLIED HERE (Ensured it starts null)
        this.frameTextureUrl = null; // Store URL if loaded from file

        // Content
        this.jsCode = config.initialJsCode || `// Default code\nctx.fillStyle='rgb(0, 50, 70)';\nctx.fillRect(0,0,canvas.width,canvas.height);\nctx.fillStyle='white';\nctx.font='20px sans-serif';\nctx.textAlign='center';\nctx.fillText('${this.title}', canvas.width/2, canvas.height/2);`;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvasTexture = new THREE.CanvasTexture(this.canvas);
        this.canvasTexture.colorSpace = THREE.SRGBColorSpace;

        // State
        this.isDragging = false;
        this.isResizing = false;
        this.targetPosition = new THREE.Vector3();
        this.targetQuaternion = new THREE.Quaternion();
        this.currentWidth = 0; // Store current world dimensions
        this.currentHeight = 0;

        // Three.js Objects
        this.meshGroup = new THREE.Group();
        this.frameMesh = null;
        this.screenMesh = null;
        this.headerMesh = null;
        this.gearIconMesh = null;
        this.titleMesh = null;
        this.headerHandleMesh = null;
        this.footerHandleMesh = null;
        this.leftResizeHandleMesh = null;
        this.rightResizeHandleMesh = null;

        // Initial placeholder position until first layout
        this.meshGroup.position.set(0, 0, -1000); // Start offscreen
        this.scene.add(this.meshGroup);
        this.setJsCode(this.jsCode); // Run initial code (might draw on small default canvas)
    }

    // NEW: Central method called by PanelManager.updateLayout
    setSizeAndPosition(newWidth, newHeight, newPosition) {
        // Check if size changed significantly enough to warrant geometry rebuild
        const sizeChanged = Math.abs(newWidth - this.currentWidth) > 0.01 || Math.abs(newHeight - this.currentHeight) > 0.01;

        if (sizeChanged) {
            console.log(`Panel ${this.id}: Recreating mesh for size <span class="math-inline">\{newWidth\.toFixed\(2\)\}x</span>{newHeight.toFixed(2)}`);
            this.currentWidth = newWidth;
            this.currentHeight = newHeight;
            this._createMesh(newWidth, newHeight); // Rebuild geometry with new dimensions
            this.runJsCode(); // Rerun JS code as canvas size might have changed
        }

        // Always update position and target position
        this.meshGroup.position.copy(newPosition);
        // Only update target if not currently being interacted with (avoids jump)
        if (!this.isDragging && !this.isResizing) {
             this.targetPosition.copy(newPosition);
             // Also reset target rotation if not interacting
             this.targetQuaternion.identity(); // Reset jiggle target
             this.meshGroup.quaternion.identity(); // Snap rotation immediately if not interacting
        }
    }


    // Modified to accept final dimensions and build directly
    _createMesh(finalWidth, finalHeight) {
        // Dispose previous resources
        this._disposeMeshResources();

        const width = Math.max(0.01, finalWidth); // Ensure non-zero dimensions
        const height = Math.max(0.01, finalHeight);
        const frameDepth = DEFAULT_PANEL_DEPTH;
        // NEW: Header height based on gridCellWidth / 2
        const headerH = Math.max(0.01, this.gridCellWidth / 2);
        const screenH = Math.max(0.01, height - headerH); // Remaining height for screen

        console.log(`Panel <span class="math-inline">\{this\.id\} \_createMesh\: W\=</span>{width.toFixed(2)}, H=<span class="math-inline">\{height\.toFixed\(2\)\}, HeaderH\=</span>{headerH.toFixed(2)}, ScreenH=${screenH.toFixed(2)}`);


        // 1. Create Rounded Rectangle Shape (using final dimensions)
        const shape = new THREE.Shape();
        const radius = Math.min(this.cornerRadius, width / 2, height / 2); // Clamp radius
        const w = width / 2 - radius;
        const h = height / 2 - radius;

        // Check for invalid dimensions before proceeding
         if (w < 0 || h < 0 || radius <= 0) {
             console.error(`Panel ${this.id}: Invalid dimensions for shape creation`, {width, height, radius, w, h});
             // Create a fallback simple box? Or just return? Returning prevents mesh creation.
             shape.moveTo(-width/2, height/2);
             shape.lineTo(width/2, height/2);
             shape.lineTo(width/2, -height/2);
             shape.lineTo(-width/2, -height/2);
             shape.lineTo(-width/2, height/2);
             // return; // Exit if dimensions are fundamentally wrong
         } else {
             shape.moveTo(-w, height / 2);
             shape.lineTo(w, height / 2);
             shape.absarc(w, h, radius, Math.PI * 0.5, 0, true); // Top right corner
             shape.lineTo(width / 2, -h); // Right edge
             shape.absarc(w, -h, radius, 0, Math.PI * 1.5, true); // Bottom right corner
             shape.lineTo(-w, -height / 2); // Bottom edge
             shape.absarc(-w, -h, radius, Math.PI * 1.5, Math.PI, true); // Bottom left corner
             shape.lineTo(-width / 2, h); // Left edge
             shape.absarc(-w, h, radius, Math.PI, Math.PI * 0.5, true); // Top left corner
         }


        // 2. Extrude for Frame Geometry
        const extrudeSettings = {
            steps: 1, depth: frameDepth, bevelEnabled: true,
            bevelThickness: Math.min(this.bevelSize * 0.5, radius * 0.5, 0.05), // Limit bevel
            bevelSize: Math.min(this.bevelSize, radius * 0.5, 0.1),
            bevelOffset: 0, bevelSegments: 3
        };
        const frameGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        frameGeometry.center();

        // 3. Frame Material (Use texture if loaded, otherwise default color)
        if (!this.frameMaterial) { // Create material only once initially
             this.frameMaterial = new THREE.MeshStandardMaterial({
                 color: 0x888888, // Default gray color
                 map: this.frameTexture, // Use loaded texture if available
                 roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide
            });
        } else { // Update existing material
             this.frameMaterial.map = this.frameTexture; // Ensure map is up-to-date
             this.frameMaterial.needsUpdate = true;
        }


        this.frameMesh = new THREE.Mesh(frameGeometry, this.frameMaterial);
        this.frameMesh.name = `panelFrame_${this.id}`;
        this.meshGroup.add(this.frameMesh);


        // 4. Screen Geometry
        const inset = radius * 0.5 + this.bevelSize * 0.5;
        const screenW = Math.max(0.01, width - inset * 2);
        // Screen height is calculated based on remaining space after header
        // const screenH =
