/**
 * CSS Modules enter client bundles through virtual modules, so the loader must
 * explicitly register the underlying stylesheet as a watch dependency.
 */
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { describe, expect, it } from 'vitest'
import { clientBundle, repositoryCssModuleFilename } from '../packages/client/tsdown.client.ts'

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

function cssPlugin(): CssPlugin {
  const configs = clientBundle(
    '@deepseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-css-modules-inline')
  if (plugin === undefined) throw new Error('CSS Modules plugin missing from client config')
  return plugin
}

function cssClassIdentity(repositoryRoot: string, relativePath: string): string {
  const filename = repositoryCssModuleFilename(repositoryRoot, join(repositoryRoot, relativePath))
  const result = transform({
    filename,
    code: Buffer.from('.root { color: red; }\n'),
    cssModules: { pattern: '[hash]_[local]' },
    minify: true,
  })
  const identity = result.exports?.root?.name
  if (identity === undefined) throw new Error('CSS Modules identity missing')
  return identity
}

describe('client bundle CSS Modules', () => {
  it('registers the source stylesheet as a watch dependency', async () => {
    const stylesheet = fileURLToPath(
      new URL('../packages/client/ui-layout/src/client/AppFrame.module.css', import.meta.url),
    )
    const importer = fileURLToPath(new URL('../packages/client/ui-layout/src/client/AppFrame.tsx', import.meta.url))
    const plugin = cssPlugin()
    const virtualId = plugin.resolveId?.('./AppFrame.module.css', importer)
    if (typeof virtualId !== 'string' || plugin.load === undefined) {
      throw new Error('CSS Modules plugin hooks are incomplete')
    }
    const watched: string[] = []

    const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

    expect(watched).toEqual([stylesheet])
    expect(output).toContain('data-plugin-css')
  })

  it('derives stable identities from repository-relative POSIX paths', () => {
    const firstRoot = join(tmpdir(), 'dsh-client-css-checkout-one')
    const secondRoot = join(tmpdir(), 'dsh-client-css-checkout-two')
    const relativePath = join('packages', 'client', 'fixture', 'src', 'Fixture.module.css')

    expect(cssClassIdentity(firstRoot, relativePath)).toBe(cssClassIdentity(secondRoot, relativePath))
    expect(cssClassIdentity(firstRoot, relativePath)).not.toBe(
      cssClassIdentity(firstRoot, join('packages', 'client', 'other', 'src', 'Fixture.module.css')),
    )
  })

  it('rejects stylesheets outside the repository root', () => {
    const repositoryRoot = join(tmpdir(), 'dsh-client-css-checkout')

    expect(() => repositoryCssModuleFilename(repositoryRoot, resolve(repositoryRoot, '..', 'escape.css')))
      .toThrow(/outside the repository root/i)
  })

  it('rejects an outside virtual stylesheet before watching or reading it', async () => {
    const plugin = cssPlugin()
    const importer = join(tmpdir(), 'outside-checkout', 'index.ts')
    const virtualId = plugin.resolveId?.('./Escape.module.css', importer)
    if (typeof virtualId !== 'string' || plugin.load === undefined) {
      throw new Error('CSS Modules plugin hooks are incomplete')
    }
    const watched: string[] = []

    await expect(plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId))
      .rejects.toThrow(/outside the repository root/i)
    expect(watched).toEqual([])
  })
})
