/** Keyless snapshot through the real Loader and ApiProxy service composition. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/session-authority/driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/session-authority/cordis.yml', import.meta.url))
const expectedPath = fileURLToPath(new URL('./snapshots/session-authority/output.expected.jsonl', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('external Session authority snapshot', () => {
  it('refreshes and renames through the assembled Host contract', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'external Session authority snapshot',
      tempDirPrefix: 'session-authority-snapshot-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
    })
    expect(stderr).toBe('')
    expect(stdout).toBe(await readFile(expectedPath, 'utf8'))
  })
})
