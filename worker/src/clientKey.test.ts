import { describe, expect, it } from 'vitest'
import { clientKey } from './clientKey'

describe('clientKey', () => {
  it('keys an IPv4 client on its full address', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey(' 203.0.113.7 ')).toBe('203.0.113.7')
    expect(clientKey('203.0.113.8')).not.toBe(clientKey('203.0.113.7'))
  })

  it('keys an IPv4-mapped IPv6 client on the IPv4 address, in either notation', () => {
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey('::FFFF:cb00:7107')).toBe('203.0.113.7')
    expect(clientKey('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7')
  })

  it('keys an IPv6 client on its /64: addresses in one share a key, another /64 does not', () => {
    const a = clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')
    expect(a).toBe('2001:db8:1:2::/64')
    expect(clientKey('2001:DB8:1:2::1')).toBe(a)
    expect(clientKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(a)
    expect(clientKey('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe(a)
    expect(clientKey('2001:db8:1:3::1')).not.toBe(a)
    expect(clientKey('2001:db8:2:2::1')).not.toBe(a)
  })

  it('expands :: wherever it sits', () => {
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
    expect(clientKey('::')).toBe('0:0:0:0::/64')
    expect(clientKey('2001:db8::')).toBe('2001:db8:0:0::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('2001:db8:0:0:0:0:0:1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('1:2:3::4:5:6')).toBe('1:2:3:0::/64')
    expect(clientKey('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64')
    expect(clientKey('::2:3:4:5:6:7:8')).toBe('0:2:3:4::/64')
    expect(clientKey('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64')
  })

  it('takes a full address with a :: standing for no group, or for more than the rest allows, as malformed', () => {
    expect(clientKey('1:2:3:4:5:6:7::8')).toBeNull()
    expect(clientKey('1:2:3:4::5:6:7:8')).toBeNull()
  })

  it('returns null for anything that is not an address', () => {
    for (const bad of ['', 'abc', 'localhost', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.-4', '1:2:3', '1:2:3:4:5:6:7:8:9', '1::2::3', '12345::1', 'g::1', '::1%eth0', '1.2.3.4:80', '::ffff:1.2.3', '1:2:3:4:5:6:7:1.2.3.4']) {
      expect(clientKey(bad), bad).toBeNull()
    }
  })
})
