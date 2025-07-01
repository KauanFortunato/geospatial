import "../styles.css"; // Import the CSS file

import {
    Mesh,
    PCFSoftShadowMap,
    PerspectiveCamera,
    Scene,
    Vector3,
    Matrix4,
    WebGLRenderer,
    TextureLoader,
    Plane,
    AmbientLight,
    BoxGeometry,
    SphereGeometry,
    CatmullRomCurve3,
    CanvasTexture,
    SpriteMaterial,
    Group,
    Sprite,
    Line,
    LineBasicMaterial,
    BufferGeometry,
    InstancedMesh,
    MeshStandardMaterial,
    MeshBasicMaterial,
    ACESFilmicToneMapping,
    Box3,
    Quaternion,
    Raycaster,
    Sphere,
    Spherical,
    Vector2,
    Vector4,
    Clock,
    MathUtils,
    Euler,
    AxesHelper,
    CameraHelper,
    Color,
    ArrowHelper,
    Triangle,
    Matrix3,
    Object3D
} from "three";
import { XRButton } from "three/examples/jsm/Addons.js";
import { Globe } from "../globe";
import { Geodetic, radians } from "@takram/three-geospatial";
import { Team } from "../models/Team";
import { Driver } from "../models/Driver";
import { Car } from "../models/Car";
import CameraControls from "camera-controls";
import { loadCarModel } from "../utils/modelLoader";

const subsetOfTHREE = {
    Vector2: Vector2,
    Vector3: Vector3,
    Vector4: Vector4,
    Quaternion: Quaternion,
    Matrix4: Matrix4,
    Spherical: Spherical,
    Box3: Box3,
    Sphere: Sphere,
    Raycaster: Raycaster,
};

CameraControls.install({ THREE: subsetOfTHREE });

let controls: CameraControls;
let globalScale = 1;
let globe: Globe;
let renderer: WebGLRenderer;
let camera: PerspectiveCamera; let scene: Scene;
let trackCurve: CatmullRomCurve3 | null = null;
let trackTime = 0;
let currentFollowDriver: Driver | null = null;
let arPlacingGeomap = false;
let reticle: Mesh | null = null;
let hitTestSourceRequested = false;
let hitTestSource: XRHitTestSource | null = null;
let lodCameras: PerspectiveCamera[] = [];
const LOCAL_AXIS = new Vector3(0, 1, 0);
const globeContainer = new Group();
const initialPositions: Vector3[] = [];
const drivers: Driver[] = [];
const labelOffset = new Vector3(0, 0, 30);


let recorder;
const enableRecordingFeatures = false;
const showOrigin = false;
const showLodCamHelpers = false;
const useClipping = false;
const scale = 1 / 1700;
const longitude = -9.394761567056307; // degrees
const latitude = 38.75025825516866; // degrees
const numLodCamCols = 1;
const numLodCamRows = 1;
const lodCamFOV = 155;
const lodCamHeight = 350;
const lodCamAspectRatio = 1;
const rayOriginAlt = 10000;
const clock = new Clock();
let transform;

const centerECEF = new Geodetic(radians(longitude), radians(latitude), 0).toECEF().multiplyScalar(globalScale);
const cameraUp = centerECEF.clone().normalize();

const raycaster = new Raycaster();

const rawLLA = [
    [-9.392928078775599, 38.749255151676735, 188],
    [-9.392958428064668, 38.749343493902465, 188],
    [-9.392858320990218, 38.74938142433314, 188],
    [-9.392882174967271, 38.749474958015774, 188],
    [-9.392780327138661, 38.74951615683619, 188],
];

const cameraPositions: Vector3[] = [
    new Vector3(4914449.702275728, -812735.0475000107, 3970834.0878650616).multiplyScalar(globalScale),
    new Vector3(4914668.737085846, -813010.9913910049, 3971105.824077781).multiplyScalar(globalScale),
];

for (const [lon, lat, alt] of rawLLA) {
    const geo = new Geodetic(radians(lon), radians(lat), alt);
    initialPositions.push(geo.toECEF());
}

async function loadGPXasECEF(url: string): Promise<Vector3[]> {
    const res = await fetch(url);
    const text = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");
    const trkpts = xml.querySelectorAll("trkpt");

    const points: Vector3[] = [];

    trkpts.forEach((pt) => {
        const lat = parseFloat(pt.getAttribute("lat") || "0");
        const lon = parseFloat(pt.getAttribute("lon") || "0");

        const eleElem = pt.querySelector("ele");
        const alt = eleElem ? parseFloat(eleElem.textContent || "0") : 0;

        const geo = new Geodetic(radians(lon), radians(lat), alt + 50);
        points.push(geo.toECEF());
    });

    console.log("GPX Points:", points.length, points);
    return points;
}

function init(): void {
    setupGraphicsEngine();
    setupXR();
    setupLight();
    setupMainCamera(); // Setup main camera
    setupLODCameras(); // Setup LOD cameras - Hires LOD Camera force tiles to load at full resolution & detail.
    setupCameraControls();
    if (enableRecordingFeatures)
        setupRecordingFeatures();

    // Setup georeferenced globe
    globe = new Globe(scene, lodCameras, renderer, true);
    globeContainer.add(globe.tiles.group);
    scene.add(globeContainer);

    const enuMatrix = new Matrix4();
    globe.tiles.ellipsoid.getEastNorthUpFrame(MathUtils.degToRad(latitude), MathUtils.degToRad(longitude), enuMatrix);
    enuMatrix.multiply(new Matrix4().makeRotationFromEuler(new Euler(Math.PI / 2, Math.PI / 2, 0)));

    transform = enuMatrix.clone().invert();
    globe.tiles.group.applyMatrix4(transform); // Rotate and Position the lat/lon point on group container origin
    globeContainer.scale.setScalar(scale);  // Scale the group to the desired factor
    globeContainer.updateMatrixWorld(true); // Update internal matrix

    // Clipping planes of unit by unit, unit = 1m
    const unit = 0.9;
    const clippingPlanes = [
        new Plane(new Vector3(unit, 0, 0), unit / 2),  // left
        new Plane(new Vector3(-unit, 0, 0), unit / 2),  // right
        new Plane(new Vector3(0, 0, unit), unit / 2),  // front
        new Plane(new Vector3(0, 0, -unit), unit / 2),  // back
    ];
    if (useClipping)
        renderer.clippingPlanes = clippingPlanes;

    createDriversAndTeams();

    // Create drivers and teams
    const followContainer = document.getElementById("follow-buttons");
    drivers.forEach((driver) => {
        const btn = document.createElement("button");
        btn.textContent = `Seguir ${driver.acronym.toUpperCase()}`;
        btn.addEventListener("click", () => {
            if (currentFollowDriver === driver) {
                currentFollowDriver = null;
                driver.showLabel();
                driver.showLine();
                btn.textContent = `Seguir ${driver.acronym.toUpperCase()}`;
            } else {
                currentFollowDriver = driver;
                currentFollowDriver.hideLabel();
                currentFollowDriver.hideLine();

                document.querySelectorAll("#follow-buttons button").forEach((b) => {
                    b.textContent = `Seguir ${b.textContent?.split(" ")[1]}`;
                });
                btn.textContent = "Parar de Seguir";
            }
        });
        followContainer?.appendChild(btn);
    });

    window.addEventListener("resize", onWindowResize); // Handle window resize events

    // Load GPX data
    const gpxUrl = new URL("./estoril-peter-auto.gpx", import.meta.url).href;
    loadGPXasECEF(gpxUrl).then((points) => {
        if (points.length > 1) {
            console.log("GPX Points loaded:", points.length);
            trackCurve = new CatmullRomCurve3(points, false); // false = circuito aberto
        } else {
            console.warn("Nenhum ponto GPX carregado");
        }

        console.log("N points:", points.length);
        const geometry = new SphereGeometry(2);
        const material = new MeshStandardMaterial({ color: 0x00ff62 });
        const sphere = new InstancedMesh(geometry, material, points.length);
        for (let i = 0; i < points.length; i++) {
            sphere.setMatrixAt(i, new Matrix4().setPosition(points[i]));
        }
        // scene.add(sphere);
    });

    // Camera controls
    document.getElementById("camera-position-1")?.addEventListener("click", () => {
        // animateCameraTo(cameraPositions[0], cameraUp, centerECEF, 1500);

        if(enableRecordingFeatures)
            recorder.start();
    });

    document.getElementById("camera-position-2")?.addEventListener("click", () => {
        // animateCameraTo(cameraPositions[1], cameraUp, centerECEF, 1500);
        if(enableRecordingFeatures)
            recorder.stop();
    });


    if (showOrigin)
        scene.add(new AxesHelper(10));
}

function setupGraphicsEngine() {
    renderer = new WebGLRenderer({
        powerPreference: "high-performance",
        antialias: true,
        stencil: true,
        depth: true,
        alpha: !enableRecordingFeatures,
        logarithmicDepthBuffer: true,
        preserveDrawingBuffer: enableRecordingFeatures
    });
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const webContainer = document.getElementById("container");
    if (webContainer) {
        webContainer.appendChild(renderer.domElement);
    }
    
    scene = new Scene();
    if (enableRecordingFeatures)
        scene.background = new Color().setHex(0x00FF00);

    renderer.setAnimationLoop(onRender);
}

function setupXR() {
    renderer.xr.enabled = true;
    renderer.xr.addEventListener('sessionend', onSessionEnd);

    let xrButton = XRButton.createButton(renderer, {
        requiredFeatures: ['hit-test'],
        optionalFeatures: []
    });

    xrButton.addEventListener('click', onXRSession);
    document.body.appendChild(xrButton);

    const tLoader = new TextureLoader();
    reticle = new Mesh(
        new BoxGeometry(9.15 / 10, 6.10 / 10, 0.01).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ map: tLoader.load('assets/reticle.png'), transparent: true })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    renderer.xr.addEventListener('sessionstart', async () => {
        const session = renderer.xr.getSession();
        if (session && session.enabledFeatures) {
            console.log("Granted WebXR Features:", Array.from(session.enabledFeatures));

            if (session.enabledFeatures.includes('hit-test')) {
                if (hitTestSourceRequested === false) {
                    session.requestReferenceSpace('viewer').then(function (referenceSpace) {
                        // @ts-ignore
                        session.requestHitTestSource({ space: referenceSpace }).then(function (source) {
                            hitTestSource = source;
                        });
                    });

                    session.addEventListener('end', function () {
                        hitTestSource = null;
                        hitTestSourceRequested = false;
                    });
                    hitTestSourceRequested = true;
                }
            }
            session.addEventListener('select', onSelect);
        }
    });
}

function setupLight() {
    const ambientLight = new AmbientLight(0xffffff, 11);
    scene.add(ambientLight);
}

function setupMainCamera() {
    camera = new PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.01, 13000);
    camera.position.copy(new Vector3(0.2, 1.2, 0.5));
    camera.lookAt(new Vector3(0, 0, 0));
    camera.updateProjectionMatrix();
}

function setupLODCameras(heightRatio = 2) {
    const halfHeight = (lodCamHeight / heightRatio) * Math.tan(MathUtils.degToRad(lodCamFOV) / 2);  // tan45° = 1 → = 350
    const halfWidth = halfHeight * lodCamAspectRatio;           // rectangular footprint

    for (let i = 0; i < numLodCamCols; i++) {
        for (let j = 0; j < numLodCamRows; j++) {
            const x = (i - (numLodCamCols - 1) / 2) * (2 * halfWidth);
            const z = ((numLodCamRows - 1) / 2 - j) * (2 * halfHeight);
            const cam = new PerspectiveCamera(lodCamFOV, lodCamAspectRatio, 1, 500);
            cam.position.set(x, lodCamHeight, z);
            cam.lookAt(new Vector3(x, 0, z));
            cam.updateMatrixWorld();
            lodCameras.push(cam);
            globeContainer.add(cam);

            if (showLodCamHelpers) {
                let lodCamHelper = new CameraHelper(cam);
                scene.add(lodCamHelper);
            }
        }
    }
}

function setupCameraControls() {
    controls = new CameraControls(camera, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2;
}

function setupRecordingFeatures() {
    const stream = renderer.domElement.captureStream(30);

    // Using a WebM codec that supports alpha (VP8 or VP9)
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
    const chunks: BlobPart[] = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });

    recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
    };

    recorder.onstop = () => {
        // Assemble the final WebM blob
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Automatically download the content
        const a = document.createElement('a');
        a.href = url;
        a.download = 'transparent_capture.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
}

function createDriverLabel(text: string, color: string): Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "white";
    ctx.font = "bold 50px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(40, 10, 1);
    sprite.renderOrder = 999;
    return sprite;
}

function animateCameraTo(targetPos: Vector3, targetUp: Vector3, targetLookAt: Vector3, duration = 2000) {
    const startPos = camera.position.clone();
    const startUp = camera.up.clone();
    const startQuat = camera.quaternion.clone();

    // Criar uma câmera temporária para calcular a rotação final
    const tempCam = camera.clone();
    tempCam.position.copy(targetPos);
    tempCam.up.copy(targetUp);
    tempCam.lookAt(targetLookAt);
    tempCam.updateMatrixWorld();
    const targetQuat = tempCam.quaternion.clone();

    const startTime = performance.now();

    function update() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);

        // Interpolar posição e up
        camera.position.lerpVectors(startPos, targetPos, t);
        camera.up.lerpVectors(startUp, targetUp, t);
        camera.quaternion.slerpQuaternions(startQuat, targetQuat, t);

        camera.updateMatrixWorld();

        if (t < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

async function createDriversAndTeams() {
    // Create drivers and teams
    let redBull = new Team("Red Bull Racing", "#1E41FF");
    let mercedes = new Team("Mercedes-AMG Petronas", "#00D2BE");
    let ferrari = new Team("Scuderia Ferrari", "#DC0000");
    let mclaren = new Team("McLaren F1 Team", "#FF8700");

    const [rb20, mcl35m, sf23, c42] = await Promise.all([
        loadCarModel("../../public/assets/cars/RB20.glb", redBull, renderer),
        loadCarModel("../../public/assets/cars/MCL35M.glb", mclaren, renderer),
        loadCarModel("../../public/assets/cars/SF23.glb", ferrari, renderer),
        loadCarModel("../../public/assets/cars/C42.glb", mercedes, renderer),
    ]);

    let verstappen = new Driver("Max Verstappen", "ver", 1, "Netherlands", 1, 0, new Car(1, "RB20", rb20, redBull));
    let oscar = new Driver("Oscar Piastri", "pia", 81, "Australia", 7, 0, new Car(81, "MCL35M", mcl35m, mclaren));
    let hamilton = new Driver("Lewis Hamilton", "ham", 44, "United Kingdom", 3, 0, new Car(44, "SF23", sf23, ferrari));
    let kimi = new Driver("Kimi Räikkönen", "rak", 7, "Finland", 4, 0, new Car(7, "C42", c42, mercedes));

    verstappen.position = 1;
    oscar.position = 2;
    hamilton.position = 3;
    kimi.position = 4;

    // Set initial positions for the drivers
    // verstappen.positionOnTrack(initialPositions[verstappen.position]);
    // kimi.positionOnTrack(initialPositions[kimi.position]);
    // oscar.positionOnTrack(initialPositions[oscar.position]);
    // hamilton.positionOnTrack(initialPositions[hamilton.position]);

    // Add drivers to the scene
    drivers.push(hamilton, oscar, verstappen, kimi);

    drivers.forEach((driver) => {
        driver.label = createDriverLabel(driver.acronym.toUpperCase(), driver.car.team.color);
        globe.tiles.group.add(driver.label);

        const lineMaterial = new LineBasicMaterial({ color: 0xffffff });
        const lineGeometry = new BufferGeometry().setFromPoints([driver.car.car.position, driver.car.car.position.clone()]);
        driver.line = new Line(lineGeometry, lineMaterial);
        globe.tiles.group.add(driver.line);

        globe.tiles.group.add(driver.car.car);
    });

    renderScoreboard(drivers);
}

function getRaycastHit(x: number, z: number) {
    const rayOrigin = new Vector3(x, rayOriginAlt, z);
    const rayDirection = new Vector3(0, -1, 0);
    raycaster.set(rayOrigin, rayDirection);
    return raycaster.intersectObject(globe.tiles.group, false)[0];
}

function getSmoothHitNormal(hit) {
    const { face, object, point } = hit;
    const geom = object.geometry;
    const posAttr = geom.attributes.position;
    let normAttr = geom.attributes.normal;

    // ensure normals exist
    if (!normAttr) {
        geom.computeVertexNormals();
        normAttr = geom.attributes.normal;
    }

    // 1) pull the triangle’s three vertex positions
    const vA = new Vector3().fromBufferAttribute(posAttr, face.a);
    const vB = new Vector3().fromBufferAttribute(posAttr, face.b);
    const vC = new Vector3().fromBufferAttribute(posAttr, face.c);

    // 2) compute barycentric coords of the hit point
    const bary = new Vector3();
    Triangle.getBarycoord(point, vA, vB, vC, bary);

    // 3) pull the three vertex normals
    const nA = new Vector3().fromBufferAttribute(normAttr, face.a);
    const nB = new Vector3().fromBufferAttribute(normAttr, face.b);
    const nC = new Vector3().fromBufferAttribute(normAttr, face.c);

    // 4) interpolate them
    const interpolated = new Vector3()
        .set(0, 0, 0)
        .addScaledVector(nA, bary.x)
        .addScaledVector(nB, bary.y)
        .addScaledVector(nC, bary.z)
        .normalize();

    // 5) transform to world space
    object.updateMatrixWorld(true);
    const normalMatrix = new Matrix3().getNormalMatrix(object.matrixWorld);
    interpolated.applyMatrix3(normalMatrix).normalize();

    return interpolated;
}

function getHitAltitude(hit, compensation = 0.5){
    return (rayOriginAlt - hit.distance) / scale + compensation * scale;
}

function setObjectOnRoad(object: Object3D){
    // TODO
    // get object pos x, y
    // call getRaycastHit
    // get hit position, compensate car altitude approx: 0.5 / scale
    // get hit normal
    // apply normal and position
    //       const q = new THREE.Quaternion().setFromUnitVectors( LOCAL_AXIS, normalWS );
    //       object.quaternion.copy(q);
    //       object.position.copy(hitPointCompensated);
}

function renderScoreboard(drivers: Driver[]): void {
    const body = document.getElementById("scoreboard-body");
    if (!body) return;

    body.innerHTML = "";

    drivers.forEach((driver) => {
        const row = document.createElement("div");
        row.className = "driver-row";
        row.style.borderLeftColor = driver.car.team.color;

        row.innerHTML = `
      <p class="position">${driver.driverNumber}</p>
      <p class="acronym">-${driver.acronym.toLocaleUpperCase()}</p>
      <p class="interval">${driver.interval}</p>
      <div class="tire" style="background-color: ${driver.car.team.color};"></div>
    `;
        console.log("Driver:", driver.name, "Position:", driver.position, "Color:", driver.car.team.color);

        body.appendChild(row);
    });
}

function onRender(ts, frame): void {
    // if (globe.tiles.processNodeQueue.scheduled)
    //     console.log(
    //         'Pending preprocess jobs:', globe.tiles.processNodeQueue.currJobs, 
    //         'Items:', globe.tiles.processNodeQueue.items.length,
    //         'running:', globe.tiles.processNodeQueue.scheduled,
    //         'MaxJobs:', globe.tiles.processNodeQueue.maxJobs, 
    //     );

    if (!frame) {
        if (controls)
            controls.update(clock.getDelta());
        globe.update();
    }

    if (frame) {
        const referenceSpace = renderer.xr.getReferenceSpace();
        const session = renderer.xr.getSession();

        if (reticle && session?.enabledFeatures?.includes('hit-test')) {
            if (hitTestSource) {
                const hitTestResults = frame.getHitTestResults(hitTestSource);
                if (hitTestResults.length && arPlacingGeomap) {
                    const hit = hitTestResults[0];
                    reticle.visible = true;
                    // @ts-ignore
                    reticle.matrix.fromArray(hit.getPose(referenceSpace).transform.matrix);
                } else {
                    reticle.visible = false;
                }
            }
        }
    }

    if (renderer) {
        if (trackCurve && drivers.length > 0) {
            trackTime += 0.0003; //0.0003;
            if (trackTime > 1) trackTime = 0;

            // Add null check for trackCurve
            const spacing = 0.05;

            let driver = drivers[0];
            const t = (trackTime - 0 * spacing + 1) % 1;
            const pos = trackCurve?.getPointAt(t);
            const tan = trackCurve?.getTangentAt(t);

            if (pos && tan) {
                const posInWorld = globe.tiles.group.localToWorld(pos.clone());
                const hit = getRaycastHit(posInWorld.x, posInWorld.z);
                if (hit) {
                    const normal = getSmoothHitNormal(hit);
                    pos.y = getHitAltitude(hit, 0);
                    // console.log(pos.y);
                }
                console.log(globe.tiles.group.localToWorld(pos.clone()));
                driver.positionOnTrack(pos, tan);
                // console.log(driver.car.car.position);
                driver.updateLabel(camera, labelOffset);
            }
            // drivers.forEach((driver, index) => {
            // });
        }

        if (currentFollowDriver && trackCurve) {
            const pos = currentFollowDriver.car.car.position.clone().multiplyScalar(globalScale);
            const tangent = trackCurve.getTangentAt(trackTime);
            const up = pos.clone().normalize();
            const cameraOffset = tangent.clone().multiplyScalar(-30).add(up.clone().multiplyScalar(15)).multiplyScalar(globalScale);
            const cameraPos = pos.clone().add(cameraOffset);

            camera.position.copy(cameraPos);
            camera.up.copy(up);
            camera.lookAt(pos.clone().add(tangent.clone().multiplyScalar(10)));
        }

        renderer.render(scene, camera);
    }
}

function onWindowResize(): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onXRSession() {
    if (!renderer.xr.isPresenting) {
        arPlacingGeomap = true;
    }
}

function onSessionEnd() {
    arPlacingGeomap = false;
    // globe.tiles.group.visible = true;
    hitTestSourceRequested = false;
}

function onSelect(event) {
    if (reticle && reticle.visible) {
        const clippingPlugin = globe.tiles.getPluginByName('GLOBE_CLIPPING_PLUGIN');
        reticle.matrix.decompose(globeContainer.position, globeContainer.quaternion, globeContainer.scale);
        globeContainer.scale.setScalar(scale);
        globeContainer.updateMatrixWorld(true);

        //         const clippingPlanes = clippingPlugin.clippingPlanes.map(plane => plane.clone().applyMatrix4(globeContainer.matrixWorld));
        //         clippingPlugin.applyClipping(clippingPlanes);

        // const planeHelpers = clippingPlanes.map(p => new PlaneHelper(p, 1, 0x00ff00));
        // planeHelpers.forEach(helper => scene.add(helper));

        arPlacingGeomap = false;
    }
}

window.addEventListener("load", init);
