import { createStore } from 'vuex'
import weatherStore from '~/store/index.js'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(weatherStore)
})
