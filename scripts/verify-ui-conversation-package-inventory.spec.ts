import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
  absolutePackTempRoot,
  assertExactPackageInventory,
} from './verify-ui-conversation-package-inventory.ts'
import { isAbsolute } from 'node:path'

describe('ui-conversation packed publication inventory', () => {
  it('pins the complete official 77-member package, including 69 declarations', () => {
    expect(OFFICIAL_UI_CONVERSATION_PACKAGE_FILES).toHaveLength(77)
    expect(OFFICIAL_UI_CONVERSATION_PACKAGE_FILES.filter(file => file.endsWith('.d.ts'))).toHaveLength(69)
    expect(() => {
      assertExactPackageInventory(
        OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
        OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
      )
    }).not.toThrow()
  })

  it('rejects files-list shrinkage and missing runtime JavaScript', () => {
    const actual = OFFICIAL_UI_CONVERSATION_PACKAGE_FILES.filter(file => file !== 'package/lib/client.js')
    expect(() => { assertExactPackageInventory(OFFICIAL_UI_CONVERSATION_PACKAGE_FILES, actual) })
      .toThrow(/missing: package\/lib\/client\.js/)
  })

  it('rejects files-list expansion and stale capability declarations', () => {
    const actual = [
      ...OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
      'package/lib/types/client/session-capabilities.d.ts',
    ]
    expect(() => { assertExactPackageInventory(OFFICIAL_UI_CONVERSATION_PACKAGE_FILES, actual) })
      .toThrow(/extra: package\/lib\/types\/client\/session-capabilities\.d\.ts/)
  })

  it('rejects an automatically emitted declaration member', () => {
    const actual = [
      ...OFFICIAL_UI_CONVERSATION_PACKAGE_FILES,
      'package/lib/types/client/contract/automatic-extra.d.ts',
    ]
    expect(() => { assertExactPackageInventory(OFFICIAL_UI_CONVERSATION_PACKAGE_FILES, actual) })
      .toThrow(/automatic-extra\.d\.ts/)
  })

  it('resolves a relative process temp directory before passing it to pnpm pack', () => {
    expect(isAbsolute(absolutePackTempRoot('relative-temp'))).toBe(true)
  })
})
