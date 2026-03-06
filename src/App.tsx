import { useState, useEffect } from "react";

interface City {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
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

// Helper function to convert weather code to emoji
function getWeatherEmoji(weatherCode: number, isDay: boolean): string {
  // Based on WMO Weather interpretation codes
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

// Helper to get gradient based on weather
function getGradient(
  weatherCode: number,
  isDay: boolean
): string {
  if (weatherCode === 0 && isDay) {
    // Clear/sunny day
    return "bg-gradient-to-br from-blue-400 to-yellow-300";
  } else if (weatherCode === 0 && !isDay) {
    // Clear night
    return "bg-gradient-to-br from-gray-800 to-purple-900";
  } else if ([1, 2, 3].includes(weatherCode)) {
    // Partly cloudy
    return "bg-gradient-to-br from-blue-300 to-gray-400";
  } else if ([45, 48, 51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) {
    // Rainy
    return "bg-gradient-to-br from-slate-500 to-blue-600";
  } else if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) {
    // Snowy
    return "bg-gradient-to-br from-cyan-200 to-blue-300";
  } else if ([95, 96, 99].includes(weatherCode)) {
    // Thunderstorm
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

  // Browser geolocation on startup
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setLocation({ latitude, longitude, isCurrent: true });
          fetchWeatherData(latitude, longitude);
        },
        () => {
          // Fallback to a default location (New York)
          setLocation({ latitude: 40.7128, longitude: -74.006, isCurrent: false });
          fetchWeatherData(40.7128, -74.006);
        }
      );
    }
  }, []);

  // Fetch weather data from Open-Meteo
  async function fetchWeatherData(lat: number, lon: number) {
    try {
      setLoading(true);
      setError("");

      // Fetch current weather
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=${isFahrenheit ? "fahrenheit" : "celsius"}&wind_speed_unit=kmh&forecast_days=8`
      );

      if (!weatherRes.ok) throw new Error("Failed to fetch weather");
      const data = await weatherRes.json();

      const current = data.current;
      setWeather({
        temperature: current.temperature_2m,
        humidity: current.relative_humidity_2m,
        windSpeed: current.wind_speed_10m,
        weatherCode: current.weather_code,
        isDay: current.is_day === 1,
        isFahrenheit,
      });

      // Process forecast
      const forecastData = data.daily.time.slice(1, 8).map((date: string, idx: number) => ({
        date,
        maxTemp: data.daily.temperature_2m_max[idx + 1],
        minTemp: data.daily.temperature_2m_min[idx + 1],
        weatherCode: data.daily.weather_code[idx + 1],
      }));

      setForecast(forecastData);

      // Try to get location name from reverse geocoding
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          setLocationName(geoData.address?.city || geoData.address?.town || "Unknown Location");
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

  // Search for cities
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
    } catch (err) {
      setSearchResults([]);
    }
  }

  // Select a city from search results
  function selectCity(city: City) {
    setLocation({ latitude: city.latitude, longitude: city.longitude, isCurrent: false });
    setLocationName(`${city.name}, ${city.country}`);
    setSearchQuery("");
    setSearchResults([]);
    fetchWeatherData(city.latitude, city.longitude);
  }

  // Toggle temperature unit
  function toggleUnit() {
    const newUnit = !isFahrenheit;
    setIsFahrenheit(newUnit);
    if (location) {
      fetchWeatherData(location.latitude, location.longitude);
    }
  }

  const gradient = weather
    ? getGradient(weather.weatherCode, weather.isDay)
    : "bg-gradient-to-br from-blue-400 to-blue-600";

  return (
    <div className={`min-h-screen ${gradient} transition-all duration-500 p-4 md:p-8`}>
      <div className="max-w-4xl mx-auto">
        {/* Header with title and toggle */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-white drop-shadow-lg">Weather</h1>
          <button
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
            <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur rounded-lg shadow-xl z-10">
              {searchResults.map((city) => (
                <button
                  key={city.id}
                  onClick={() => selectCity(city)}
                  className="w-full text-left px-6 py-3 hover:bg-blue-100 transition-colors text-gray-800 border-b last:border-b-0"
                >
                  {city.name}, {city.country}
                </button>
              ))}
            </div>
          )}
        </div>

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
