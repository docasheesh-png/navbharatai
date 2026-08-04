import { describe, it, expect } from 'vitest';
import { generateWeatherIntegration, isWeatherProvider } from './WeatherGenerator';

describe('generateWeatherIntegration — OpenWeatherMap', () => {
  const c = generateWeatherIntegration('openweathermap');

  it('emits a server-only getWeather() that returns null on failure', () => {
    const server = c.files['server/lib/weather.ts'];
    expect(server).toContain('export async function getWeather(city: string)');
    expect(server).toContain('api.openweathermap.org/data/2.5/weather?q=');
    expect(server).toContain('units=metric'); // Celsius
    expect(server).toContain('return null'); // outage never breaks the app
    expect(server).toContain('OPENWEATHER_API_KEY');
    expect(c.files['src/lib/weather.ts']).toBeUndefined(); // server-side, no client file
  });

  it('needs no npm dependency, declares the key + blank .env.example', () => {
    expect(c.dependency).toBeUndefined();
    expect(c.envKeys).toEqual(['OPENWEATHER_API_KEY']);
    expect(c.files['.env.example']).toBe('OPENWEATHER_API_KEY=\n');
    expect(c.instructions).toContain('never stores');
  });
});

describe('generateWeatherIntegration — WeatherAPI', () => {
  const c = generateWeatherIntegration('weatherapi');

  it('emits getWeather() via WeatherAPI current.json', () => {
    const server = c.files['server/lib/weather.ts'];
    expect(server).toContain('api.weatherapi.com/v1/current.json?key=');
    expect(server).toContain('d.current.temp_c');
    expect(server).toContain('d.current.condition?.text');
    expect(c.envKeys).toEqual(['WEATHERAPI_KEY']);
    expect(c.dependency).toBeUndefined();
  });
});

describe('.env.example safety + provider guard', () => {
  it('.env.example carries NO real secret values (blank RHS only) for both providers', () => {
    for (const p of ['openweathermap', 'weatherapi'] as const) {
      const env = generateWeatherIntegration(p).files['.env.example'];
      for (const line of env.split('\n').filter(Boolean)) expect(line).toMatch(/=$/);
    }
  });

  it('isWeatherProvider accepts the two supported providers, rejects everything else', () => {
    expect(isWeatherProvider('openweathermap')).toBe(true);
    expect(isWeatherProvider('weatherapi')).toBe(true);
    expect(isWeatherProvider('accuweather')).toBe(false);
    expect(isWeatherProvider(undefined)).toBe(false);
  });
});
