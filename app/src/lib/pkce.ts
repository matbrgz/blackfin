export interface IPKCEParameters {
  readonly codeVerifier: string
  readonly codeChallenge: string
}

export async function generatePKCEParameters(): Promise<IPKCEParameters> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const codeVerifier = base64URLEncode(randomBytes)

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier)
  )
  const codeChallenge = base64URLEncode(new Uint8Array(digest))

  return { codeVerifier, codeChallenge }
}

function base64URLEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}
