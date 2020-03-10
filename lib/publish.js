'use strict'

const util = require('util')
const log = require('npmlog')
const semver = require('semver')
const pacote = require('pacote')
const cacache = require('cacache')
const libpub = require('libnpmpublish').publish

const npm = require('./npm.js')
const output = require('./utils/output.js')
const otplease = require('./utils/otplease.js')

const readJson = util.promisify(require('read-package-json'))
const lifecycle = util.promisify(require('./utils/lifecycle.js'))
const { getTarContents, logTarContents } = require('./utils/tar-contents.js')

publish.usage = 'npm publish [<folder>] [--tag <tag>] [--access <public|restricted>] [--dry-run]' +
                "\n\nPublishes '.' if no argument supplied" +
                '\n\nSets tag `latest` if no --tag specified'

const publishConfig = () => ({
  dryRun: 'dry-run',
  tag: 'defaultTag',
  'dry-run': false,
  defaultTag: 'latest',
  json: false,
  tmp: {},
  ...npm.flatOptions
})

module.exports = publish
function publish (args, cb) {
  if (args.length === 0) args = ['.']
  if (args.length !== 1) return cb(publish.usage)

  log.verbose('publish', args) 

  const opts = publishConfig()
  const t = opts.defaultTag.trim()
  if (semver.validRange(t)) {
    return cb(new Error('Tag name must not be a valid SemVer range: ' + t))
  }

  return publish_(args[0], opts)
    .then(tarball => {
      const silent = log.level === 'silent'
      if (!silent && opts.json) {
        output(JSON.stringify(tarball, null, 2))
      } else if (!silent) {
        output(`+ ${tarball.id}`)
      }
    })
    .then(cb)
}

async function publish_ (arg, opts) {
  // all this readJson is because any of the given scripts might modify the
  // package.json in question, so we need to refresh after every step.
  let manifest = await readJson(`${arg}/package.json`)
  let pkgContents

  // prepublishOnly
  await lifecycle(manifest, 'prepublishOnly', arg)
  
  // package and display contents  
  await cacache.tmp.withTmp(opts.tmp, { tmpPrefix: 'fromDir' }, async (tmpDir) => {
    manifest = await readJson(`${arg}/package.json`) 
    const filename = `${manifest.name}-${manifest.version}.tgz`
    const tmpTarget = `${tmpDir}/${filename}`
    // pack tarball
    await pacote.tarball.file(`file:${arg}`, tmpTarget)
    pkgContents = await getTarContents(manifest, tmpTarget, filename)
  })

  if (!opts.json) {
    logTarContents(pkgContents)
  }
  
  try {
    if (!opts.dryRun) {
      await otplease(opts, opts => libpub(arg, manifest, opts))
    }
  } catch (err) {
    throw err
  }

  manifest = await readJson(`${arg}/package.json`)
  // publish
  await lifecycle(manifest, 'publish', arg)
  // postpublish
  await lifecycle(manifest, 'postpublish', arg)

  return pkgContents
}
