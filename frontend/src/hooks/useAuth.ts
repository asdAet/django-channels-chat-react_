import { useCallback, useEffect, useState } from 'react'

import { authController } from '../controllers/AuthController'
import type { LoginDto, RegisterDto, UpdateProfileDto, UserProfileDto } from '../dto/auth'
import { debugLog } from '../shared/lib/debug'
import type { ApiError } from '../shared/api/types'
import { clearAllUserCaches, invalidateSelfProfile } from '../shared/cache/cacheManager'

export type AuthState = {
  user: UserProfileDto | null
  loading: boolean
}

const normalizeProfileImage = (user: UserProfileDto): UserProfileDto => {
  if (!user.profileImage || user.profileImage.length === 0) {
    return { ...user, profileImage: null }
  }
  return user
}

export const useAuth = () => {
  const [auth, setAuth] = useState<AuthState>({ user: null, loading: true })

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
            setAuth({ user: session.user, loading: false })
          })
          .catch((err) => {
            debugLog('Session fetch failed', err)
            if (!active) return
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
    setAuth({ user: session.user, loading: false })
    clearAllUserCaches()
    return session
  }, [])

  const register = useCallback(async (dto: RegisterDto) => {
    await authController.ensureCsrf()
    const session = await authController.register(dto)
    setAuth({ user: session.user, loading: false })
    clearAllUserCaches()
    return session
  }, [])

  const logout = useCallback(async () => {
    await authController.logout().catch(() => {})
    setAuth({ user: null, loading: false })
    clearAllUserCaches()
  }, [])

  const updateProfile = useCallback(async (dto: UpdateProfileDto) => {
    await authController.ensureCsrf()
    try {
      const { user } = await authController.updateProfile(dto)
      const normalizedUser = normalizeProfileImage(user)
      setAuth((prev) => ({ ...prev, user: normalizedUser }))
      invalidateSelfProfile()
      return { user: normalizedUser }
    } catch (err) {
      const apiErr = err as ApiError
      if (apiErr && typeof apiErr.status === 'number' && apiErr.status === 401) {
        setAuth({ user: null, loading: false })
      }
      throw err
    }
  }, [])

  return {
    auth,
    login,
    register,
    logout,
    updateProfile,
  }
}

