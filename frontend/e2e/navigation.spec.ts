import { expect, test } from '@playwright/test'

test('basic navigation between home and public chat', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Devil' })).toBeVisible()

  await page.getByRole('button', { name: 'Публичный чат' }).first().click()
  await expect(page).toHaveURL('/rooms/public')

  await page.getByRole('button', { name: 'Devil' }).click()
  await expect(page).toHaveURL('/')
})
