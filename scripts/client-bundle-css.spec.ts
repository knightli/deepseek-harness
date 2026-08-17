/**
 * CSS Modules enter client bundles through virtual modules, so the loader must
 * explicitly register the underlying stylesheet as a watch dependency.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'lightningcss'
import { Rolldown } from 'tsdown'
import { describe, expect, it } from 'vitest'
import {
  clientBundle,
  cssModulesInlinePlugin,
  repositoryCssModuleFilename,
  sortedCssModuleClassMap,
} from '../packages/client/tsdown.client.ts'

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

async function cssArtifact(repositoryRoot: string): Promise<{
  bundle: string
  generatedModule: string
  virtualId: string
}> {
  const relativePath = join('packages', 'client', 'fixture', 'src', 'Fixture.module.css')
  const stylesheet = join(repositoryRoot, relativePath)
  await mkdir(dirname(stylesheet), { recursive: true })
  await writeFile(stylesheet, '.root { color: red; }\n.label { color: blue; }\n')

  const plugin = cssModulesInlinePlugin('@deepseek-ai/dsh-client-test', repositoryRoot)
  const virtualId = plugin.resolveId(stylesheet, '\0dsh-css-test-entry')
  if (typeof virtualId !== 'string') throw new Error('CSS Modules virtual id missing')
  const watched: string[] = []
  const generatedModule = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)
  if (typeof generatedModule !== 'string') throw new Error('CSS Modules generated module missing')
  expect(watched).toEqual([stylesheet])

  const entryId = '\0dsh-css-test-entry'
  const build = await Rolldown.rolldown({
    input: entryId,
    plugins: [{
      name: 'dsh-css-test-entry',
      resolveId(source) {
        return source === entryId ? source : null
      },
      load(source) {
        return source === entryId
          ? `import classes from ${JSON.stringify(stylesheet)}; export default classes;`
          : null
      },
    }, plugin],
  })
  const output = await build.generate({ format: 'esm', sourcemap: false })
  const chunk = output.output.find(candidate => candidate.type === 'chunk')
  if (chunk?.type !== 'chunk') throw new Error('CSS Modules test bundle missing')
  return { bundle: chunk.code, generatedModule, virtualId }
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
    const otherRelativePath = join('packages', 'client', 'other', 'src', 'Fixture.module.css')
    const plugin = cssModulesInlinePlugin('@deepseek-ai/dsh-client-test', firstRoot)

    expect(cssClassIdentity(firstRoot, relativePath)).toBe(cssClassIdentity(secondRoot, relativePath))
    expect(cssClassIdentity(firstRoot, relativePath)).not.toBe(
      cssClassIdentity(firstRoot, otherRelativePath),
    )
    expect(plugin.resolveId(join(firstRoot, relativePath), undefined))
      .not.toBe(plugin.resolveId(join(firstRoot, otherRelativePath), undefined))
  })

  it('emits byte-identical virtual ids, modules, and bundles across checkout roots', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'dsh-client-css-roots-'))
    const firstRoot = join(temporaryRoot, 'checkout-one')
    const secondRoot = join(temporaryRoot, 'checkout-two')

    try {
      const first = await cssArtifact(firstRoot)
      const second = await cssArtifact(secondRoot)

      expect(first.virtualId).toBe('\0dsh-css:packages/client/fixture/src/Fixture.module.css.mjs')
      expect(second.virtualId).toBe(first.virtualId)
      expect(second.generatedModule).toBe(first.generatedModule)
      expect(Buffer.from(second.bundle)).toEqual(Buffer.from(first.bundle))
      expect(first.bundle).not.toContain(firstRoot)
      expect(second.bundle).not.toContain(secondRoot)
    }
    finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('sorts CSS export keys independently of transform insertion order', () => {
    const permutations = [
      [['zeta', { name: 'hash_zeta' }], ['alpha', { name: 'hash_alpha' }], ['middle', { name: 'hash_middle' }]],
      [['alpha', { name: 'hash_alpha' }], ['middle', { name: 'hash_middle' }], ['zeta', { name: 'hash_zeta' }]],
      [['middle', { name: 'hash_middle' }], ['zeta', { name: 'hash_zeta' }], ['alpha', { name: 'hash_alpha' }]],
      [['zeta', { name: 'hash_zeta' }], ['middle', { name: 'hash_middle' }], ['alpha', { name: 'hash_alpha' }]],
      [['alpha', { name: 'hash_alpha' }], ['zeta', { name: 'hash_zeta' }], ['middle', { name: 'hash_middle' }]],
      [['middle', { name: 'hash_middle' }], ['alpha', { name: 'hash_alpha' }], ['zeta', { name: 'hash_zeta' }]],
    ] as const
    const serialized = permutations.map(entries => JSON.stringify(sortedCssModuleClassMap(Object.fromEntries(entries))))

    expect(new Set(serialized)).toEqual(new Set([
      '{"alpha":"hash_alpha","middle":"hash_middle","zeta":"hash_zeta"}',
    ]))
    expect(JSON.stringify(sortedCssModuleClassMap({
      alpha: { name: 'changed' },
      middle: { name: 'hash_middle' },
      zeta: { name: 'hash_zeta' },
    })))
      .not.toBe(serialized[0])
    expect(JSON.stringify(sortedCssModuleClassMap({
      alpha: { name: 'hash_alpha' },
      beta: { name: 'hash_beta' },
      middle: { name: 'hash_middle' },
    })))
      .not.toBe(serialized[0])
  })

  it('rejects stylesheets outside the repository root', () => {
    const repositoryRoot = join(tmpdir(), 'dsh-client-css-checkout')

    expect(() => repositoryCssModuleFilename(repositoryRoot, resolve(repositoryRoot, '..', 'escape.css')))
      .toThrow(/outside the repository root/i)
  })

  it('rejects an outside virtual stylesheet before watching or reading it', async () => {
    const plugin = cssPlugin()
    const importer = join(tmpdir(), 'outside-checkout', 'index.ts')
    const watched: string[] = []

    expect(() => plugin.resolveId?.('./Escape.module.css', importer))
      .toThrow(/outside the repository root/i)
    expect(watched).toEqual([])
  })

  it.each([
    '\0dsh-css:../Escape.module.css.mjs',
    '\0dsh-css:packages\\client\\Escape.module.css.mjs',
    '\0dsh-css:C:/Escape.module.css.mjs',
    '\0dsh-css:packages/client/./Escape.module.css.mjs',
    '\0dsh-css:packages/client/Escape.module.css',
  ])('rejects a noncanonical virtual stylesheet before watching or reading: %s', async (virtualId) => {
    const repositoryRoot = join(tmpdir(), 'dsh-client-css-checkout')
    const plugin = cssModulesInlinePlugin('@deepseek-ai/dsh-client-test', repositoryRoot)
    const watched: string[] = []

    const promise = plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)
    await expect(promise).rejects.toThrow(/invalid CSS Module virtual id/i)
    expect(watched).toEqual([])
  })
})
