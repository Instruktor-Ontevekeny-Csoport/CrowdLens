// Mirrors staff_rank() in the database; the UI gating is convenience only,
// RLS is the enforcement.
export const RANK = { moderator: 1, organizer: 2, admin: 3 }
export const ROLES = ['moderator', 'organizer', 'admin']

const REQUIRED = { moderate: RANK.moderator, settings: RANK.organizer, users: RANK.admin }

export function can(rank, action) {
  return rank >= (REQUIRED[action] ?? Infinity)
}

export function roleOf(rank) {
  return ROLES.find((r) => RANK[r] === rank) ?? null
}
