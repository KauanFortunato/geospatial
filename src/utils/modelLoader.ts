import { GLTFLoader, KTX2Loader, DRACOLoader } from "three/examples/jsm/Addons.js";
import { Object3D, Mesh, MeshStandardMaterial, AxesHelper, WebGLRenderer } from "three";
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Team } from "../models/Team";
import { Renderer } from "three/webgpu";

let ktx2LoaderInitialized = false;
const loader = new GLTFLoader();
const ktx2Loader = new KTX2Loader();
const dracoLoader = new DRACOLoader();
ktx2Loader.setTranscoderPath('/assets/basis/');
dracoLoader.setDecoderPath('/assets/draco/');
loader.setMeshoptDecoder(MeshoptDecoder);
loader.setKTX2Loader(ktx2Loader);
loader.setDRACOLoader(dracoLoader);

export function loadCarModel(path: string, team: Team, renderer: WebGLRenderer): Promise<Object3D> {
    if (!ktx2LoaderInitialized){
        ktx2Loader.detectSupport(renderer);
        ktx2LoaderInitialized = true;
    }
    return new Promise((resolve, reject) => {
        loader.load(
            path,
            (gltf) => {
                const model = gltf.scene;
                model.add(new AxesHelper(5));
                resolve(model);
            },
            undefined,
            (error) => reject(error)
        );
    });
}
