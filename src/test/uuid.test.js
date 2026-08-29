import { randomUUID } from '../lib/uuid.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('produces v4 UUIDs', () => {
  expect(randomUUID()).toMatch(UUID_V4)
})

test('fallback path works without crypto.randomUUID (insecure context)', () => {
  const original = crypto.randomUUID
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
  try {
    const a = randomUUID()
    const b = randomUUID()
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  } finally {
    Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
  }
})
