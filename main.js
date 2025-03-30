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

// --- Panel Manager ---
// Pass scene, camera, renderer DOM element, and initial grid config
const panelManager = new PanelManager(scene, camera, renderer.domElement, {
    gridUnitsX: 6,
    gridCellWidth: 2.0, // Width of a 1/6 panel unit in world space
    gridSpacingPx: 10 // Initial spacing in pixels
});

// --- Initial Panels (Prompt v1 Layout) ---
// Set initial spacing (calculates world units from pixels) using the value stored in panelManager
panelManager.setSpacing(panelManager.gridSpacingPx); // <<< FIX APPLIED HERE

panelManager.addPanel({ gridX: 0, gridY: 0, widthUnits: 6, title: 'Top Full Width' });
panelManager.addPanel({ gridX: 0, gridY: 1, widthUnits: 3, title: 'Left 1' });
panelManager.addPanel({ gridX: 3, gridY: 1, widthUnits: 3, title: 'Right 1' });
panelManager.addPanel({ gridX: 0, gridY: 2, widthUnits: 3, title: 'Left 2' });
panelManager.addPanel({ gridX: 3, gridY: 2, widthUnits: 3, title: 'Right 2' });
panelManager.addPanel({ gridX: 0
