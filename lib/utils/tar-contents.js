'use strict'

const fs = require('fs')
const tar = require('tar')
const ssri = require('ssri')
const log = require('npmlog')
const BB = require('bluebird')
const byteSize = require('byte-size')
const columnify = require('columnify')

const npm = require('../npm')

module.exports.logTarContents = logTarContents
function logTarContents (tarball) {
  log.notice('')
  log.notice('', `${npm.config.get('unicode') ? '📦 ' : 'package:'} ${tarball.name}@${tarball.version}`)
  log.notice('=== Tarball Contents ===')
  if (tarball.files.length) {
    log.notice('', columnify(tarball.files.map((f) => {
      const bytes = byteSize(f.size)
      return {path: f.path, size: `${bytes.value}${bytes.unit}`}
    }), {
      include: ['size', 'path'],
      showHeaders: false
    }))
  }
  if (tarball.bundled.length) {
    log.notice('=== Bundled Dependencies ===')
    tarball.bundled.forEach((name) => log.notice('', name))
  }
  log.notice('=== Tarball Details ===')
  log.notice('', columnify([
    {name: 'name:', value: tarball.name},
    {name: 'version:', value: tarball.version},
    tarball.filename && {name: 'filename:', value: tarball.filename},
    {name: 'package size:', value: byteSize(tarball.size)},
    {name: 'unpacked size:', value: byteSize(tarball.unpackedSize)},
    {name: 'shasum:', value: tarball.shasum},
    {
      name: 'integrity:',
      value: tarball.integrity.toString().substr(0, 20) + '[...]' + tarball.integrity.toString().substr(80)},
    tarball.bundled.length && {name: 'bundled deps:', value: tarball.bundled.length},
    tarball.bundled.length && {name: 'bundled files:', value: tarball.entryCount - tarball.files.length},
    tarball.bundled.length && {name: 'own files:', value: tarball.files.length},
    {name: 'total files:', value: tarball.entryCount}
  ].filter((x) => x), {
    include: ['name', 'value'],
    showHeaders: false
  }))
  log.notice('', '')
}

module.exports.getTarContents = getTarContents
function getTarContents (pkg, target, filename, silent) {
  const bundledWanted = new Set(
    pkg.bundleDependencies ||
    pkg.bundledDependencies ||
    []
  )
  const files = []
  const bundled = new Set()
  let totalEntries = 0
  let totalEntrySize = 0
  return tar.t({
    file: target,
    onentry (entry) {
      totalEntries++
      totalEntrySize += entry.size
      const p = entry.path
      if (p.startsWith('package/node_modules/')) {
        const name = p.match(/^package\/node_modules\/((?:@[^/]+\/)?[^/]+)/)[1]
        if (bundledWanted.has(name)) {
          bundled.add(name)
        }
      } else {
        files.push({
          path: entry.path.replace(/^package\//, ''),
          size: entry.size,
          mode: entry.mode
        })
      }
    },
    strip: 1
  })
    .then(() => BB.all([
      BB.fromNode((cb) => fs.stat(target, cb)),
      ssri.fromStream(fs.createReadStream(target), {
        algorithms: ['sha1', 'sha512']
      })
    ]))
    .then(([stat, integrity]) => {
      const shasum = integrity['sha1'][0].hexDigest()
      return {
        id: pkg._id,
        name: pkg.name,
        version: pkg.version,
        from: pkg._from,
        size: stat.size,
        unpackedSize: totalEntrySize,
        shasum,
        integrity: ssri.parse(integrity['sha512'][0]),
        filename,
        files,
        entryCount: totalEntries,
        bundled: Array.from(bundled)
      }
    })
}
