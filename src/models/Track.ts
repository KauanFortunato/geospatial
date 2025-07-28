export class Track {
  trackTemperature: number; // in Celsius
  status: string; // e.g., "Dry"
  waterLevel: number; // in mm
  rubberLevel: string; // e.g., "Very Low"
  grip: string; // e.g., "Normal"

  constructor(
    trackTemperature: number,
    status: string,
    waterLevel: number,
    rubberLevel: string,
    grip: string
  ) {
    this.trackTemperature = trackTemperature;
    this.status = status;
    this.waterLevel = waterLevel;
    this.rubberLevel = rubberLevel;
    this.grip = grip;
  }
}
