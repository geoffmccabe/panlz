import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Removed for now
import { PanelManager } from './PanelManager.js';

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 15; // Adjust as needed based on panel sizes

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Lighting (General, Non-directional) ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Slightly brighter ambient
scene.add(ambientLight);
const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5); // White sky, gray ground
hemisphereLight.position.set(0, 20, 0);
scene.add(hemisphereLight);

// --- Background ---
const textureLoader = new THREE.TextureLoader();
// Use the relative path assuming the image is in 'images' folder and served by GitHub Pages
const bgTextureUrl = 'images/perc-bkgd.webp';
textureLoader.load(
    bgTextureUrl,
    (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
        console.log('Background texture loaded successfully.');
    },
    undefined, // Progress callback (optional)
    (error) => {
        console.error(`Error loading background texture from ${bgTextureUrl}:`, error);
        scene.background = new THREE.Color(0x202025); // Fallback color if texture fails
    }
);

// --- Simple Test Cube --- // <<< CUBE CODE ADDED HERE
const testGeo = new THREE.BoxGeometry(2, 2, 2); // Made slightly larger
const testMat = new THREE.MeshBasicMaterial({ color: 0xff0000 }); // Bright red
const testCube = new THREE.Mesh(testGeo, testMat);
testCube.position.set(0, 0, 0); // Place at origin
scene.add(testCube);
console.log('--- Added Test Cube to Scene ---');
// ----------------------


// --- Panel Manager ---
// Pass scene, camera, renderer DOM element, and initial grid config
const panelManager = new PanelManager(scene, camera, renderer.domElement, {
    gridUnitsX: 6,
    gridCellWidth: 2.0, // Width of a 1/6 panel unit in world space
    gridSpacingPx: 10 // Initial spacing in pixels
});

// --- Initial Panels (Prompt v1 Layout) ---
// Set initial spacing (calculates world units from pixels) using the value stored in panelManager
panelManager.setSpacing(panelManager.gridSpacingPx);

panelManager.addPanel({ gridX: 0, gridY: 0, widthUnits: 6, title: 'Top Full Width' });
panelManager.addPanel({ gridX: 0, gridY: 1, widthUnits: 3, title: 'Left 1' });
panelManager.addPanel({ gridX: 3, gridY: 1, widthUnits: 3, title: 'Right 1' });
panelManager.addPanel({ gridX: 0, gridY: 2, widthUnits: 3, title: 'Left 2' });
panelManager.addPanel({ gridX: 3, gridY: 2, widthUnits: 3, title: 'Right 2' });
panelManager.addPanel({ gridX: 0, gridY: 3, widthUnits: 3, title: 'Left 3' });
panelManager.addPanel({ gridX: 3, gridY: 3, widthUnits: 3, title: 'Right 3' });


// --- Resize Listener ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Recalculate spacing in world units and update layout
    panelManager.setSpacing(panelManager.getCurrentSpacingPx()); // Maintain pixel spacing
    // updateLayout() is called within setSpacing
}, false);

// --- Animation Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    panelManager.update(deltaTime); // Update panel animations (like jiggle)

    // Optional: Rotate the test cube slowly to prove animation loop runs
    // testCube.rotation.x += 0.01;
    // testCube.rotation.y += 0.01;

    renderer.render(scene, camera);
}

animate();

// --- UI Event Listeners (Connect HTML UI to PanelManager) ---
// Make PanelManager globally accessible for UI interaction (simplest method for now)
window.panelManager = panelManager;

const settingsPanel = document.getElementById('settings-panel');
const jsCodePopup = document.getElementById('js-code-popup');
const spacingSlider = document.getElementById('panel-spacing');

// Initialize slider value based on manager's current pixel spacing
spacingSlider.value = panelManager.getCurrentSpacingPx();

document.getElementById('close-settings-button').addEventListener('click', () => {
    settingsPanel.style.display = 'none';
});

document.getElementById('close-js-code-button').addEventListener('click', () => {
    jsCodePopup.style.display = 'none';
});

document.getElementById('apply-js-button').addEventListener('click', () => {
    const panelId = document.getElementById('settings-panel-id').value;
    const panel = panelManager.getPanelById(panelId);
    if (panel) {
        document.getElementById('js-panel-id').value = panelId;
        document.getElementById('js-code-input').value = panel.jsCode || ''; // Load existing code
        jsCodePopup.style.display = 'flex'; // Use flex for layout
        settingsPanel.style.display = 'none'; // Hide settings while editing code
    }
});

document.getElementById('run-js-code-button').addEventListener('click', () => {
    const panelId = document.getElementById('js-panel-id').value;
    const code = document.getElementById('js-code-input').value;
    const panel = panelManager.getPanelById(panelId);
    if (panel) {
        panel.setJsCode(code); // Store and execute the code
    }
    jsCodePopup.style.display = 'none';
});


document.getElementById('apply-settings-button').addEventListener('click', () => {
    const panelId = document.getElementById('settings-panel-id').value;
    const applyToAll = document.getElementById('apply-to-all').checked;
    const textureInput = document.getElementById('texture-upload');
    const cornerRadius = parseFloat(document.getElementById('corner-radius').value);
    const bevelSize = parseFloat(document.getElementById('bevel-size').value);
    const screenOpacity = parseFloat(document.getElementById('screen-opacity').value);
    const spacingPx = parseInt(spacingSlider.value);

    const settings = {
        cornerRadius,
        bevelSize,
        screenOpacity,
        textureFile: textureInput.files.length > 0 ? textureInput.files[0] : null,
        // Let Panel determine if texture needs removing based on file input state vs current state
         textureUrl: textureInput.files.length === 0 && panelManager.getPanelById(panelId)?.frameTextureUrl ? null : undefined // Request removal if input empty but texture exists
    };

     // Apply spacing change separately
     panelManager.setSpacing(spacingPx);

    // Apply other settings
    panelManager.applySettings(panelId, settings, applyToAll);


    // Clear file input after applying (optional, might be annoying)
    // textureInput.value = '';

    if (!applyToAll) { // Keep panel open if applying to all for further global changes
       settingsPanel.style.display = 'none';
    }
});

// Update layout dynamically when spacing slider changes
spacingSlider.addEventListener('input', (e) => {
    panelManager.setSpacing(parseInt(e.target.value));
});
