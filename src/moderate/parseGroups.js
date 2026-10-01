export const MAX_GROUPS = 200
export const MAX_GROUP_NAME = 60

// One group name per line: trimmed, empties dropped, exact duplicates merged.
export function parseGroups(text) {
  const groups = [...new Set(text.split('\n').map((line) => line.trim()).filter(Boolean))]
  const errors = []
  const tooLong = groups.filter((g) => g.length > MAX_GROUP_NAME)
  if (tooLong.length) {
    errors.push(`Longer than ${MAX_GROUP_NAME} characters: ${tooLong.join(', ')}`)
  }
  if (groups.length > MAX_GROUPS) {
    errors.push(`At most ${MAX_GROUPS} groups are allowed (${groups.length} given)`)
  }
  return { groups, errors }
}
