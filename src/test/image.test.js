import { isImageFile, scaledDimensions, compressImage } from '../lib/image.js'

test('isImageFile accepts images, rejects others', () => {
  expect(isImageFile(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).toBe(true)
  expect(isImageFile(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(true)
  expect(isImageFile(new File(['x'], 'a.pdf', { type: 'application/pdf' }))).toBe(false)
  expect(isImageFile('not-a-file')).toBe(false)
})

test('scaledDimensions caps the longest edge and keeps aspect ratio', () => {
  expect(scaledDimensions(4000, 3000)).toEqual({ width: 1920, height: 1440 })
  expect(scaledDimensions(3000, 4000)).toEqual({ width: 1440, height: 1920 })
  expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
})

test('compressImage rejects non-image input', async () => {
  await expect(compressImage(new File(['x'], 'a.txt', { type: 'text/plain' }))).rejects.toThrow(
    'not-an-image',
  )
})
