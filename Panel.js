import * as THREE from 'three';

const DEFAULT_PANEL_DEPTH = 0.1; // Thickness of the panel
const HEADER_HEIGHT_FACTOR = 0.08; // Percentage of panel height for header
const GEAR_ICON_SIZE = 0.5; // Relative size in panel units

// Shared resources (to avoid recreating textures/geometries unnecessarily)
const textureLoader = new THREE.TextureLoader();
const defaultFrameTexture = textureLoader.load('path/to/default_frame_texture.jpg'); // Replace or create programmatically
defaultFrameTexture.wrapS = THREE.RepeatWrapping;
defaultFrameTexture.wrapT = THREE.RepeatWrapping;

// Basic Gear Icon (You could load an SVG or model instead)
const gearShape = new THREE.Shape();
// Crude gear shape - replace with better geometry or texture later
gearShape.moveTo(0.2, 0); gearShape.absarc(0, 0, 0.2, 0, Math.PI * 2, false);
gearShape.moveTo(0.1, 0); gearShape.absarc(0, 0, 0.1, 0, Math.PI * 2, true); // Inner hole
// Add some teeth approximations
// ... (this part is complex with shapes, consider a texture/sprite)
const gearGeometry = new THREE.ShapeGeometry(gearShape);
const gearMaterial = new THREE.MeshBasicMaterial({ color: 0xcccccc, side: THREE.DoubleSide });


export class Panel {
    constructor(id, config, sceneRef) {
        this.id = id;
        this.scene = sceneRef;
        this.title = config.title || `Panel ${id}`;
        this.gridX = config.gridX || 0;
        this.gridY = config.gridY || 0;
        this.widthUnits = config.widthUnits || 1; // 1 to 6
        this.heightUnits = config.heightUnits || 1; // For now, assuming fixed height based on aspect ratio later

        // --- Appearance Settings ---
        this.cornerRadius = config.cornerRadius || 0.1;
        this.bevelSize = config.bevelSize || 0.02;
        this.screenOpacity = config.screenOpacity || 1.0;
        this.frameTexture = defaultFrameTexture; // Start with default
        this.frameTextureUrl = null; // To store URL if loaded from file

        // --- Content ---
        this.jsCode = config.initialJsCode || `// Default code\nctx.fillStyle='rgb(0, 50, 70)';\nctx.fillRect(0,0,canvas.width,canvas.height);\nctx.fillStyle='white';\nctx.font='20px sans-serif';\nctx.textAlign='center';\nctx.fillText('${this.title}', canvas.width/2, canvas.height/2);`;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.canvasTexture = new THREE.CanvasTexture(this.canvas);
        this.canvasTexture.colorSpace = THREE.SRGBColorSpace; // Important for color accuracy

        // --- Interaction State ---
        this.isDragging = false;
        this.isResizing = false; // 'left', 'right', false
        this.dragOffset = new THREE.Vector3(); // Offset from center on grab
        this.targetPosition = new THREE.Vector3(); // For smooth animation/jiggle
        this.targetQuaternion = new THREE.Quaternion(); // For jiggle rotation

        // --- Three.js Objects ---
        this.meshGroup = new THREE.Group(); // Main container for all parts
        this.frameMesh = null;
        this.screenMesh = null;
        this.headerMesh = null;
        this.gearIconMesh = null;
        // Invisible meshes for interaction areas (optional but good)
        this.headerHandleMesh = null; // For dragging top/bottom
        this.footerHandleMesh = null; // For dragging top/bottom
        this.leftResizeHandleMesh = null;
        this.rightResizeHandleMesh = null;

        this._createMesh();
        this.scene.add(this.meshGroup);
        this.setJsCode(this.jsCode); // Run initial code
    }

    _createMesh(width = 1, height = 1) { // width/height are temporary internal units before scaling
        // Clean up old meshes if recreating
        if (this.meshGroup.children.length > 0) {
            this.meshGroup.remove(...this.meshGroup.children);
            // Dispose geometries and materials if necessary (important for performance)
            this.frameMesh?.geometry.dispose();
            this.frameMesh?.material.dispose();
            this.screenMesh?.geometry.dispose();
            this.screenMesh?.material.dispose();
            this.headerMesh?.geometry.dispose();
            this.headerMesh?.material.dispose();
            this.gearIconMesh?.geometry.dispose();
            // Dispose handle meshes...
        }

        const frameDepth = DEFAULT_PANEL_DEPTH;
        const headerH = height * HEADER_HEIGHT_FACTOR;
        const screenH = height * (1.0 - HEADER_HEIGHT_FACTOR);

        // 1. Create Rounded Rectangle Shape
        const shape = new THREE.Shape();
        const radius = Math.min(this.cornerRadius, width / 2, height / 2); // Clamp radius
        const w = width / 2 - radius;
        const h = height / 2 - radius;

        shape.moveTo(-w, height / 2); // Top left start
        shape.lineTo(w, height / 2); // Top edge
        shape.absarc(w, h, radius, Math.PI * 0.5, 0, true); // Top right corner
        shape.lineTo(width / 2, -h); // Right edge
        shape.absarc(w, -h, radius, 0, Math.PI * 1.5, true); // Bottom right corner
        shape.lineTo(-w, -height / 2); // Bottom edge
        shape.absarc(-w, -h, radius, Math.PI * 1.5, Math.PI, true); // Bottom left corner
        shape.lineTo(-width / 2, h); // Left edge
        shape.absarc(-w, h, radius, Math.PI, Math.PI * 0.5, true); // Top left corner

        // 2. Extrude for Frame Geometry
        const extrudeSettings = {
            steps: 1,
            depth: frameDepth,
            bevelEnabled: true,
            bevelThickness: Math.min(this.bevelSize * 0.5, radius * 0.5), // Limit bevel
            bevelSize: Math.min(this.bevelSize, radius * 0.5),
            bevelOffset: 0,
            bevelSegments: 3 // Keep low for performance
        };
        const frameGeometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        frameGeometry.center(); // Center geometry for easier positioning/rotation

        // 3. Frame Material
        const frameMaterial = new THREE.MeshStandardMaterial({
             map: this.frameTexture,
             roughness: 0.6,
             metalness: 0.2,
             side: THREE.DoubleSide // Render back face
        });

        this.frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
        this.frameMesh.name = `panelFrame_${this.id}`; // For raycasting identification
        this.meshGroup.add(this.frameMesh);


        // 4. Screen Geometry (Plane slightly in front of the frame's front face)
        // Adjust screen size slightly to fit within the rounded inner edge
        const inset = radius * 0.5 + this.bevelSize * 0.5; // Approximate inset
        const screenW = width - inset * 2;
        // const screenH = height - inset * 2; // Use adjusted screen height
        const screenGeometry = new THREE.PlaneGeometry(screenW, screenH);

        // 5. Screen Material (using CanvasTexture)
        this.canvas.width = 512 * (screenW / (screenH || 1)); // Maintain aspect, power of 2 often good
        this.canvas.height = 512; // Fixed height, adjust as needed
        this.canvasTexture.needsUpdate = true;

        const screenMaterial = new THREE.MeshBasicMaterial({
            map: this.canvasTexture,
            transparent: true,
            opacity: this.screenOpacity,
            side: THREE.FrontSide // Only front is visible
        });
        screenMaterial.polygonOffset = true; // Prevent z-fighting with frame
        screenMaterial.polygonOffsetFactor = 1.0;
        screenMaterial.polygonOffsetUnits = 4.0;

        this.screenMesh = new THREE.Mesh(screenGeometry, screenMaterial);
        this.screenMesh.position.z = frameDepth / 2 + 0.001; // Slightly in front
        this.screenMesh.position.y = -headerH / 2; // Shift down below header area
        this.screenMesh.name = `panelScreen_${this.id}`;
        this.meshGroup.add(this.screenMesh);


        // 6. Header Area (simple plane for now, could be part of frame extrusion)
        const headerGeometry = new THREE.PlaneGeometry(width, headerH);
        const headerMaterial = new THREE.MeshBasicMaterial({
             map: this.frameTexture, // Use same texture as frame for now
             // Can have a separate header texture later
        });
        headerMaterial.polygonOffset = true; // Prevent z-fighting
        headerMaterial.polygonOffsetFactor = 1.0;
        headerMaterial.polygonOffsetUnits = 2.0;

        this.headerMesh = new THREE.Mesh(headerGeometry, headerMaterial);
        this.headerMesh.position.y = height / 2 - headerH / 2; // Position at top
        this.headerMesh.position.z = frameDepth / 2 + 0.002; // Slightly in front of screen
        this.headerMesh.name = `panelHeader_${this.id}`;
        this.meshGroup.add(this.headerMesh);

        // Add Title Text (using CanvasTexture on a plane)
        this._updateTitleMesh(width, headerH, frameDepth);

        // 7. Gear Icon
        this.gearIconMesh = new THREE.Mesh(gearGeometry, gearMaterial);
        const gearScale = Math.min(headerH, width * 0.1) * GEAR_ICON_SIZE / 0.2; // Scale based on header height, 0.2 is original shape radius
        this.gearIconMesh.scale.set(gearScale, gearScale, 0.1); // Make it flat-ish
        this.gearIconMesh.position.set(
            -width / 2 + headerH / 2, // Position left within header
             height / 2 - headerH / 2, // Center vertically in header
             frameDepth / 2 + 0.004 // In front of header bg
        );
        this.gearIconMesh.name = `panelGear_${this.id}`;
        this.meshGroup.add(this.gearIconMesh);


        // 8. Interaction Handles (Invisible Planes)
        const handleMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false }); // Invisible

        // Header/Footer Drag Handle
        const dragHandleHeight = headerH * 1.5; // Make slightly larger than visual header
        this.headerHandleMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, dragHandleHeight), handleMaterial.clone());
        this.headerHandleMesh.position.set(0, height / 2 - dragHandleHeight / 2, frameDepth / 2 + 0.005);
        this.headerHandleMesh.name = `panelHandle_Top_${this.id}`;
        this.meshGroup.add(this.headerHandleMesh);

        this.footerHandleMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, dragHandleHeight), handleMaterial.clone());
        this.footerHandleMesh.position.set(0, -height / 2 + dragHandleHeight / 2, frameDepth / 2 + 0.005);
        this.footerHandleMesh.name = `panelHandle_Bottom_${this.id}`;
        this.meshGroup.add(this.footerHandleMesh);


        // Left/Right Resize Handles
        const resizeHandleWidth = Math.min(width * 0.1, 0.3); // Width of resize zone
        this.leftResizeHandleMesh = new THREE.Mesh(new THREE.PlaneGeometry(resizeHandleWidth, height), handleMaterial.clone());
        this.leftResizeHandleMesh.position.set(-width/2 + resizeHandleWidth/2, 0, frameDepth / 2 + 0.005);
        this.leftResizeHandleMesh.name = `panelHandle_Left_${this.id}`;
        this.meshGroup.add(this.leftResizeHandleMesh);

        this.rightResizeHandleMesh = new THREE.Mesh(new THREE.PlaneGeometry(resizeHandleWidth, height), handleMaterial.clone());
        this.rightResizeHandleMesh.position.set(width/2 - resizeHandleWidth/2, 0, frameDepth / 2 + 0.005);
        this.rightResizeHandleMesh.name = `panelHandle_Right_${this.id}`;
        this.meshGroup.add(this.rightResizeHandleMesh);

        // Set initial target transforms for animation
        this.targetPosition.copy(this.meshGroup.position);
        this.targetQuaternion.copy(this.meshGroup.quaternion);
    }

     _updateTitleMesh(panelWidth, headerHeight, depth) {
         if (this.titleMesh) {
             this.meshGroup.remove(this.titleMesh);
             this.titleMesh.geometry.dispose();
             this.titleMesh.material.map?.dispose();
             this.titleMesh.material.dispose();
         }

         const canvas = document.createElement('canvas');
         const ctx = canvas.getContext('2d');
         const fontHeight = Math.min(24, headerHeight * 0.6); // Dynamic font size
         const font = `${fontHeight}px sans-serif`;
         ctx.font = font;
         const textWidth = ctx.measureText(this.title).width;

         // Adjust canvas size to fit text + padding
         canvas.width = THREE.MathUtils.ceilPowerOfTwo(textWidth + 20); // Power of 2 often better
         canvas.height = THREE.MathUtils.ceilPowerOfTwo(fontHeight * 1.5);

         // Redraw text on resized canvas
         ctx.font = font; // Set font again after resize
         ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // Semi-transparent white text
         ctx.textAlign = 'center';
         ctx.textBaseline = 'middle';
         ctx.fillText(this.title, canvas.width / 2, canvas.height / 2);

         const texture = new THREE.CanvasTexture(canvas);
         texture.needsUpdate = true;
         texture.colorSpace = THREE.SRGBColorSpace;


         const titlePlaneHeight = headerHeight * 0.8;
         const titlePlaneWidth = titlePlaneHeight * (canvas.width / canvas.height);
         const titleGeometry = new THREE.PlaneGeometry(titlePlaneWidth, titlePlaneHeight);
         const titleMaterial = new THREE.MeshBasicMaterial({
             map: texture,
             transparent: true,
             depthWrite: false // Render on top without z-fighting issues
         });

         this.titleMesh = new THREE.Mesh(titleGeometry, titleMaterial);
         // Position in header, right of gear icon
         const gearWidth = headerHeight; // Rough width occupied by gear
         this.titleMesh.position.set(
             -panelWidth / 2 + gearWidth + titlePlaneWidth / 2 + 0.1, // Adjust 0.1 for padding
             panelWidth / 2 - headerHeight / 2, // Vertically centered in header
             depth / 2 + 0.003 // Slightly in front of header bg
         );
         this.titleMesh.name = `panelTitle_${this.id}`;
         this.meshGroup.add(this.titleMesh);
     }


    // --- Update Methods ---

    setPosition(x, y, z) {
        this.meshGroup.position.set(x, y, z);
        this.targetPosition.copy(this.meshGroup.position); // Update target immediately
    }

    // Call this when grid position or panel size changes
    updateTransform(newWidth, newHeight, position) {
         // Rescale the entire group - simpler than recreating complex geometry if only size changes
         // Note: This scales thickness too. If thickness should be constant,
         // you'd need to recreate the geometry in _createMesh with new width/height args.
         // For now, we'll assume simple scaling is acceptable.

         // Determine scale factor based on a reference size (e.g., width=1, height=1 used in _createMesh)
         // Let's assume _createMesh was called with width=5, height=3 as a base aspect ratio example
         const baseWidth = 5;
         const baseHeight = 3;
         this.meshGroup.scale.set(newWidth / baseWidth, newHeight / baseHeight, 1); // Don't scale depth for now

         this.meshGroup.position.copy(position);
         this.targetPosition.copy(position); // Update animation target
    }


    applySettings(settings) {
        let needsRecreate = false;
        let needsMaterialUpdate = false;
        let needsScreenUpdate = false;
        let needsTitleUpdate = false; // If title changes

        if (settings.cornerRadius !== undefined && settings.cornerRadius !== this.cornerRadius) {
            this.cornerRadius = settings.cornerRadius;
            needsRecreate = true;
        }
        if (settings.bevelSize !== undefined && settings.bevelSize !== this.bevelSize) {
            this.bevelSize = settings.bevelSize;
            needsRecreate = true;
        }
        if (settings.screenOpacity !== undefined && settings.screenOpacity !== this.screenOpacity) {
            this.screenOpacity = settings.screenOpacity;
            needsScreenUpdate = true;
        }
        if (settings.title !== undefined && settings.title !== this.title) {
            this.title = settings.title;
            needsTitleUpdate = true; // Requires recreating title mesh
        }

        const updateTexture = (newTexture, isDefault = false) => {
            if (this.frameMesh && this.frameMesh.material.map !== newTexture) {
                // Dispose old texture ONLY if it's not the shared default one and not null
                if (this.frameMesh.material.map && this.frameMesh.material.map !== defaultFrameTexture) {
                     this.frameMesh.material.map.dispose();
                }
                this.frameMesh.material.map = newTexture;
                this.frameMesh.material.needsUpdate = true;
                // Update header texture too if it uses the same material map
                if (this.headerMesh && this.headerMesh.material.map !== newTexture) {
                    this.headerMesh.material.map = newTexture;
                    this.headerMesh.material.needsUpdate = true;
                }
                this.frameTexture = newTexture; // Store current texture
                this.frameTextureUrl = isDefault ? null : newTexture.image?.src; // Store URL if it's a loaded one
                needsMaterialUpdate = true; // Flag that material props might need update
            }
        };


        if (settings.textureFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                textureLoader.load(e.target.result, (loadedTexture) => {
                    loadedTexture.wrapS = THREE.RepeatWrapping;
                    loadedTexture.wrapT = THREE.RepeatWrapping;
                    loadedTexture.colorSpace = THREE.SRGBColorSpace;
                    updateTexture(loadedTexture);
                     if (needsRecreate) this._createMesh(/* pass current scaled dimensions */); // Recreate mesh if needed AFTER texture loaded
                });
            };
            reader.readAsDataURL(settings.textureFile);
        } else if (settings.useDefaultTexture) {
            // Logic to explicitly revert to default if needed
             updateTexture(defaultFrameTexture, true);
        }


        // Apply updates
        if (needsRecreate) {
             // Get current world scale to pass correct dimensions if scaling method is used
             const currentScale = this.meshGroup.scale;
             const baseWidth = 5; // Match the base size used in _createMesh
             const baseHeight = 3;
             this._createMesh(baseWidth * currentScale.x, baseHeight * currentScale.y); // Recreate with current visual size
        }
        if (needsScreenUpdate && this.screenMesh) {
            this.screenMesh.material.opacity = this.screenOpacity;
            this.screenMesh.material.needsUpdate = true;
        }
         if (needsTitleUpdate) {
            // Need current size info again for title update
             const currentScale = this.meshGroup.scale;
             const baseWidth = 5; const baseHeight = 3;
             const currentWidth = baseWidth * currentScale.x;
             const currentHeaderHeight = (baseHeight * currentScale.y) * HEADER_HEIGHT_FACTOR;
            this._updateTitleMesh(currentWidth, currentHeaderHeight, DEFAULT_PANEL_DEPTH);
         }

    }

    setJsCode(code) {
        this.jsCode = code;
        this.runJsCode(); // Execute immediately
    }

    runJsCode() {
        if (!this.canvas || !this.ctx) return; // Safety check

        // Clear canvas before running user code
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // --- VERY IMPORTANT: Security Considerations ---
        // Running arbitrary JS code is dangerous.
        // Option 1: Function constructor (less safe, runs in main context)
        try {
            // Provide a limited context to the user code
            const panelContext = {
                 // Add any utility functions or data you want to expose safely
                 width: this.canvas.width,
                 height: this.canvas.height,
                 setTitle: (newTitle) => { this.applySettings({ title: newTitle }); } // Example API
            };
             // Bind 'this' to the panelContext within the executed code
            const userFunc = new Function('ctx', 'canvas', 'panel', this.jsCode);
            userFunc.call(panelContext, this.ctx, this.canvas, panelContext);
        } catch (error) {
            console.error(`Error executing JS for Panel ${this.id}:`, error);
            // Display error on the panel itself
            this.ctx.fillStyle = 'red';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.fillStyle = 'white';
            this.ctx.font = '12px monospace';
            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'top';
            this.ctx.fillText(`Error:\n${error.message}\n(Check console for details)`, 5, 5);
        }
        // Option 2: Web Worker (Safer, isolated thread, more complex communication)
        // Option 3: iframe sandbox (Safer, isolated context, needs postMessage communication)

        // Update the texture after drawing
        this.canvasTexture.needsUpdate = true;
    }


    // Update animations (like jiggle)
    update(deltaTime) {
        // Smoothly move panel towards its target position (for jiggle/snap animation)
        this.meshGroup.position.lerp(this.targetPosition, deltaTime * 10); // Adjust lerp factor for speed
        this.meshGroup.quaternion.slerp(this.targetQuaternion, deltaTime * 10); // Smooth rotation

        // Add subtle idle movement? (Optional)
        // const time = Date.now() * 0.001;
        // this.meshGroup.position.x += Math.sin(time * 0.5 + this.id) * 0.001;
    }

    // --- Interaction Helpers ---
    getRaycastObjects() {
        // Return list of meshes that should be checked for interaction
        return [
            // Order matters potentially - check specific handles first
            this.gearIconMesh,
            this.headerHandleMesh,
            this.footerHandleMesh,
            this.leftResizeHandleMesh,
            this.rightResizeHandleMesh,
            // this.frameMesh // Use frame mesh if handles aren't precise enough
        ];
    }

    dispose() {
        // Clean up resources when panel is removed
        this.scene.remove(this.meshGroup);
        this.frameMesh?.geometry.dispose();
        this.frameMesh?.material.map?.dispose(); // Dispose texture if loaded
        this.frameMesh?.material.dispose();
        this.screenMesh?.geometry.dispose();
        this.screenMesh?.material.map?.dispose(); // Dispose canvas texture
        this.screenMesh?.material.dispose();
        this.headerMesh?.geometry.dispose();
        this.headerMesh?.material.map?.dispose();
        this.headerMesh?.material.dispose();
        this.gearIconMesh?.geometry.dispose();
        this.gearIconMesh?.material.dispose();
        this.titleMesh?.geometry.dispose();
        this.titleMesh?.material.map?.dispose();
        this.titleMesh?.material.dispose();
        // Dispose handle geometries/materials...
        // Remove canvas element? Might not be necessary if it just gets GC'd
    }
}
