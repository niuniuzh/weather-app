import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface City {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
}

interface CachedCity extends City {
  admin1?: string;
}

interface WeatherData {
  temperature: number;
  humidity: number;
  windSpeed: number;
  weatherCode: number;
  isDay: boolean;
  isFahrenheit: boolean;
}

interface ForecastDay {
  date: string;
  maxTemp: number;
  minTemp: number;
  weatherCode: number;
}

interface LocationData {
  latitude: number;
  longitude: number;
  isCurrent: boolean;
}

interface CachedWeatherData {
  city: CachedCity;
  weather_json: string;
  timestamp: number;
}

function getWeatherEmoji(weatherCode: number, isDay: boolean): string {
  if (weatherCode === 0) return isDay ? "☀️" : "🌙";
  if (weatherCode === 1 || weatherCode === 2) return "🌤️";
  if (weatherCode === 3) return "☁️";
  if (weatherCode === 45 || weatherCode === 48) return "🌫️";
  if ([51, 53, 55, 61, 63, 65, 71, 73, 75, 77, 80, 81, 82].includes(weatherCode))
    return "🌧️";
  if ([80, 81, 82].includes(weatherCode)) return "⛈️";
  if ([85, 86].includes(weatherCode)) return "🌨️";
  if ([95, 96, 99].includes(weatherCode)) return "⛈️";
  return "🌤️";
}

function getGradient(weatherCode: number, isDay: boolean): string {
  if (weatherCode === 0 && isDay) {
    return "bg-gradient-to-br from-blue-400 to-yellow-300";
  } else if (weatherCode === 0 && !isDay) {
    return "bg-gradient-to-br from-gray-800 to-purple-900";
  } else if ([1, 2, 3].includes(weatherCode)) {
    return "bg-gradient-to-br from-blue-300 to-gray-400";
  } else if ([45, 48, 51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
    return "bg-gradient-to-br from-slate-500 to-blue-600";
  } else if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    return "bg-gradient-to-br from-cyan-200 to-blue-300";
  } else if ([95, 96, 99].includes(weatherCode)) {
    return "bg-gradient-to-br from-gray-800 to-purple-700";
  }

  return "bg-gradient-to-br from-blue-400 to-blue-600";
}

function App() {
  const [location, setLocation] = useState<LocationData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<City[]>([]);
  const [isFahrenheit, setIsFahrenheit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [locationName, setLocationName] = useState("Loading...");
  const [cachedCities, setCachedCities] = useState<CachedWeatherData[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  // Browser geolocation on startup
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setLocation({ latitude, longitude, isCurrent: true });
        },
        () => {
          // Fallback to NYC
          setLocation({ latitude: 40.7128, longitude: -74.006, isCurrent: false });
        }
      );
    }
    loadCachedCities();
  }, []);

  // Centralized fetch on location or unit change
  useEffect(() => {
    if (location) {
      fetchWeatherData(location.latitude, location.longitude);
    }
  }, [location, isFahrenheit]);

  async function fetchWeatherData(lat: number, lon: number) {
    try {
      setLoading(true);
      setError("");

      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=${isFahrenheit ? "fahrenheit" : "celsius"}&wind_speed_unit=kmh&forecast_days=8`
      );

      if (!weatherRes.ok) throw new Error("Failed to fetch weather");
      const data = await weatherRes.json();

      const current = data.current;
      const weatherData: WeatherData = {
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        weatherCode: current.weather_code,
        isDay: current.is_day === 1,
        isFahrenheit,
      };
      setWeather(weatherData);

      const forecastData = data.daily.time.slice(1, 8).map((date: string, idx: number) => ({
        date,
        maxTemp: data.daily.temperature_2m_max[idx + 1],
        minTemp: data.daily.temperature_2m_min[idx + 1],
        weatherCode: data.daily.weather_code[idx + 1],
      }));
      setForecast(forecastData);

      // Get location name and cache if from a searched city
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          const city_name = geoData.address?.city || geoData.address?.town || "Unknown Location";
          setLocationName(city_name);
        }
      } catch {
        setLocationName("Unknown Location");
      }

      setLoading(false);
    } catch (err) {
      setError("Failed to load weather data");
      setLoading(false);
    }
  }

  async function loadCachedCities() {
    try {
      const cached = await invoke<CachedWeatherData[]>("get_cached");
      setCachedCities(cached);
    } catch (err) {
      console.error("Failed to load cached cities:", err);
    }
  }

  async function selectCity(city: City) {
    setLocation({ latitude: city.latitude, longitude: city.longitude, isCurrent: false });
    setSearchQuery("");
    setSearchResults([]);
  }

  async function handleCitySearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en`
      );
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch {
      setSearchResults([]);
    }
  }

  async function handleCacheCity(city: City) {
    if (!weather) return;

    try {
      const cachedCity: CachedCity = {
        id: city.id,
        name: city.name,
        latitude: city.latitude,
        longitude: city.longitude,
        country: city.country,
        admin1: city.admin1,
      };

      const weatherJson = JSON.stringify(weather);
      await invoke("upsert_cached", { city: cachedCity, weatherJson });
      await loadCachedCities();
    } catch (err) {
      console.error("Failed to cache city:", err);
    }
  }

  async function removeCachedCity(cachedData: CachedWeatherData) {
    try {
      await invoke("remove_cached", {
        id: cachedData.city.id,
        latitude: cachedData.city.latitude,
        longitude: cachedData.city.longitude,
      });
      await loadCachedCities();
    } catch (err) {
      console.error("Failed to remove cached city:", err);
    }
  }

  async function loadCachedCity(cachedData: CachedWeatherData) {
    setLocation({
      latitude: cachedData.city.latitude,
      longitude: cachedData.city.longitude,
      isCurrent: false,
    });
    setLocationName(`${cachedData.city.name}, ${cachedData.city.country}`);
  }

  function toggleUnit() {
    setIsFahrenheit(!isFahrenheit);
  }

  const gradient = weather
    ? getGradient(weather.weatherCode, weather.isDay)
    : "bg-gradient-to-br from-blue-400 to-blue-600";

  return (
    <div className={`min-h-screen ${gradient} transition-all duration-500 p-4 md:p-8`}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg">Weather</h1>
          <button
            type="button"
            onClick={toggleUnit}
            className="bg-white/20 hover:bg-white/30 text-white px-6 py-2 rounded-full font-semibold backdrop-blur transition-all"
          >
            {isFahrenheit ? "°F" : "°C"}
          </button>
        </div>

        {/* Search bar */}
        <div className="relative mb-8">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleCitySearch(e.target.value)}
            placeholder="Search for a city..."
            className="w-full px-6 py-3 rounded-full bg-white/90 backdrop-blur text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-white shadow-lg"
          />
          {/* Search results dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur rounded-lg shadow-xl z-10 max-h-72 overflow-y-auto">
              {searchResults.map((city) => (
                <div
                  key={`${city.id}_${city.latitude}_${city.longitude}`}
                  className="flex items-center justify-between px-6 py-4 hover:bg-blue-100 transition-colors border-b last:border-b-0"
                >
                  <div className="flex-1 text-left">
                    <div className="text-gray-800 font-medium">
                      {city.name}
                      {city.admin1 && <span className="text-gray-600 text-sm"> - {city.admin1}</span>}
                    </div>
                    <div className="text-gray-600 text-xs">
                      {city.country} • {city.latitude.toFixed(2)}, {city.longitude.toFixed(2)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectCity(city)}
                    className="ml-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
                  >
                    Load
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History Panel */}
        {cachedCities.length > 0 && (
          <div className="mb-8 bg-white/10 backdrop-blur rounded-3xl overflow-hidden shadow-2xl">
            <button
              type="button"
              onClick={() => setHistoryExpanded(!historyExpanded)}
              className="w-full px-8 py-4 flex justify-between items-center hover:bg-white/20 transition-colors"
            >
              <h3 className="text-white text-xl font-bold">
                History ({cachedCities.length})
              </h3>
              <span className="text-white text-2xl">{historyExpanded ? "▼" : "▶"}</span>
            </button>

            {historyExpanded && (
              <div className="px-8 py-4 border-t border-white/20 space-y-3">
                {cachedCities.map((cached) => (
                  <div
                    key={`${cached.city.id}_${cached.city.latitude}_${cached.city.longitude}`}
                    className="flex items-center justify-between bg-white/10 rounded-2xl p-4 hover:bg-white/20 transition-colors"
                  >
                    <div className="flex-1">
                      <p className="text-white font-medium">
                        {cached.city.name}
                        {cached.city.admin1 && <span className="text-white/70 text-sm"> - {cached.city.admin1}</span>}
                      </p>
                      <p className="text-white/60 text-xs">
                        {new Date(cached.timestamp * 1000).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        type="button"
                        onClick={() => loadCachedCity(cached)}
                        className="px-3 py-2 bg-green-500/70 hover:bg-green-600 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLocation({
                            latitude: cached.city.latitude,
                            longitude: cached.city.longitude,
                            isCurrent: false,
                          });
                        }}
                        className="px-3 py-2 bg-blue-500/70 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCachedCity(cached)}
                        className="px-3 py-2 bg-red-500/70 hover:bg-red-600 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="text-center text-white text-xl">Loading weather data...</div>
        )}

        {error && (
          <div className="text-center text-white text-lg bg-red-500/50 p-4 rounded-lg">
            {error}
          </div>
        )}

        {weather && (
          <>
            {/* Current weather card */}
            <div className="bg-white/10 backdrop-blur rounded-3xl p-8 md:p-12 mb-8 shadow-2xl">
              <h2 className="text-white/80 text-lg mb-2">{locationName}</h2>

              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-7xl md:text-8xl font-bold text-white drop-shadow-lg">
                    {Math.round(weather.temperature)}°
                  </div>
                  <p className="text-white/80 text-2xl mt-2">
                    {getWeatherEmoji(weather.weatherCode, weather.isDay)} Clear Sky
                  </p>
                </div>

                <div className="text-5xl">{getWeatherEmoji(weather.weatherCode, weather.isDay)}</div>
              </div>

              {/* Weather details grid */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-white/10 rounded-2xl p-6">
                  <p className="text-white/60 text-sm mb-2">Humidity</p>
                  <p className="text-white text-3xl font-semibold">{weather.humidity}%</p>
                </div>
                <div className="bg-white/10 rounded-2xl p-6">
                  <p className="text-white/60 text-sm mb-2">Wind Speed</p>
                  <p className="text-white text-3xl font-semibold">{Math.round(weather.windSpeed)} km/h</p>
                </div>
              </div>

              {/* Cache button */}
              <button
                type="button"
                onClick={() => handleCacheCity({
                  id: Math.floor(Math.random() * 1000000),
                  name: locationName.split(",")[0],
                  latitude: location!.latitude,
                  longitude: location!.longitude,
                  country: locationName.includes(",") ? locationName.split(",")[1].trim() : "",
                })}
                className="mt-6 w-full px-6 py-3 bg-purple-500/70 hover:bg-purple-600 text-white rounded-lg font-semibold transition-colors"
              >
                Save to Cache
              </button>
            </div>

            {/* 7-day forecast */}
            {forecast.length > 0 && (
              <div className="bg-white/10 backdrop-blur rounded-3xl p-8 shadow-2xl">
                <h3 className="text-white text-2xl font-bold mb-6">7-Day Forecast</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
                  {forecast.map((day, idx) => (
                    <div
                      key={idx}
                      className="bg-white/10 rounded-2xl p-4 text-center hover:bg-white/20 transition-all"
                    >
                      <p className="text-white/80 text-sm font-semibold mb-3">
                        {new Date(day.date).toLocaleDateString("en-US", {
                          weekday: "short",
                        })}
                      </p>
                      <p className="text-3xl mb-3">{getWeatherEmoji(day.weatherCode, true)}</p>
                      <p className="text-white font-semibold">
                        {Math.round(day.maxTemp)}° / {Math.round(day.minTemp)}°
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
