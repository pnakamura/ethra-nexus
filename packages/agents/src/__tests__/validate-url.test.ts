import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLookup = vi.fn()
vi.mock('node:dns/promises', () => ({
  lookup: mockLookup,
}))

const { validateExternalUrl, SecurityValidationError } = await import('@ethra-nexus/core')

describe('validateExternalUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects http:// (non-HTTPS)', async () => {
    await expect(validateExternalUrl('http://example.com')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects invalid URL', async () => {
    await expect(validateExternalUrl('not-a-url')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects 10.0.0.1 (private range)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    await expect(validateExternalUrl('https://internal.corp')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects 192.168.1.1 (private range)', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }])
    await expect(validateExternalUrl('https://router.local')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects 172.16.0.1 (private range)', async () => {
    mockLookup.mockResolvedValue([{ address: '172.16.0.1', family: 4 }])
    await expect(validateExternalUrl('https://internal.service')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects 127.0.0.1 (loopback)', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    await expect(validateExternalUrl('https://localhost')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('rejects 169.254.169.254 (link-local / AWS metadata)', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }])
    await expect(validateExternalUrl('https://metadata.internal')).rejects.toBeInstanceOf(SecurityValidationError)
  })

  it('accepts HTTPS URL resolving to public IP', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(validateExternalUrl('https://example.com')).resolves.toBeUndefined()
  })

  it('rejects https://10.0.0.1 (direct private IP in URL)', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])
    await expect(validateExternalUrl('https://10.0.0.1')).rejects.toBeInstanceOf(SecurityValidationError)
  })
})
