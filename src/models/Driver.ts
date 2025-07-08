import { Vector3, Sprite, Line, PerspectiveCamera } from "three";
import { Car } from "./Car";
import { tan } from "three/tsl";

export class Driver {
  name: string;
  acronym: string;
  driverNumber: number;
  nationality: string;
  position: number;
  points: number;
  interval?: NodeJS.Timeout;
  car: Car;
  label?: Sprite;
  line?: Line;

  constructor(nome: string, acronym: string, driverNumber: number, nationality: string, position: number, points: number, car: Car) {
    this.name = nome;
    this.acronym = acronym;
    this.driverNumber = driverNumber;
    this.nationality = nationality;
    this.position = position;
    this.points = points;
    this.car = car;
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

  positionOnTrack(posicao: Vector3, tangent: Vector3) {
    this.car.setPosition(posicao, tangent);
  }
}
