// U-4 (verified recipe modules) — weather generator (OpenWeatherMap + WeatherAPI).
//
// Real, working current-weather lookup generated into the app, Bring-Your-Own-keys (the user pastes their
// provider key into .env; NavBharatAI never stores it). Weather is behind delivery ETAs, travel and
// agri/logistics apps, dashboards and "what to wear" features. Each recipe is a SERVER helper (the key is a
// secret and must never reach the browser): getWeather(city) → { tempC, description, humidity }. Both
// providers are plain REST APIs called with the built-in fetch, so NO npm dependency is needed. PURE
// builders; the generated code is correct and complete — no TODO stubs (the real-features rule). Unit-tested.

export type WeatherProvider = 'openweathermap' | 'weatherapi';

export interface WeatherConfig {
  provider: WeatherProvider;
  files: Record<string, string>;
  envKeys: string[];
  /** Both providers use the global fetch against a REST API — no npm dependency. */
  dependency?: { name: string; version: string };
  instructions: string;
}

const ENV_EXAMPLE = '.env.example';

// ── OpenWeatherMap ───────────────────────────────────────────────────────────────────────────────────────
const OPENWEATHER_SERVER = `// Bring-Your-Own OpenWeatherMap key — openweathermap.org → API keys. Pasted into .env as OPENWEATHER_API_KEY.
// units=metric gives Celsius. Server secret; must never reach the browser.
const KEY = process.env.OPENWEATHER_API_KEY as string;

export interface Weather { tempC: number; description: string; humidity: number; }

// Current weather for a city (e.g. getWeather('Mumbai')). Returns null when the city is unknown or the API
// call fails, so a weather outage never breaks the app.
export async function getWeather(city: string): Promise<Weather | null> {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(city) + '&units=metric&appid=' + KEY;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    return { tempC: d.main.temp, description: d.weather?.[0]?.description ?? '', humidity: d.main.humidity };
  } catch {
    return null;
  }
}
`;

// ── WeatherAPI.com ───────────────────────────────────────────────────────────────────────────────────────
const WEATHERAPI_SERVER = `// Bring-Your-Own WeatherAPI key — weatherapi.com → dashboard. Pasted into .env as WEATHERAPI_KEY. Server
// secret; must never reach the browser.
const KEY = process.env.WEATHERAPI_KEY as string;

export interface Weather { tempC: number; description: string; humidity: number; }

// Current weather for a city (e.g. getWeather('Mumbai')). Returns null when the city is unknown or the API
// call fails, so a weather outage never breaks the app.
export async function getWeather(city: string): Promise<Weather | null> {
  try {
    const url = 'https://api.weatherapi.com/v1/current.json?key=' + KEY + '&q=' + encodeURIComponent(city);
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    return { tempC: d.current.temp_c, description: d.current.condition?.text ?? '', humidity: d.current.humidity };
  } catch {
    return null;
  }
}
`;

const OPENWEATHER_INSTRUCTIONS =
  'OpenWeatherMap wired. Paste your key into .env as OPENWEATHER_API_KEY — NavBharatAI never stores it. Import ' +
  "getWeather(city) in server code (e.g. getWeather('Mumbai')) — it returns { tempC, description, humidity } " +
  'or null on failure, so the app never breaks. The key stays server-side — call weather from your backend.';

const WEATHERAPI_INSTRUCTIONS =
  'WeatherAPI wired. Paste your key into .env as WEATHERAPI_KEY — NavBharatAI never stores it. Import ' +
  'getWeather(city) in server code — it returns { tempC, description, humidity } or null on failure, so the ' +
  'app never breaks. The key stays server-side — call weather from your backend, not the browser.';

export function generateWeatherIntegration(provider: WeatherProvider): WeatherConfig {
  if (provider === 'openweathermap') {
    return {
      provider,
      files: {
        'server/lib/weather.ts': OPENWEATHER_SERVER,
        [ENV_EXAMPLE]: 'OPENWEATHER_API_KEY=\n',
      },
      envKeys: ['OPENWEATHER_API_KEY'],
      instructions: OPENWEATHER_INSTRUCTIONS,
    };
  }
  return {
    provider,
    files: {
      'server/lib/weather.ts': WEATHERAPI_SERVER,
      [ENV_EXAMPLE]: 'WEATHERAPI_KEY=\n',
    },
    envKeys: ['WEATHERAPI_KEY'],
    instructions: WEATHERAPI_INSTRUCTIONS,
  };
}

export function isWeatherProvider(v: unknown): v is WeatherProvider {
  return v === 'openweathermap' || v === 'weatherapi';
}
