import { parseGroups, MAX_GROUPS, MAX_GROUP_NAME } from '../moderate/parseGroups.js'

test('trims lines and drops empty ones', () => {
  expect(parseGroups('  A \n\n B\n   \nC  ')).toEqual({ groups: ['A', 'B', 'C'], errors: [] })
  expect(parseGroups('')).toEqual({ groups: [], errors: [] })
})

test('dedupes case-sensitively, keeping the first occurrence', () => {
  expect(parseGroups('Maki\nmaki\nMaki\n Maki ').groups).toEqual(['Maki', 'maki'])
})

test('reports names that are too long', () => {
  const long = 'x'.repeat(MAX_GROUP_NAME + 1)
  const { groups, errors } = parseGroups(`ok\n${long}\n${'y'.repeat(MAX_GROUP_NAME)}`)
  expect(groups).toHaveLength(3)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain(long)
})

test('reports too many groups', () => {
  const names = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => `G${i}`)
  expect(parseGroups(names.slice(0, MAX_GROUPS).join('\n')).errors).toEqual([])
  const { errors } = parseGroups(names.join('\n'))
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain(String(MAX_GROUPS))
})
