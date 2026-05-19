import { createStore } from 'vuex'

const OWM_KEY = '4782343fb2a4465732d18b68d60ec6d2'
const BASE_URL = 'https://api.openweathermap.org/data/2.5'
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search'

function windDir(deg) {
  const dirs = ["северный","северо-восточный","восточный","юго-восточный","южный","юго-западный","западный","северо-западный"]
  return dirs[Math.round((deg ?? 0) / 45) % 8]
}

function getWindText(speed) {
  if (speed < 3) return 'тихий ветер'
  if (speed <= 5) return 'легкий ветер'
  if (speed <= 9) return 'умеренный ветер'
  if (speed <= 14) return 'сильный ветер'
  return 'шторм'
}

export default createStore({
  state: () => ({
    isDark: false,
    currentWeather: null,
    forecast: [],
    loading: false,
    error: null,
    city: 'Ташкент',
  }),

  getters: {
    isDark:          s => s.isDark,
    currentWeather:  s => s.currentWeather,
    forecast:        s => s.forecast,
    loading:         s => s.loading,
    error:           s => s.error,
    city:            s => s.city,
  },

  mutations: {
    TOGGLE_THEME(state) { state.isDark = !state.isDark },
    SET_DARK(state, v)  { state.isDark = v },
    SET_LOADING(state, v) { state.loading = v },
    SET_ERROR(state, m)   { state.error = m },
    SET_CURRENT(state, d) { state.currentWeather = d },
    SET_FORECAST(state, d) { state.forecast = d },
    SET_CITY(state, c) { 
      state.city = c
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('saved_city', c)
      }
    },
  },

  actions: {
    toggleTheme({ commit, state }) {
      commit('TOGGLE_THEME')
      if (typeof document !== 'undefined') {
        document.body.classList.toggle('dark', state.isDark)
        localStorage.setItem('theme', state.isDark ? 'dark' : 'light')
      }
    },

    initTheme({ commit }) {
      if (typeof localStorage === 'undefined') return
      const saved      = localStorage.getItem('theme')
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const isDark      = saved ? saved === 'dark' : prefersDark
      commit('SET_DARK', isDark)
      if (isDark) document.body.classList.add('dark')
    },

    async fetchWeather({ commit }, cityName) {
      if (!cityName) {
        cityName = typeof localStorage !== 'undefined' && localStorage.getItem('saved_city') 
          ? localStorage.getItem('saved_city') 
          : 'Ташкент'
      }
      commit('SET_LOADING', true)
      commit('SET_ERROR', null)

      try {
        // 1. Geocode location using Open-Meteo (much smarter at resolving countries/cities)
        const geoRes  = await fetch(`${GEO_URL}?name=${encodeURIComponent(cityName)}&count=1&language=ru&format=json`)
        const geoData = await geoRes.json()

        if (!geoData.results?.length) {
          throw new Error(`Город "${cityName}" не найден`)
        }

        const { latitude: lat, longitude: lon, name, country } = geoData.results[0]
        // Display the properly resolved name (e.g. if they type "Egypt", it will resolve correctly)
        const resolvedName = country && name !== country ? `${name}, ${country}` : name
        commit('SET_CITY', resolvedName)

        // 2. Fetch current weather from OpenWeatherMap using coordinates
        const curRes = await fetch(`${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric&lang=ru`)
        const curData = await curRes.json()

        if (curData.cod !== 200) {
          throw new Error(curData.message || "Ошибка сервера")
        }

        // Calculate pressure in mmHg (hPa * 0.75006)
        const pressureMm = Math.round(curData.main.pressure * 0.75006)
        const pressureText = pressureMm > 765 ? 'повышенное' : (pressureMm < 755 ? 'пониженное' : 'нормальное')
        
        let precipText = 'Без осадков'
        if (curData.rain && curData.rain['1h']) precipText = `${curData.rain['1h']} мм дождь`
        else if (curData.snow && curData.snow['1h']) precipText = `${curData.snow['1h']} мм снег`

        commit('SET_CURRENT', {
          name: name.toUpperCase(),
          weather: curData.weather,
          main: {
            temp: Math.round(curData.main.temp),
            feels_like: Math.round(curData.main.feels_like),
            humidity: curData.main.humidity,
            pressure: pressureMm,
            pressureText,
            precipText
          },
          wind: {
            speed: Math.round(curData.wind.speed),
            deg: curData.wind.deg
          },
          windDirText: windDir(curData.wind.deg),
          windSpeedText: getWindText(curData.wind.speed)
        })

        // 3. Fetch 5-day / 3-hour forecast using coordinates
        const fRes = await fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric&lang=ru`)
        const fData = await fRes.json()

        if (String(fData.cod) !== "200") {
          throw new Error(fData.message)
        }

        const dailyMap = {}
        for (const item of fData.list) {
          const date = item.dt_txt.split(' ')[0]
          if (!dailyMap[date]) {
            dailyMap[date] = {
              date: date,
              dt: item.dt,
              tempMax: item.main.temp_max,
              tempMin: item.main.temp_min,
              icon: item.weather[0].icon,
              description: item.weather[0].description
            }
          } else {
            dailyMap[date].tempMax = Math.max(dailyMap[date].tempMax, item.main.temp_max)
            dailyMap[date].tempMin = Math.min(dailyMap[date].tempMin, item.main.temp_min)
            
            // Prefer midday (12:00) forecast for general day icon
            if (item.dt_txt.includes('12:00:00')) {
              dailyMap[date].icon = item.weather[0].icon
              dailyMap[date].description = item.weather[0].description
            }
          }
        }

        const forecastArray = Object.values(dailyMap).slice(0, 7).map(d => ({
          date: d.date,
          dt: d.dt,
          temp: Math.round(d.tempMax),
          tempMin: Math.round(d.tempMin),
          description: d.description.charAt(0).toUpperCase() + d.description.slice(1),
          icon: d.icon.replace('n', 'd') 
        }))

        commit('SET_FORECAST', forecastArray)

      } catch (err) {
        commit('SET_ERROR', err.message || "Ошибка при получении данных")
      } finally {
        commit('SET_LOADING', false)
      }
    },
  },
})
