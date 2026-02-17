import { useCallback, useEffect, useState } from 'react'

import { authController } from '../controllers/AuthController'
import type { LoginDto, RegisterDto, UpdateProfileDto, UserProfileDto } from '../dto/auth'
import { debugLog } from '../shared/lib/debug'
import type { ApiError } from '../shared/api/types'
import { clearAllUserCaches, invalidateSelfProfile, invalidateUserProfile } from '../shared/cache/cacheManager'

export type AuthState = {
  user: UserProfileDto | null
  loading: boolean
}

/**
 * Выполняет функцию `normalizeProfileImage`.
 * @param user Входной параметр `user`.
 * @returns Результат выполнения `normalizeProfileImage`.
 */

const normalizeProfileImage = (user: UserProfileDto): UserProfileDto => {
  if (!user.profileImage || user.profileImage.length === 0) {
    return { ...user, profileImage: null }
  }
  return user
}

/**
 * Управляет состоянием и эффектами хука `useAuth`.
 * @returns Результат выполнения `useAuth`.
 */

export const useAuth = () => {
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true })

  /**
   * Выполняет метод `useEffect`.
   * @param props Входной параметр `props`.
   * @returns Результат выполнения `useEffect`.
   */

  useEffect(() => {
    let active = true
    authController
      .ensureCsrf()
      .catch((err) => debugLog('CSRF fetch failed', err))
      .finally(() => {
        authController
          .getSession()
          .then((session) => {
            if (!active) return
            /**
             * Выполняет метод `setAuth`.
             * @param props Входной параметр `props`.
             * @returns Результат выполнения `setAuth`.
             */

            setAuth({ user: session.user, loading: false })
          })
          .catch((err) => {
            /**
             * Выполняет метод `debugLog`.
             * @param err Входной параметр `err`.
             * @returns Результат выполнения `debugLog`.
             */

            debugLog('Session fetch failed', err)
            if (!active) return
            /**
             * Выполняет метод `setAuth`.
             * @param props Входной параметр `props`.
             * @returns Результат выполнения `setAuth`.
             */

            setAuth({ user: null, loading: false })
          })
      })

    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (dto: LoginDto) => {
    await authController.ensureCsrf()
    const session = await authController.login(dto)
    /**
     * Выполняет метод `setAuth`.
     * @param props Входной параметр `props`.
     * @returns Результат выполнения `setAuth`.
     */

    setAuth({ user: session.user, loading: false })
    /**
     * Выполняет метод `clearAllUserCaches`.
     * @returns Результат выполнения `clearAllUserCaches`.
     */

    clearAllUserCaches()
    return session
  }, [])

  const register = useCallback(async (dto: RegisterDto) => {
    await authController.ensureCsrf()
    const session = await authController.register(dto)
    /**
     * Выполняет метод `setAuth`.
     * @param props Входной параметр `props`.
     * @returns Результат выполнения `setAuth`.
     */

    setAuth({ user: session.user, loading: false })
    /**
     * Выполняет метод `clearAllUserCaches`.
     * @returns Результат выполнения `clearAllUserCaches`.
     */

    clearAllUserCaches()
    return session
  }, [])

  const logout = useCallback(async () => {
    await authController.logout().catch(() => {})
    /**
     * Выполняет метод `setAuth`.
     * @param props Входной параметр `props`.
     * @returns Результат выполнения `setAuth`.
     */

    setAuth({ user: null, loading: false })
    /**
     * Выполняет метод `clearAllUserCaches`.
     * @returns Результат выполнения `clearAllUserCaches`.
     */

    clearAllUserCaches()
  }, [])

  const updateProfile = useCallback(async (dto: UpdateProfileDto) => {
    await authController.ensureCsrf()
    try {
      const { user } = await authController.updateProfile(dto)
      const normalizedUser = normalizeProfileImage(user)
      const previousUsername = auth.user?.username ?? null
      /**
       * Выполняет метод `setAuth`.
       * @returns Результат выполнения `setAuth`.
       */

      setAuth((prev) => ({ ...prev, user: normalizedUser }))
      /**
       * Выполняет метод `invalidateSelfProfile`.
       * @returns Результат выполнения `invalidateSelfProfile`.
       */

      invalidateSelfProfile()
      const usernamesToInvalidate = new Set([previousUsername, normalizedUser.username].filter(Boolean) as string[])
      usernamesToInvalidate.forEach((username) => invalidateUserProfile(username))
      return { user: normalizedUser }
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr && typeof apiErr.status === 'number' && apiErr.status === 401) {
        /**
         * Выполняет метод `setAuth`.
         * @param props Входной параметр `props`.
         * @returns Результат выполнения `setAuth`.
         */

        setAuth({ user: null, loading: false })
      }
      throw err
    }
  }, [auth.user])

  return {
    auth,
    login,
    register,
    logout,
    updateProfile,
  }
}

