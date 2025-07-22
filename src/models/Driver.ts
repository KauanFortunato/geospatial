import { Vector3, Sprite, Line, PerspectiveCamera, Quaternion } from "three";
import { Car } from "./Car";
import { tan } from "three/tsl";

export class Driver {
  name: string;
  img: string;
  acronym: string;
  driverNumber: number;
  nationality: string;
  position: number;
  points: number;
  interval?: string;
  car: Car;
  lap: number = 0;
  fastestLap: string = "1.30.237";
  label?: Sprite;
  line?: Line;
  camera: PerspectiveCamera;
  spacing?: number;
  private _intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(nome: string, img: string, acronym: string, driverNumber: number, nationality: string, position: number, points: number, car: Car, camera: PerspectiveCamera, spacing?: number) {
    this.name = nome;
    this.acronym = acronym;
    this.driverNumber = driverNumber;
    this.nationality = nationality;
    this.position = position;
    this.points = points;
    this.car = car;
    this.camera = camera;
    this.spacing = spacing;
    this.img = img;

    if(!this.interval) {
      if(this.position == 1) {
        this.interval = "Interval";
      } else {
        this.interval = generateRandomInterval();
      }
    }

    this.car.car.add(this.camera);
    if (this.camera) {
      this.camera.name = nome;
      this.car.car.add(this.camera);
      this.camera.up.copy(new Vector3(0, 0, 1));
      this.camera.position.set(-3, 0, 2); // Ajuste a posição da câmera conforme necessário
      this.camera.lookAt(new Vector3(5, -1, 4)); // A câmera olha para o carro
    }
  }

  updateLabel(camera: PerspectiveCamera, offset: Vector3) {
    const pos = this.car.car.position;
    const labelPos = pos.clone().add(offset);

    if (this.label) {
      this.label.position.copy(labelPos);
      this.label.quaternion.copy(camera.quaternion);
      this.label.updateMatrixWorld();
    }

    if (this.line) {
      this.line.geometry.setFromPoints([pos, labelPos]);
    }
  }

  hideLabel() {
    if (this.label) {
      this.label.visible = false;
    }
  }

  showLabel() {
    if (this.label) {
      this.label.visible = true;
    }
  }

  hideLine() {
    if (this.line) {
      this.line.visible = false;
    }
  }

  showLine() {
    if (this.line) {
      this.line.visible = true;
    }
  }

  positionOnTrack(tangent: Vector3, binormal: Vector3, normal: Vector3, position: Vector3) {
    this.car.setPosition(tangent, binormal, normal, position);
  }

  startIntervalFluctuation(origin = 2.0, range = 0.2, delay = 1000) {
    if(this.position == 1) {
      this.interval = "Interval";
      return;
    }
    
    const fluctuate = () => {
      const min = origin - range;
      const max = origin + range;
      const val = (Math.random() * (max - min) + min).toFixed(3);
      this.interval = `+${val}`;
    };

    fluctuate(); // primeira chamada
    this._intervalTimer = setInterval(fluctuate, delay);
  }

  stopIntervalFluctuation() {
    if (this._intervalTimer) {
      clearInterval(this._intervalTimer);
      this._intervalTimer = null;
    }
  }

  getIntervalValue(): number {
    if (!this.interval || this.interval === "Interval") return 0;
    
    const val = parseFloat(this.interval.replace("+", ""));
    return isNaN(val) ? 0 : val;
  }
}

function generateRandomInterval(): string {
  const value = Math.random() * 10; // valor entre 0 e 10
  const formatted = value.toFixed(3); // 3 casas decimais
  return `+${formatted}`;
}
