import axios from 'axios'

const STORAGE_KEY = 'ethra_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(STORAGE_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err: unknown) => {
    if (
      typeof err === 'object' &&
      err !== null &&
      'response' in err &&
      (err as { response?: { status?: number } }).response?.status === 401
    ) {
      localStorage.removeItem(STORAGE_KEY)
      window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)
