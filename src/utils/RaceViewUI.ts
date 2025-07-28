import { Weather } from '../models/Weather';
import { Track } from '../models/Track';

export class RaceViewUI {
  updateWeatherUI(weather: Weather): void {
    const timeEl = document.querySelector('#weather-conditions .top-bar p')!;
    const tempEl = document.querySelector('#weather-conditions .body-conditions p')!;
    const humidityEl = document.querySelector('.humidity p')!;

    timeEl.textContent = weather.time;
    tempEl.textContent = `${weather.temperature.toFixed(1)}°C`;
    humidityEl.textContent = `${weather.humidity}%`;

    // Optional: Update sun/cloud icon dynamically based on weather.sun
    const icon = document.querySelector('#weather-conditions .body-conditions svg')!;
    icon.setAttribute('class', weather.sun ? 'bi bi-brightness-low-fill' : 'bi bi-cloud-fill');
  }

  updateTrackUI(track: Track): void {
    const trackTempEl = document.querySelector('#track-conditions .body-conditions p')!;
    const statusEl = document.querySelectorAll('#track-conditions .info-item p')[0];
    const waterEl = document.querySelectorAll('#track-conditions .info-item p')[1];
    const rubberEl = document.querySelectorAll('#track-conditions .info-item div p')[0];
    const gripEl = document.querySelectorAll('#track-conditions .info-item p')[3];

    trackTempEl.textContent = `${track.trackTemperature.toFixed(1)}°C`;
    statusEl.textContent = track.status;
    waterEl.textContent = `${track.waterLevel.toFixed(2)} mm`;
    rubberEl.textContent = track.rubberLevel;
    gripEl.textContent = track.grip;
  }

  updateInterface(weather: Weather, track: Track): void {
    this.updateWeatherUI(weather);
    this.updateTrackUI(track);
  }
}
