import type { AxiosInstance } from 'axios'

import { buildUpdateProfileRequestDto, decodeProfileEnvelopeResponse } from '../../dto'
import type { UpdateProfileInput } from '../../domain/interfaces/IApiService'
import type { UserProfile } from '../../entities/user/types'

/**
 * Обновляет профиль пользователя.
 * @param apiClient HTTP-клиент.
 * @param fields Поля формы профиля.
 * @returns Нормализованный профиль пользователя.
 */
export async function updateProfile(
  apiClient: AxiosInstance,
  fields: UpdateProfileInput,
): Promise<{ user: UserProfile }> {
  const dto = buildUpdateProfileRequestDto(fields)

  const form = new FormData()
  form.append('username', dto.username)
  form.append('email', dto.email)
  if (dto.image) {
    form.append('image', dto.image)
  }
  if (dto.bio !== undefined) {
    form.append('bio', dto.bio)
  }

  const response = await apiClient.post<unknown>('/auth/profile/', form)
  return decodeProfileEnvelopeResponse(response.data)
}