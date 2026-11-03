import { hash, verify } from '@node-rs/argon2'

// Argon2id with OWASP-recommended parameters (19 MiB memory, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 /* Argon2id */ } as const

export const PASSWORD_MIN_LENGTH = 12

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS)
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}

/** Returns an error message, or null if the password is acceptable. */
export function checkPasswordStrength(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  if (password.length > 200) return 'Password is too long.'
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  if (classes < 3) return 'Use at least three of: lowercase letters, uppercase letters, numbers, symbols.'
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Password must not contain your email name.'
  return null
}

// Used to keep login timing similar when the account does not exist.
let dummyHash: Promise<string> | null = null
export function getDummyHash() {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation')
  return dummyHash
}
