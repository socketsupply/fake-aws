'use strict'

const http = require('http')
const path = require('path')
const util = require('util')
const fs = require('fs')
const URL = require('url').URL

const mkdir = util.promisify(fs.mkdir)
const writeFile = util.promisify(fs.writeFile)
const readdir = util.promisify(fs.readdir)
const readFile = util.promisify(fs.readFile)
const stripCreds = /Credential=([\w-/0-9a-zA-Z]+),/

/** @typedef {AWS.Lambda.Types.FunctionConfiguration} FunctionConfiguration */
/** @typedef {{ (err?: Error): void; }} Callback */

class FakeLambdaAPI {
  /**
   * @param {{
   *    port?: number,
   *    hostname?: string,
   *    cachePath?: string
   * }} [options]
   */
  constructor (options = {}) {
    /** @type {number} */
    this.requestPort = typeof options.port === 'number' ? options.port : 0
    /** @type {string} */
    this.requestHost = options.hostname || 'localhost'

    /** @type {http.Server} */
    this.httpServer = http.createServer()
    /** @type {string|null} */
    this.hostPort = null
    /** @type {string|null} */
    this.cachePath = options.cachePath || null

    // https://github.com/typescript-eslint/typescript-eslint/issues/1943
    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    /** @type {Map<string, { offset: number}>} */
    this.tokens = new Map()

    /** @type {Map<string, FunctionConfiguration[]>} */
    this._functions = new Map()

    /**
     * This maps from a profileName to an accountId, this is
     * necessary for handling ARNs.
     *
     * @type {Map<string, string>}
     */
    this._accountIdMapping = new Map()
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  }

  /** @returns {Promise<string>} */
  async bootstrap () {
    this.httpServer.on('request', (
      /** @type {http.IncomingMessage} */ req,
      /** @type {http.ServerResponse} */ res
    ) => {
      this._handleServerRequest(req, res)
    })

    await util.promisify((/** @type {Callback} */ cb) => {
      this.httpServer.listen(this.requestPort, this.requestHost, cb)
    })()

    const addr = this.httpServer.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('Invalid httpServer.address()')
    }

    this.hostPort = `${addr.address}:${addr.port}`

    if (this.cachePath) {
      await this.populateFromCache()
    }

    return this.hostPort
  }

  async close () {
    await util.promisify((/** @type {Callback} */ cb) => {
      this.httpServer.close(cb)
    })()
  }

  /**
   * @param {import('aws-sdk')} aws
   * @returns {Promise<string[]>}
   */
  async getAllRegions (aws) {
    const ec2 = new aws.EC2({ region: 'us-east-1' })

    const data = await ec2.describeRegions().promise()

    if (!data.Regions) return []
    return data.Regions.map((r) => {
      if (!r.RegionName) throw new Error('Missing RegionName')
      return r.RegionName
    })
  }

  /**
   * @param {import('aws-sdk')} aws
   * @param {string[] | 'all'} regions
   * @returns {Promise<void>}
   */
  async fetchAndCache (aws, regions) {
    if (regions === 'all') {
      regions = await this.getAllRegions(aws)
    }

    /** @type {Promise<void>[]} */
    const tasks = []
    for (const region of regions) {
      tasks.push(this.fetchAndCacheForRegion(aws, region))
    }
    await Promise.all(tasks)
  }

  /**
   * @param {import('aws-sdk')} aws
   * @param {string} region
   * @returns {Promise<void>}
   */
  async fetchAndCacheForRegion (aws, region) {
    const lambda = new aws.Lambda({
      region: region
    })

    const data = await lambda.listFunctions().promise()

    if (!lambda.config.credentials) throw new Error('no credentials')
    const accessKeyId = lambda.config.credentials.accessKeyId

    if (!data.Functions || data.Functions.length === 0) {
      return
    }
    await this.cacheFunctionsToDisk(accessKeyId, region, data.Functions)
    this.populateFunctions(accessKeyId, region, data.Functions)
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {FunctionConfiguration[]} functions
   * @returns {Promise<void>}
   */
  async cacheFunctionsToDisk (profile, region, functions) {
    if (!this.cachePath) {
      throw new Error('Missing this.cachePath')
    }

    const functionsDir = path.join(this.cachePath, 'functions')
    await mkdir(functionsDir, { recursive: true })
    await writeFile(
      path.join(
        functionsDir, `${profile}--${region}-functions.json`
      ), JSON.stringify({
        type: 'cached-functions',
        profile: profile,
        region: region,
        data: functions
      }, null, 4),
      'utf8'
    )
  }

  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  /**
   * @param {string} [filePath]
   * @returns {Promise<void>}
   */
  async populateFromCache (filePath) {
    const cachePath = filePath || this.cachePath
    if (!cachePath) {
      throw new Error('missing filePath')
    }

    /** @type {string[] | null} */
    let functionFiles = null
    try {
      functionFiles = await readdir(path.join(cachePath, 'functions'))
    } catch (maybeErr) {
      const err = /** @type {NodeJS.ErrnoException} */ (maybeErr)
      if (err.code !== 'ENOENT') throw err
    }

    if (functionFiles) {
      for (const fileName of functionFiles) {
        const functionsStr = await readFile(path.join(
          cachePath, 'functions', fileName
        ), 'utf8')
        const functions = /** @type {{
          profile: string;
          region: string;
          data: FunctionConfiguration[]
        }} */ (JSON.parse(functionsStr))
        this.populateFunctions(functions.profile, functions.region, functions.data)
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  /**
   * @param {string} profile
   * @param {string} region
   * @param {FunctionConfiguration[]} functions
   * @returns {void}
   */
  populateFunctions (profile, region, functions) {
    const key = `${profile}--${region}`
    const funcs = this._functions.get(key) || []

    for (const $function of functions) {
      if ($function.FunctionArn) {
        const arn = $function.FunctionArn
        const parts = arn.split(':')
        const accountId = parts[4]

        const knownAccountId = this._accountIdMapping.get(profile)
        if (!knownAccountId) {
          this._accountIdMapping.set(profile, accountId)
        } else {
          if (knownAccountId !== accountId) {
            throw new Error(
              'cannot populate functions from multiple ' +
                'accounts under on profile'
            )
          }
        }
      }
      funcs.push($function)
    }

    this._functions.set(key, funcs)
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {void}
   */
  _handleServerRequest (req, res) {
    /** @type {Array<Buffer>} */
    const buffers = []
    req.on('data', (/** @type {Buffer} */ chunk) => {
      buffers.push(chunk)
    })
    req.on('end', () => {
      const bodyBuf = Buffer.concat(buffers)
      const url = req.url || '/'

      if (req.method === 'GET' &&
          url.startsWith('/2015-03-31/functions/')
      ) {
        const respBody = this._handleListFunctions(req, bodyBuf)

        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify(respBody))
      } else if (req.method === 'GET' &&
          url.startsWith('/2017-03-31/tags/')
      ) {
        const respBody = this._handleListTags(req, bodyBuf)

        res.writeHead(200, {
          'Content-Type': 'application/json'
        })
        res.end(JSON.stringify(respBody))
      } else {
        res.statusCode = 500
        res.end('URL not supported: ' + url)
      }
    })
  }

  /**
   * @param {http.IncomingMessage} req
   * @returns {FunctionConfiguration[]}
   */
  _getFunctionsMap (req) {
    const authHeader = req.headers.authorization
    let profile = 'default'
    let region = 'us-east-1'
    const match = authHeader ? authHeader.match(stripCreds) : null
    if (match) {
      const creds = match[0].slice(11)
      const parts = creds.split('/')
      const accessKeyId = parts[0]

      region = parts[2]
      profile = accessKeyId
    }

    const key = `${profile}--${region}`

    const functions = this._functions.get(key)
    if (functions) {
      return functions
    }

    return this._functions.get('default--us-east-1') || []
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {Buffer} _bodyBuf
   * @returns {AWS.Lambda.Types.ListFunctionsResponse}
   */
  _handleListFunctions (req, _bodyBuf) {
    const url = /** @type {string} */ (req.url)
    const urlObj = new URL(url, 'http://localhost')

    const MaxItems = urlObj.searchParams.get('MaxItems')
    const markerParam = urlObj.searchParams.get('Marker')
    const maxItems = MaxItems ? parseInt(MaxItems, 10) : 50

    const response = {}
    const rawFunctions = this._getFunctionsMap(req)

    let offset = 0
    if (markerParam) {
      const tokenInfo = this.tokens.get(markerParam)
      this.tokens.delete(markerParam)
      if (!tokenInfo) {
        throw new Error('invalid marker: ' + markerParam)
      }
      offset = tokenInfo.offset
    }

    const end = offset + maxItems
    response.Functions = rawFunctions.slice(offset, end)
    if (rawFunctions.length > end) {
      response.NextMarker = cuuid()
      this.tokens.set(response.NextMarker, { offset: end })
    }

    return response
  }

  /**
   *
   * @param {http.IncomingMessage} _req
   * @param {Buffer} _bodyBuf
   * @returns {AWS.Lambda.Types.ListTagsResponse}
   */
  _handleListTags (_req, _bodyBuf) {
    // TODO: Allow for populating tags and returning them.

    return {
      Tags: {}
    }
  }
}
exports.FakeLambdaAPI = FakeLambdaAPI

/**
 * @returns {string}
 */
function cuuid () {
  const str = (
    Date.now().toString(16) + Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  ).slice(0, 32)
  return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' +
    str.slice(12, 16) + '-' + str.slice(16, 20) + '-' +
    str.slice(20)
}
