import { apiService } from '../adapters/ApiService'
import type { LoginRequestDto as LoginDto, RegisterRequestDto as RegisterDto, UpdateProfileRequestDto as UpdateProfileDto, SessionResponseDto as SessionDto } from '../dto'
import type { UserProfile as UserProfileDto } from '../entities/user/types'

/**
 * Описывает назначение класса AuthController.
 */

class AuthController {
  /**
   * Выполняет метод ensureCsrf.
   * @returns Результат выполнения ensureCsrf.
   */

  public async ensureCsrf(): Promise<{ csrfToken: string }> {
    return await apiService.ensureCsrf()
  }

  /**
   * Выполняет метод getSession.
   * @returns Результат выполнения getSession.
   */
  public async getSession(): Promise<SessionDto> {
    return await apiService.getSession()
  }

  /**
   * Выполняет метод login.
   * @param dto Входной параметр dto.
   * @returns Результат выполнения login.
   */

  public async login(dto: LoginDto): Promise<SessionDto> {
    return await apiService.login(dto.username, dto.password)
  }

  /**
   * Выполняет метод register.
   * @param dto Входной параметр dto.
   * @returns Результат выполнения register.
   */

  public async register(dto: RegisterDto): Promise<SessionDto> {
    return await apiService.register(dto.username, dto.password1, dto.password2)
  }

  /**
   * Выполняет метод getPasswordRules.
   * @returns Результат выполнения getPasswordRules.
   */

  public async getPasswordRules(): Promise<{ rules: string[] }> {
    return await apiService.getPasswordRules()
  }

  /**
   * Выполняет метод logout.
   * @returns Результат выполнения logout.
   */

  public async logout(): Promise<{ ok: boolean }> {
    return await apiService.logout()
  }

  /**
   * Выполняет метод updateProfile.
   * @param dto Входной параметр dto.
   * @returns Результат выполнения updateProfile.
   */

  public async updateProfile(dto: UpdateProfileDto): Promise<{ user: UserProfileDto }> {
    return await apiService.updateProfile(dto)
  }
}

export const authController = new AuthController()

