'use strict'

const applyDefaultOptions = require('./utils/apply-default-options')
const toMfsPath = require('./utils/to-mfs-path')
const exporter = require('ipfs-unixfs-exporter')
const log = require('debug')('ipfs:mfs:stat')
const errCode = require('err-code')
const { withTimeoutOption } = require('../../utils')

const defaultOptions = {
  withLocal: false,
  signal: undefined
}

module.exports = (context) => {
  /**
   * Get file or directory statistics
   *
   * @param {string} path - The MFS path return statistics from
   * @param {Object} options
   * @param {boolean} [options.hash] - If true, return only the CID.
   * @param {boolean} [options.size] - If true, return only the size.
   * @param {boolean} [options.withLocal] - If true, compute the amount of the DAG that is local and if possible the total size
   * @param {number} [options.timeout] - A timeout in ms
   * @param {AbortSignal} [options.abort] - Can be used to cancel any long
   * running requests started as a result of this call
   * @returns {Promise<Stat>} - An object containing the file/directory status
   */
  async function mfsStat (path, options) {
    options = applyDefaultOptions(options, defaultOptions)

    log(`Fetching stats for ${path}`)

    const {
      type,
      cid,
      mfsPath
    } = await toMfsPath(context, path, options)

    const exportPath = type === 'ipfs' && cid ? cid : mfsPath
    let file

    try {
      file = await exporter(exportPath, context.ipld)
    } catch (err) {
      if (err.code === 'ERR_NOT_FOUND') {
        throw errCode(new Error(`${path} does not exist`), 'ERR_NOT_FOUND')
      }

      throw err
    }

    if (!statters[file.cid.codec]) {
      throw new Error(`Cannot stat codec ${file.cid.codec}`)
    }

    return statters[file.cid.codec](file)
  }

  return withTimeoutOption(mfsStat)
}

/**
 * @typedef {Object} Stat
 * @property {import('cids')} cid - Content idenntifier
 * @property {number} size - An integer with the file size in bytes.
 * @property {number} cumulativeSize - An integer with the size of the
 * DAGNodes making up the file in bytes.
 * @property {'directory'|'file'} type - Type of the file which is  either directory
 * or file.
 * @property {number} blocks - If type is directory, this is the number of files
 * in the directory. If it is file it is the number of blocks that make up the
 * file.
 * @property {boolean} [withLocality] - A boolean to indicate if locality
 * information is present.
 * @property {boolean} [local] - Is a boolean to indicate if the queried dag is
 * fully present locally.
 * @property {number} [sizeLocal] - An integer indicating the cumulative size of
 * the data present locally.
 * @property {number} [mode] - File mode
 * @property {import('../add-all').UnixTimeObj} [mtime] - Modification time
 */

/** @type {Record<string, (file:any) => Stat>} */
const statters = {
  /**
   * @param {any} file
   * @returns {Stat}
   */
  raw: (file) => {
    return {
      cid: file.cid,
      size: file.node.length,
      cumulativeSize: file.node.length,
      blocks: 0,
      type: 'file', // for go compatibility
      local: undefined,
      sizeLocal: undefined,
      withLocality: false
    }
  },
  /**
   * @param {any} file
   * @returns {Stat}
   */
  'dag-pb': (file) => {
    const blocks = file.node.Links.length
    const size = file.node.size
    const cumulativeSize = file.node.size

    /** @type {Stat} */
    const output = {
      cid: file.cid,
      type: 'file',
      size: size,
      cumulativeSize: cumulativeSize,
      blocks: blocks,
      local: undefined,
      sizeLocal: undefined,
      withLocality: false
    }

    if (file.unixfs) {
      output.size = file.unixfs.fileSize()

      // for go-ipfs compatibility
      if (file.unixfs.type === 'hamt-sharded-directory') {
        output.type = 'directory'
      } else {
        output.type = file.unixfs.type
      }

      output.mode = file.unixfs.mode

      if (file.unixfs.isDirectory()) {
        output.size = 0
        output.cumulativeSize = file.node.size
      }

      if (output.type === 'file') {
        output.blocks = file.unixfs.blockSizes.length
      }

      if (file.unixfs.mtime) {
        output.mtime = file.unixfs.mtime
      }
    }

    return output
  },
  /**
   * @param {any} file
   * @returns {Stat}
   */
  'dag-cbor': (file) => {
    // @ts-ignore - This is incompatible with Stat object
    // @TODO - https://github.com/ipfs/js-ipfs/issues/3325
    return {
      cid: file.cid,
      local: undefined,
      sizeLocal: undefined,
      withLocality: false
    }
  },
  /**
   * @param {any} file
   * @returns {Stat}
   */
  identity: (file) => {
    return {
      cid: file.cid,
      size: file.node.digest.length,
      cumulativeSize: file.node.digest.length,
      blocks: 0,
      type: 'file', // for go compatibility
      local: undefined,
      sizeLocal: undefined,
      withLocality: false
    }
  }
}