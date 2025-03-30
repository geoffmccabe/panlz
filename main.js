import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Optional: For camera control
import { Panel } from './Panel.js';
import { PanelManager } from './PanelManager.js';

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 15; // Adjust as needed

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Soft white light
scene.add(ambientLight);
const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4); // Sky/ground light
hemisphereLight.position.set(0, 20, 0);
scene.add(hemisphereLight);

// --- Background (Optional) ---
const textureLoader = new THREE.TextureLoader();
const bgTexture = textureLoader.load('path/to/your/background_texture.jpg'); // Replace with your texture
bgTexture.wrapS = THREE.RepeatWrapping;
bgTexture.wrapT = THREE.RepeatWrapping;
bgTexture.repeat.set(4, 4); // Adjust tiling
scene.background = bgTexture; // Or set a solid color: scene.background = new THREE.Color(0x333333);

// --- Panel Manager ---
const panelManager = new PanelManager(scene, camera, renderer.domElement);

// --- Initial Panels (Example) ---
panelManager.addPanel({ gridX: 0, gridY: 0, widthUnits: 2, heightUnits: 1, title: 'Panel Alpha' });
panelManager.addPanel({ gridX: 2, gridY: 0, widthUnits: 4, heightUnits: 1, title: 'Data Display' });
panelManager.addPanel({ gridX: 0, gridY: 1, widthUnits: 6, heightUnits: 1, title: 'Full Width Module' });

// --- Orbit Controls (Optional) ---
// const controls = new OrbitControls(camera, renderer.domElement);
// controls.enablePan = false; // Optional: restrict panning if needed
// controls.enableZoom = true;

// --- Resize Listener ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    panelManager.updateLayout(); // Recalculate layout on resize
}, false);

// --- Animation Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    panelManager.update(deltaTime); // Update panel animations (like jiggle)
    // controls?.update(); // Update controls if used

    renderer.render(scene, camera);
}

animate();

// --- Make PanelManager globally accessible (for UI interaction) ---
window.panelManager = panelManager;

// --- UI Event Listeners (Connect HTML UI to PanelManager) ---
const settingsPanel = document.getElementById('settings-panel');
const jsCodePopup = document.getElementById('js-code-popup');

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
    const spacing = parseInt(document.getElementById('panel-spacing').value);

    const settings = {
        cornerRadius,
        bevelSize,
        screenOpacity,
        textureFile: textureInput.files.length > 0 ? textureInput.files[0] : null,
    };

    panelManager.applySettings(panelId, settings, applyToAll);
    panelManager.setSpacing(spacing); // Apply spacing globally

    // Clear file input after applying
    textureInput.value = '';

    if (!applyToAll) { // Keep panel open if applying to all for further global changes
       settingsPanel.style.display = 'none';
    }
});

// Add listener for spacing slider to update layout dynamically (optional, can be performance intensive)
document.getElementById('panel-spacing').addEventListener('input', (e) => {
    panelManager.setSpacing(parseInt(e.target.value));
});
