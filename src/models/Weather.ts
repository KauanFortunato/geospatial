export class Weather {
  time: string;
  temperature: number; // in Celsius
  humidity: number; // percentage
  sun: boolean;

  constructor(time: string, temperature: number, humidity: number, sun: boolean) {
    this.time = time;
    this.temperature = temperature;
    this.humidity = humidity;
    this.sun = sun;
  }
}
