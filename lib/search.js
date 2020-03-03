'use strict'

module.exports = exports = search

const Minipass = require('minipass')
const npm = require('./npm.js')
const allPackageSearch = require('./search/all-package-search')
const formatPackageStream = require('./search/format-package-stream.js')
const libSearch = require('libnpmsearch')
const log = require('npmlog')
const ms = require('mississippi')
const output = require('./utils/output.js')
const usage = require('./utils/usage')

search.usage = usage(
  'search',
  'npm search [--long] [search terms ...]'
)

search.completion = function (opts, cb) {
  cb(null, [])
}

function search (args, cb) {
  const opts = {
    ...npm.flatOptions,
    ...npm.flatOptions.search,
    include: prepareIncludes(args, npm.flatOptions.search.opts),
    exclude: prepareExcludes(npm.flatOptions.search.exclude)
  }

  if (opts.include.length === 0) {
    return cb(new Error('search must be called with arguments'))
  }

  // Used later to figure out whether we had any packages go out
  let anyOutput = false

  const entriesStream = ms.through.obj()

  let esearchWritten = false
  libSearch.stream(opts.include, opts).on('data', pkg => {
    entriesStream.write(pkg)
    !esearchWritten && (esearchWritten = true)
  }).on('error', err => {
    if (esearchWritten) {
      // If esearch errored after already starting output, we can't fall back.
      return entriesStream.emit('error', err)
    }
    log.warn('search', 'fast search endpoint errored. Using old search.')
    allPackageSearch(opts)
      .on('data', pkg => entriesStream.write(pkg))
      .on('error', err => entriesStream.emit('error', err))
      .on('end', () => entriesStream.end())
  }).on('end', () => entriesStream.end())

  // Grab a configured output stream that will spit out packages in the
  // desired format.
  var outputStream = formatPackageStream({
    args: args, // --searchinclude options are not highlighted
    long: npm.config.get('long'),
    description: npm.config.get('description'),
    json: npm.config.get('json'),
    parseable: npm.config.get('parseable'),
    color: npm.color
  })
  outputStream.on('data', chunk => {
    if (!anyOutput) { anyOutput = true }
    output(chunk.toString('utf8'))
  })

  log.silly('search', 'searching packages')
  ms.pipe(entriesStream, outputStream, err => {
    if (err) return cb(err)
    if (!anyOutput && !npm.config.get('json') && !npm.config.get('parseable')) {
      output('No matches found for ' + (args.map(JSON.stringify).join(' ')))
    }
    log.silly('search', 'search completed')
    log.clearProgress()
    cb(null, {})
  })
}

function prepareIncludes (args, searchopts) {
  if (typeof searchopts !== 'string') searchopts = ''
  return searchopts.split(/\s+/).concat(args).map(function (s) {
    return s.toLowerCase()
  }).filter(function (s) { return s })
}

function prepareExcludes (searchexclude) {
  var exclude
  if (typeof searchexclude === 'string') {
    exclude = searchexclude.split(/\s+/)
  } else {
    exclude = []
  }
  return exclude.map(function (s) {
    return s.toLowerCase()
  })
}
