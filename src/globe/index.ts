import { GlobeControls, TilesRenderer } from "3d-tiles-renderer";
import { TilesFadePlugin, UpdateOnChangePlugin, TileCompressionPlugin, UnloadTilesPlugin, GLTFExtensionsPlugin, GoogleCloudAuthPlugin, ReorientationPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three-stdlib";
import { Scene, PerspectiveCamera, WebGLRenderer } from "three";
import { TileCreasedNormalsPlugin } from "../plugins/TileCreasedNormalsPlugin";

class SkipLodPlugin {
    name: string;
    tiles: any;
	constructor() {
		this.name = 'SKIP_LOD_PLUGIN';
		this.tiles = null;
	}

	init(tiles) {
		this.tiles = tiles;

		// Mark tiles as refined when their children become visible
		tiles.addEventListener('tile-visibility-change', ({ tile, visible }) => {
			if (!tile.userData) tile.userData = {};

            if (!visible) return;

			const parent = tile.parent;
			if (parent) {
				parent.userData = parent.userData || {};
				parent.userData.wasRefined = true;
			}
		});
	}
    calculateTileViewError(tile, target) {
        if (tile.userData?.wasRefined) {
            // Prevent this tile from ever being traversed again
            target.inView = false;
            target.error = Infinity;
        }
    }
}

class GlobeClippingPlugin {
    name: string;
    tilesRenderer: any;
    clippingPlanes: any;

    constructor() {
        this.name = 'GLOBE_CLIPPING_PLUGIN';
        this.onLoadModel = this.onLoadModel.bind(this);
    }

    init(tilesRenderer) {
		this.tilesRenderer = tilesRenderer;
        this.tilesRenderer.addEventListener('load-model', this.onLoadModel);
    }

	applyClipping(clippingPlanes) {
        this.clippingPlanes = clippingPlanes;
		this.tilesRenderer.group.traverse(obj => {
			if (obj.isMesh && obj.material) {
				obj.material.clippingPlanes = clippingPlanes;
				obj.material.clipShadows = true;
				obj.material.needsUpdate = true;
			}
		});
	}

    onLoadModel({ scene }) {
        if (this.clippingPlanes) {
            this.tilesRenderer.group.traverse(obj => {
                if (obj.isMesh && obj.material) {
                    obj.material.clippingPlanes = this.clippingPlanes;
                    obj.material.clipShadows = true;
                    obj.material.needsUpdate = true;
                }
		    });
        }
	}

    dispose() {
		this.tilesRenderer?.removeEventListener('load-model', this.onLoadModel);
	}
}

export class Globe {
  scene: Scene;
  cameras: PerspectiveCamera[];
  renderer: WebGLRenderer;
  tiles: any;
//   controls: GlobeControls;
  private _initialInteractionPerformed: boolean = false;

  public tilesLoaded: Promise<void>;
  private _resolveTiles!: () => void;

  constructor(scene: Scene, cameras: PerspectiveCamera[], renderer: WebGLRenderer, disableControls: boolean = false) {
    this.tilesLoaded = new Promise(resolve => {
      this._resolveTiles = resolve;
    });

    this.scene = scene;
    this.cameras = cameras;
    this.renderer = renderer;

    this.tiles = new TilesRenderer();
    this.tiles.lruCache.maxSize = Infinity;
    this.tiles.lruCache.minSize = Infinity;
    this.tiles.lruCache.maxBytesSize = Infinity;
    this.tiles.lruCache.minBytesSize = Infinity;
    this.tiles.lruCache.unloadPercent = 0;

    this.tiles.registerPlugin(
      new GoogleCloudAuthPlugin({
        apiToken: import.meta.env.VITE_GOOGLE_MAPS_JS_API_KEY,
        autoRefreshToken: true,
      })
    );
    this.tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: new DRACOLoader().setDecoderPath("https://www.gstatic.com/draco/v1/decoders/"),
      })
    );
    this.tiles.registerPlugin(new TileCompressionPlugin());
    this.tiles.registerPlugin(new UpdateOnChangePlugin());
    this.tiles.registerPlugin(new UnloadTilesPlugin());
    this.tiles.registerPlugin(new TilesFadePlugin());
    
    this.tiles.addEventListener('load-model', () => {
      this._resolveTiles();
    });

    // this.tiles.registerPlugin(new SkipLodPlugin());
    // this.tiles.registerPlugin(new GlobeClippingPlugin());
    this.tiles.registerPlugin(new TileCreasedNormalsPlugin({creaseAngle:45}));

    this.tiles.setResolutionFromRenderer(this.cameras[0], this.renderer);
    this.tiles.setCamera(this.cameras[0]);

    this.tiles.maxScreenSpaceError = 0;
    this.tiles.lodUpdateStrategy = "all";
    this.tiles.downloadQueueMaxPriority = 10;
    this.tiles.errorTarget = 0.00001;
    this.tiles.maxDepth = Infinity;
    this.tiles.disposeInactiveTiles = true;
    // this.tiles.displayActiveTiles = true;
    this.tiles.onTileLoad = (tile) => {
        console.log(tile);
    };
  }

  update(): void {
    // console.log(
    //     'Pending preprocess jobs:', this.tiles.processNodeQueue.currJobs, 
    //     'Items:', this.tiles.processNodeQueue.items.length,
    //     'running:', this.tiles.processNodeQueue.scheduled,
    //     'MaxJobs:', this.tiles.processNodeQueue.maxJobs, 
    // );

    this.cameras.forEach(camera => {
        camera.updateMatrixWorld();
        this.tiles.setCamera(camera);
        this.tiles.setResolutionFromRenderer(camera, this.renderer);
        this.tiles.update();
    });
    this.updateAttributions();
  }

  updateAttributions(): void {
    const attributions = this.tiles.getAttributions()[0]?.value || "";
    const creditsElement = document.getElementById("credits");
    if (creditsElement) {
      creditsElement.innerText = attributions;
    } else {
      console.warn('Credits element not found in the DOM. Make sure an element with id="credits" exists.');
    }
  }
}
