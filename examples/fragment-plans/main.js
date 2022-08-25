import Stats from 'stats.js/src/Stats';
import * as THREE from 'three'
import {
    Components,
    SimpleGrid,
    SimpleScene,
    SimpleDimensions,
    Fragments,
    SimpleRaycaster,
    PostproductionRenderer,
    ShadowDropper,
    PlanNavigator,
    EdgesClipper,
    EdgesPlane,
    OrthoPerspectiveCamera,
    ClippingEdges
} from 'openbim-components'
import {unzip} from "unzipit";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";

const container = document.getElementById('viewer-container');

const components = new Components();

components.scene = new SimpleScene(components);
const renderer = new PostproductionRenderer(components, container);
components.renderer = renderer;
renderer.postproduction.outlineColor = 0x999999;

const camera = new OrthoPerspectiveCamera(components);
components.camera = camera;
renderer.postproduction.setup(camera.controls);
// renderer.postproduction.active = true;

components.raycaster = new SimpleRaycaster(components);
components.init();


const scene = components.scene.getScene();
const shadows = new ShadowDropper(components);

const directionalLight = new THREE.DirectionalLight();
directionalLight.position.set(5, 10, 3)
directionalLight.intensity = 0.5;
scene.add(directionalLight)

const ambientLight = new THREE.AmbientLight();
ambientLight.intensity = 0.5;
scene.add(ambientLight)

// Add some components
// const grid = new SimpleGrid(components);
// components.tools.add(grid);
// renderer.postproduction.excludedItems.add(grid.grid);

const clipper = new EdgesClipper(components, EdgesPlane);
components.tools.add(clipper)

const dimensions = new SimpleDimensions(components);
components.tools.add(dimensions)

// Set up stats
const stats = new Stats();
stats.showPanel(2);
document.body.append(stats.dom);
stats.dom.style.right = '0px';
stats.dom.style.left = 'auto';

components.renderer.onStartRender.on(() => stats.begin());
components.renderer.onFinishRender.on(() => stats.end());

const fragments = new Fragments(components);
loadFragments();

async function loadFragments() {
    const {entries} = await unzip('../models/medium.zip');

    const fileNames = Object.keys(entries);

    const modelTypes = await entries['model-types.json'].json();
    const allTypes = await entries['all-types.json'].json();

    const thickTypes = ["IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCSTAIRFLIGHT", "IFCSTAIR", "IFCROOF", "IFCFOOTING",
    "IFCCOLUMN", "IFCBEAM"];

    const thickItems = [];
    const thinItems = [];

    for (let i = 0; i < fileNames.length; i++) {

        const name = fileNames[i];
        if (!name.includes('.glb')) continue;

        // Load data
        const geometryName = fileNames[i];
        const geometry = await entries[geometryName].blob();
        const geometryURL = URL.createObjectURL(geometry);

        const dataName = geometryName.substring(0, geometryName.indexOf('.glb')) + '.json';
        const dataBlob = await entries[dataName].blob();
        const data = await entries[dataName].json();

        const dataURL = URL.createObjectURL(dataBlob);

        const fragment = await fragments.load(geometryURL, dataURL);

        const lines = fragments.edges.generate(fragment);
        lines.removeFromParent();

        const firstID = data.ids[0];
        const categoryID = modelTypes[firstID];
        const category = allTypes[categoryID];
        if(thickTypes.includes(category)) thickItems.push(fragment.mesh);
        else thinItems.push(fragment.mesh);

    }

    // Clipping edges

    ClippingEdges.initialize(components);
    await ClippingEdges.newStyleFromMesh('thick', thickItems, new LineMaterial({
        color: 0x333333,
        linewidth: 0.002,
    }));

    await ClippingEdges.newStyleFromMesh('thin', thinItems, new LineMaterial({
        color: 0x333333,
        linewidth: 0.001,
    }));

    // Floor plans

    let wasFloorplanActive = false;

    const baseMaterial = new THREE.MeshBasicMaterial();
    const backgroundColor = scene.background;
    const whiteColor = new THREE.Color(0xffffff);

    const levelsProperties = await entries['levels-properties.json'].json();
    const floorNav = new PlanNavigator(clipper, camera);
    const levelContainer = document.getElementById('plan-container');
    const levelOffset = 1.5;

    for (const levelProps of levelsProperties) {
        const elevation = levelProps.Elevation.value + levelOffset;

        // Create floorplan
        await floorNav.create({
            id: levelProps.expressID,
            ortho: true,
            normal: new THREE.Vector3(0, -1, 0),
            point: new THREE.Vector3(0, elevation, 0),
            data: {name: levelProps.Name.value},
            rotation: 0
        });

        // Create GUI for navigation
        const button = document.createElement('button');
        button.textContent = levelProps.Name.value;
        levelContainer.appendChild(button);

        button.onclick = async () => {
            if(!wasFloorplanActive) {
                toggleEdges(true);
                scene.background = whiteColor;
            }

            fragments.materials.apply(baseMaterial);
            await floorNav.goTo(levelProps.expressID);
            fragments.culler.needsUpdate = true;
            fragments.culler.updateVisibility();

            wasFloorplanActive = true;
        }
    }

    // Create GUI for exiting floor plan navigation
    const exitButton = document.createElement('button');
    exitButton.textContent = "Exit";
    levelContainer.appendChild(exitButton);

    exitButton.onclick = async () => {
        fragments.materials.reset();
        await floorNav.exitPlanView();
        fragments.culler.needsUpdate = true;
        fragments.culler.updateVisibility();

        wasFloorplanActive = false;
        toggleEdges(false);
        scene.background = backgroundColor;
    }
}

function toggleEdges(visible) {
    const edges = Object.values(fragments.edges.edgesList);
    for(const edge of edges) {
        if(visible) scene.add(edge);
        else edge.removeFromParent();
    }
}