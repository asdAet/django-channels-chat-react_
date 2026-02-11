import axios, { AxiosHeaders } from 'axios'
import type { AxiosError, AxiosInstance } from 'axios'

import type { ApiError } from '../shared/api/types'
import type { IApiService, UpdateProfileInput } from '../domain/interfaces/IApiService'

import { ensureCsrf as ensureCsrfRequest } from './apiService/ensureCsrf'
import { getSession } from './apiService/getSession'
import { login } from './apiService/login'
import { register } from './apiService/register'
import { logout } from './apiService/logout'
import { updateProfile } from './apiService/updateProfile'
import { getPasswordRules } from './apiService/getPasswordRules'
import { getPublicRoom } from './apiService/getPublicRoom'
import { getRoomDetails } from './apiService/getRoomDetails'
import { getRoomMessages } from './apiService/getRoomMessages'
import { getUserProfile } from './apiService/getUserProfile'

const API_BASE = '/api'

const CSRF_STORAGE_KEY = 'csrfToken'

const getCookie = (name: string) => {
  if (typeof document === 'undefined') return null
  return document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.split('=')[1]
}

const getStoredCsrf = () => {
  if (typeof sessionStorage === 'undefined') return null
  return sessionStorage.getItem(CSRF_STORAGE_KEY)
}

const getCsrfToken = () => getCookie('csrftoken') || getStoredCsrf()
const setCsrfToken = (token: string | null) => {
  if (typeof sessionStorage === 'undefined') return
  if (!token) {
    sessionStorage.removeItem(CSRF_STORAGE_KEY)
    return
  }
  sessionStorage.setItem(CSRF_STORAGE_KEY, token)
}


const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const normalizeErrorPayload = (payload: unknown): Record<string, unknown> | undefined => {
  if (!payload) return undefined
  if (typeof payload === 'string') {
    const parsed = parseJson(payload)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return { detail: payload }
  }
  if (typeof payload === 'object') {
    return payload as Record<string, unknown>
  }
  return undefined
}

const extractErrorMessage = (data?: Record<string, unknown>) => {
  if (!data) return undefined
  const errors = data.errors as Record<string, string[]> | undefined
  if (errors) {
    return Object.values(errors)
      .flat()
      .join(' ')
  }
  if (typeof data.error === 'string') return data.error
  if (typeof data.detail === 'string') return data.detail
  return undefined
}

const normalizeAxiosError = (error: unknown): ApiError => {
  if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
    return error as ApiError
  }

  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError
    const status = axiosError.response?.status ?? 0
    const data = normalizeErrorPayload(axiosError.response?.data)
    const message = extractErrorMessage(data) || axiosError.message || 'Request failed'
    return { status, message, data }
  }

  return { status: 0, message: 'Request failed' }
}

class ApiService implements IApiService {
  private apiClient: AxiosInstance

  public constructor() {
    this.apiClient = axios.create({
      baseURL: API_BASE,
      timeout: 10000,
      withCredentials: true,
    })

    this.apiClient.interceptors.request.use((config) => {
      const method = (config.method || 'get').toLowerCase()
      const headers = AxiosHeaders.from(config.headers)
      const hasBody = method !== 'get' && method !== 'head' && method !== 'options'
      const isFormData = typeof FormData !== 'undefined' && config.data instanceof FormData

      if (hasBody && !isFormData && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }

      if (hasBody && !headers.has('X-CSRFToken')) {
        const csrf = getCsrfToken()
        if (csrf) {
          headers.set('X-CSRFToken', csrf)
        }
      }

      if (isFormData) {
        headers.delete('Content-Type')
      }

      config.headers = headers
      return config
    })

    this.apiClient.interceptors.response.use(
      (response) => response,
      (error) => Promise.reject(normalizeAxiosError(error)),
    )
  }

  public async ensureCsrf(): Promise<{ csrfToken: string }> {
    const data = await ensureCsrfRequest(this.apiClient)
    setCsrfToken(data.csrfToken || null)
    return data
  }

  public async getSession() {
    return await getSession(this.apiClient)
  }

  public async login(username: string, password: string) {
    return await login(this.apiClient, username, password)
  }

  public async register(username: string, password1: string, password2: string) {
    return await register(this.apiClient, username, password1, password2)
  }

  public async getPasswordRules() {
    return await getPasswordRules(this.apiClient)
  }

  public async logout() {
    return await logout(this.apiClient)
  }

  public async updateProfile(fields: UpdateProfileInput) {
    return await updateProfile(this.apiClient, fields)
  }

  public async getPublicRoom() {
    return await getPublicRoom(this.apiClient)
  }

  public async getRoomDetails(slug: string) {
    return await getRoomDetails(this.apiClient, slug)
  }

  public async getRoomMessages(slug: string, params?: { limit?: number; beforeId?: number }) {
    return await getRoomMessages(this.apiClient, slug, params)
  }

  public async getUserProfile(username: string) {
    return await getUserProfile(this.apiClient, username)
  }
}


export const apiService = new ApiService()
