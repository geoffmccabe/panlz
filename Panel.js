import * as THREE from 'three';

const DEFAULT_PANEL_DEPTH = 0.1; // Thickness of the panel
const GEAR_ICON_SIZE = 0.5; // Relative size in panel units

// --- Removed default frame texture loading ---

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
        this.frameTexture = null; // Store loaded texture object
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
             shape.absarc(w, h, radius, Math.PI * 0.5, 0, true);
             shape.lineTo(width / 2, -h);
             shape.absarc(w, -h, radius, 0, Math.PI * 1.5, true);
             shape.lineTo(-w, -height / 2);
             shape.absarc(-w, -h, radius, Math.PI * 1.5, Math.PI, true);
             shape.lineTo(-width / 2, h);
             shape.absarc(-w, h, radius, Math.PI, Math.PI * 0.5, true);
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
        // const screenH = Math.max(0.01, height - headerH - inset); // Adjusted height needs inset? maybe not vertically
        const screenGeometry = new THREE.PlaneGeometry(screenW, screenH);

        // 5. Screen Material
        // Ensure canvas has some minimum size before creating texture
        this.canvas.width = Math.max(128, 512 * (screenW / (screenH || 1))); // Base size 512, min 128
        this.canvas.height = Math.max(128, 512);
        this.canvasTexture.needsUpdate = true; // Flag texture for update after potential resize

        // Create screen material if it doesn't exist
        if (!this.screenMesh || !this.screenMesh.material) {
             const screenMaterial = new THREE.MeshBasicMaterial({
                 map: this.canvasTexture, transparent: true, opacity: this.screenOpacity,
                 side: THREE.FrontSide, polygonOffset: true, polygonOffsetFactor: 1.0, polygonOffsetUnits: 4.0
             });
             this.screenMesh = new THREE.Mesh(screenGeometry, screenMaterial);
        } else { // Update existing screen mesh
             this.screenMesh.geometry.dispose(); // Dispose old geometry
             this.screenMesh.geometry = screenGeometry; // Assign new geometry
             this.screenMesh.material.opacity = this.screenOpacity; // Update opacity
             this.screenMesh.material.map = this.canvasTexture; // Ensure texture ref is correct
             this.screenMesh.material.needsUpdate = true; // Flag material update
        }

        this.screenMesh.position.z = frameDepth / 2 + 0.001;
        this.screenMesh.position.y = -headerH / 2; // Position screen below header area
        this.screenMesh.name = `panelScreen_${this.id}`;
        this.meshGroup.add(this.screenMesh);

        // 6. Header Area
        const headerGeometry = new THREE.PlaneGeometry(width, headerH);
        if (!this.headerMesh || !this.headerMesh.material) {
             const headerMaterial = new THREE.MeshBasicMaterial({
                 map: this.frameTexture, // Use frame texture or color
                 color: !this.frameTexture ? 0xAAAAAA : 0xFFFFFF, // Slightly lighter if no texture
                 polygonOffset: true, polygonOffsetFactor: 1.0, polygonOffsetUnits: 2.0
             });
             this.headerMesh = new THREE.Mesh(headerGeometry, headerMaterial);
        } else {
             this.headerMesh.geometry.dispose();
             this.headerMesh.geometry = headerGeometry;
             this.headerMesh.material.map = this.frameTexture;
              this.headerMesh.material.color.set(!this.frameTexture ? 0xAAAAAA : 0xFFFFFF);
             this.headerMesh.material.needsUpdate = true;
        }

        this.headerMesh.position.y = height / 2 - headerH / 2;
        this.headerMesh.position.z = frameDepth / 2 + 0.002;
        this.headerMesh.name = `panelHeader_${this.id}`;
        this.meshGroup.add(this.headerMesh);

        // 7. Title Text
        this._updateTitleMesh(width, headerH, frameDepth);

        // 8. Gear Icon
        if (!this.gearIconMesh) { // Create only once
             this.gearIconMesh = new THREE.Mesh(gearGeometry, gearMaterial);
             this.gearIconMesh.name = `panelGear_${this.id}`;
             this.meshGroup.add(this.gearIconMesh);
        }
        // Scale and position gear
        const gearScale = Math.min(headerH, width * 0.1) * GEAR_ICON_SIZE / 0.2; // Scale based on header height
        this.gearIconMesh.scale.set(gearScale, gearScale, 0.1);
        this.gearIconMesh.position.set( -width / 2 + headerH / 2, height / 2 - headerH / 2, frameDepth / 2 + 0.004 );


        // 9. Interaction Handles (Recreate geometry on size change)
        this._createOrUpdateHandle('headerHandleMesh', `panelHandle_Top_${this.id}`, width, headerH * 1.5, 0, height / 2 - (headerH*1.5) / 2, frameDepth / 2 + 0.005);
        this._createOrUpdateHandle('footerHandleMesh', `panelHandle_Bottom_${this.id}`, width, headerH * 1.5, 0, -height / 2 + (headerH*1.5) / 2, frameDepth / 2 + 0.005);
        this._createOrUpdateHandle('leftResizeHandleMesh', `panelHandle_Left_${this.id}`, Math.min(width * 0.1, 0.3), height, -width/2 + Math.min(width * 0.1, 0.3)/
