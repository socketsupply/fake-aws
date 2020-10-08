// @ts-check
'use strict'

const http = require('http')
const util = require('util')
const path = require('path')
const fs = require('fs')
/** @type {import('assert')} */
const assert = require('assert')

/**
   @typedef {import('aws-sdk').CloudWatchLogs.LogGroup} LogGroup
 * @typedef {import('aws-sdk').CloudWatchLogs.LogStream} LogStream
 * @typedef {import('aws-sdk').CloudWatchLogs.OutputLogEvent} OutputLogEvent
 * @typedef {
      import('aws-sdk').CloudWatchLogs.DescribeLogGroupsRequest
 * } DescribeLogGroupsRequest
 * @typedef {
      import('aws-sdk').CloudWatchLogs.DescribeLogStreamsRequest
 * } DescribeLogStreamsRequest
 * @typedef {
      import('aws-sdk').CloudWatchLogs.GetLogEventsRequest
 * } GetLogEventsRequest
 */

/** @typedef {{ (err?: Error): void; }} Callback */

const mkdir = util.promisify(fs.mkdir)
const writeFileP = util.promisify(fs.writeFile)
const readFileP = util.promisify(fs.readFile)
const readdirP = util.promisify(fs.readdir)
const stripCreds = /Credential=([\w-/0-9a-zA-Z]+),/

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const INGESTION_DELAY = 1 * HOUR

class FakeCloudwatchLogs {
  /**
     @param {{
        port?: number,
        cachePath?: string,
        ingestionDelay?: number
   * }} options
   */
  constructor (options = {}) {
    /** @type {http.Server | null} */
    this.httpServer = http.createServer()
    /** @type {number} */
    this.port = options.port || 0
    /** @type {string | null} */
    this.hostPort = null
    /** @type {boolean} */
    this.touchedCache = false
    /** @type {string[]} */
    this.knownCaches = []
    /** @type {string|null} */
    this.cachePath = options.cachePath || null

    /** @type {Record<String, LogGroup[]|undefined>} */
    this.rawGroups = {}
    /** @type {Record<string, LogStream[]|undefined>} */
    this.rawStreams = {}
    /** @type {Record<string, OutputLogEvent[]|undefined>} */
    this.rawEvents = {}
    /** @type {Record<string, { offset: number }|undefined>} */
    this.tokens = {}
    /** @type {number} */
    this.gCounter = 0

    /** @type {number} */
    this.ingestionDelay = options.ingestionDelay || INGESTION_DELAY
  }

  /**
   * @param {import('aws-sdk')} AWS
   * @returns {Promise<string[]>}
   */
  async getAllRegions (AWS) {
    const ec2 = new AWS.EC2({ region: 'us-east-1' })

    const data = await ec2.describeRegions().promise()

    if (!data.Regions) return []
    return data.Regions.map((r) => {
      if (!r.RegionName) throw new Error('Missing RegionName')
      return r.RegionName
    })
  }

  /**
   * @param {import('aws-sdk')} AWS
   * @param {string[] | 'all'} regions
   * @returns {Promise<void>}
   */
  async fetchAndCache (AWS, regions) {
    if (regions === 'all') {
      regions = await this.getAllRegions(AWS)
    }

    /** @type {Promise<void>[]} */
    const tasks = []
    for (const region of regions) {
      tasks.push(this.fetchAndCacheForRegion(AWS, region))
    }
    await Promise.all(tasks)
  }

  /**
   * @param {string} message
   * @returns {void}
   */
  log (message) {
    console.log(message)
  }

  /**
   * @param {import('aws-sdk')} AWS
   * @param {string} region
   * @returns {Promise<void>}
   */
  async fetchAndCacheForRegion (AWS, region) {
    const cw = new AWS.CloudWatchLogs({
      region: region
    })

    const groups = await cw.describeLogGroups().promise()

    if (!cw.config.credentials) throw new Error('no credentials')
    const profile = cw.config.credentials.accessKeyId

    if (!groups.logGroups) return
    await this.cacheGroupsToDisk(profile, region, groups.logGroups)
    this.populateGroups(profile, region, groups.logGroups)

    for (const group of groups.logGroups) {
      if (!group.logGroupName) continue

      /** @type {string|undefined} */
      let nextToken
      /** @type {LogStream[]} */
      const allStreams = []
      do {
        this.log(`fetching streams ${group.logGroupName} ${nextToken || ''}`)
        const streams = await cw.describeLogStreams({
          logGroupName: group.logGroupName,
          nextToken: nextToken
        }).promise()
        if (!streams.logStreams) break

        allStreams.push(...streams.logStreams)
        nextToken = streams.nextToken
      } while (nextToken)

      if (allStreams.length === 0) continue
      await this.cacheStreamsToDisk(
        profile, region, group.logGroupName, allStreams
      )
      this.populateStreams(
        profile, region, group.logGroupName, allStreams
      )

      for (const stream of allStreams) {
        if (!stream.logStreamName) continue

        /** @type {string|undefined} */
        let backwardToken
        /** @type {OutputLogEvent[]} */
        const allEvents = []
        do {
          this.log('fetching events ' +
            group.logGroupName + ' ' + stream.logStreamName +
            ' ' + (backwardToken || '')
          )

          const events = await cw.getLogEvents({
            logGroupName: group.logGroupName,
            logStreamName: stream.logStreamName,
            nextToken: backwardToken
          }).promise()
          if (!events.events || events.events.length === 0) break

          this.log(`fetched events ${events.events.length}`)
          allEvents.push(...events.events)
          backwardToken = events.nextBackwardToken
        } while (backwardToken)

        if (allEvents.length === 0) continue
        await this.cacheEventsToDisk(
          profile, region, group.logGroupName,
          stream.logStreamName, allEvents
        )
        this.populateEvents(
          profile, region, group.logGroupName,
          stream.logStreamName, allEvents
        )
      }
    }
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {LogGroup[]} groups
   * @returns {Promise<void>}
   */
  async cacheGroupsToDisk (profile, region, groups) {
    if (!this.cachePath) {
      throw new Error('Missing this.cachePath')
    }

    this.touchedCache = true
    if (!this.knownCaches.includes(this.cachePath)) {
      this.knownCaches.push(this.cachePath)
    }

    const groupsDir = path.join(this.cachePath, 'groups')
    await mkdir(groupsDir, { recursive: true })
    await writeFileP(
      path.join(groupsDir, `${profile}::${region}-groups.json`),
      JSON.stringify({
        type: 'cached-log-group',
        profile: profile,
        region: region,
        data: groups
      }, null, 4),
      'utf8'
    )
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {string} groupName
   * @param {LogStream[]} streams
   * @returns {Promise<void>}
   */
  async cacheStreamsToDisk (profile, region, groupName, streams) {
    if (!this.cachePath) {
      throw new Error('Missing this.cachePath')
    }

    this.touchedCache = true
    if (!this.knownCaches.includes(this.cachePath)) {
      this.knownCaches.push(this.cachePath)
    }

    const key = encodeURIComponent(groupName)
    const streamsDir = path.join(this.cachePath, 'streams')
    await mkdir(streamsDir, { recursive: true })
    await writeFileP(
      path.join(streamsDir, `${profile}::${region}::${key}-streams.json`),
      JSON.stringify({
        type: 'cached-log-stream',
        profile: profile,
        region: region,
        groupName: groupName,
        data: streams
      }, null, 4),
      'utf8'
    )
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {string} groupName
   * @param {string} streamName
   * @param {OutputLogEvent[]} events
   * @returns {Promise<void>}
   */
  async cacheEventsToDisk (
    profile, region, groupName, streamName, events
  ) {
    if (!this.cachePath) {
      throw new Error('Missing this.cachePath')
    }

    this.touchedCache = true
    if (!this.knownCaches.includes(this.cachePath)) {
      this.knownCaches.push(this.cachePath)
    }

    const key = encodeURIComponent(groupName + ':' + streamName)
    const eventsDir = path.join(this.cachePath, 'events')

    await mkdir(eventsDir, { recursive: true })
    await writeFileP(
      path.join(eventsDir, `${profile}::${region}::${key}-events.json`),
      JSON.stringify({
        type: 'cached-log-event',
        profile: profile,
        region: region,
        groupName: groupName,
        streamName: streamName,
        data: events
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

    const groupFiles = (await readdirOptional(
      path.join(cachePath, 'groups')
    )) || []
    for (const fileName of groupFiles) {
      const groupsStr = await readFileP(path.join(
        cachePath, 'groups', fileName
      ), 'utf8')
      const groups = /** @type {{
        profile: string;
        region: string;
        data: LogGroup[]
      }} */ (JSON.parse(groupsStr))
      this.populateGroups(
        groups.profile, groups.region, groups.data
      )
    }

    const streamFiles = (await readdirOptional(
      path.join(cachePath, 'streams')
    )) || []
    for (const fileName of streamFiles) {
      const streamsStr = await readFileP(path.join(
        cachePath, 'streams', fileName
      ), 'utf8')
      const streams = /** @type {{
        profile: string;
        region: string;
        groupName: string;
        data: LogStream[]
      }} */ (JSON.parse(streamsStr))
      this.populateStreams(
        streams.profile, streams.region,
        streams.groupName, streams.data
      )
    }

    const eventFiles = (await readdirOptional(
      path.join(cachePath, 'events')
    )) || []
    for (const fileName of eventFiles) {
      const eventsStr = await readFileP(path.join(
        cachePath, 'events', fileName
      ), 'utf8')
      const events = /** @type {{
        profile: string;
        region: string;
        groupName: string;
        streamName: string;
        data: OutputLogEvent[]
      }} */ (JSON.parse(eventsStr))
      this.populateEvents(
        events.profile, events.region, events.groupName,
        events.streamName, events.data
      )
    }
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment */

  /**
   * @param {string} profile
   * @param {string} region
   * @param {LogGroup[]} newGroups
   * @returns {void}
   */
  populateGroups (profile, region, newGroups) {
    const key = `${profile}::${region}`
    const groups = this.rawGroups[key] || []
    groups.push(...newGroups)

    this.rawGroups[key] = groups
    for (const g of newGroups) {
      const streamKey = `${key}::${g.logGroupName}`
      if (!this.rawStreams[streamKey]) {
        this.rawStreams[streamKey] = []
      }
    }
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {string} groupName
   * @param {LogStream[]} newStreams
   * @returns {void}
   */
  populateStreams (profile, region, groupName, newStreams) {
    const key = `${profile}::${region}::${groupName}`
    const streams = this.rawStreams[key] || []
    streams.push(...newStreams)

    this.rawStreams[key] = streams
  }

  /**
   * @param {string} profile
   * @param {string} region
   * @param {string} groupName
   * @param {string} streamName
   * @param {OutputLogEvent[]} newEvents
   * @returns {void}
   */
  populateEvents (profile, region, groupName, streamName, newEvents) {
    assert(newEvents.length > 0, 'Cannot add empty events array')
    for (const ev of newEvents) {
      assert(typeof ev.timestamp === 'number', 'Must have timestamp field')
      assert(typeof ev.message === 'string', 'Must have message field')
      assert(typeof ev.ingestionTime === 'number', 'Must have ingestionTime')
    }

    const now = Date.now()
    const key = `${profile}::${region}::${groupName}::${streamName}`

    const events = this.rawEvents[key] || []
    events.push(...newEvents)
    events.sort((a, b) => {
      if (!a.timestamp) return 1
      if (!b.timestamp) return -1
      return a.timestamp < b.timestamp ? -1 : 1
    })

    this.rawEvents[key] = events

    const streamKey = `${profile}::${region}::${groupName}`
    const rawStreams = this.rawStreams[streamKey]
    if (!rawStreams) {
      throw new Error('could not find streams for: ' + groupName)
    }
    const stream = rawStreams.find(s => {
      return s.logStreamName === streamName
    })
    if (!stream) {
      throw new Error('could not find stream: ' + streamName)
    }

    let oldestTs = 0
    let oldestIngestion = 0
    let youngestTs = Infinity
    for (const e of events) {
      assert(e.timestamp, 'valid timestamp')
      assert(e.ingestionTime, 'valid ingestionTime')
      if (e.timestamp > oldestTs) {
        oldestTs = e.timestamp
      }
      if (e.ingestionTime > oldestIngestion) {
        oldestIngestion = e.ingestionTime
      }
      if (e.timestamp < youngestTs) {
        youngestTs = e.timestamp
      }
    }

    if (stream.firstEventTimestamp) {
      if (youngestTs !== stream.firstEventTimestamp) {
        throw new Error(
          'Cannot populateEvents() that are younger then existing events'
        )
      }
    } else {
      stream.firstEventTimestamp = youngestTs
    }

    stream.lastIngestionTime = oldestIngestion

    if (!stream.lastEventTimestamp) {
      stream.lastEventTimestamp = oldestTs
    } else {
      const timestamps = events.map(e => e.timestamp || 0)
      timestamps.sort()
      timestamps.reverse()
      for (const timestamp of timestamps) {
        if (
          timestamp < now - this.ingestionDelay &&
          timestamp < stream.lastIngestionTime - this.ingestionDelay &&
          timestamp > stream.lastEventTimestamp
        ) {
          stream.lastEventTimestamp = timestamp
          break
        }
      }
    }
  }

  /** @returns {Promise<string>} */
  async bootstrap () {
    if (!this.httpServer) {
      throw new Error('cannot bootstrap closed server')
    }

    this.httpServer.on('request', (
      /** @type {http.IncomingMessage} */req,
      /** @type {http.ServerResponse} */res
    ) => {
      this.handleServerRequest(req, res)
    })

    const server = this.httpServer
    await util.promisify((/** @type {Callback} */ cb) => {
      server.listen(this.port, cb)
    })()

    const addr = this.httpServer.address()
    if (!addr || typeof addr === 'string') {
      throw new Error('invalid http server address')
    }

    this.hostPort = `localhost:${addr.port}`
    return this.hostPort
  }

  /** @returns {Promise<void>} */
  async close () {
    if (this.httpServer) {
      await util.promisify(
        this.httpServer.close.bind(this.httpServer)
      )()
      this.httpServer = null
    }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @returns {void}
   */
  handleServerRequest (req, res) {
    let body = ''
    req.on('data', (
      /** @type {string} */ chunk
    ) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      const target = req.headers['x-amz-target']
      if (Array.isArray(target)) {
        throw new Error('bad request, array header x-amz-target')
      }

      const parts = (target || '').split('.')
      const lastPart = parts[parts.length - 1]

      /** @type {unknown} */
      let respBody

      try {
        switch (lastPart) {
          case 'DescribeLogGroups':
            respBody = this.describeLogGroups(req, body)
            break

          case 'DescribeLogStreams':
            respBody = this.describeLogStreams(req, body)
            break

          case 'GetLogEvents':
            respBody = this.getLogEvents(req, body)
            break

          default:
            break
        }
      } catch (maybeErr) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const err = /** @type {Error} */ (maybeErr)
        res.statusCode = 400
        res.end(JSON.stringify({ message: err.message }))
        return
      }

      if (typeof respBody !== 'object') {
        res.statusCode = 404
        res.end('Not Found')
        return
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-amz-json-1.1'
      })
      res.end(JSON.stringify(respBody))
    })
  }

  /**
   * @template T
   * @param {T[]} rawItems
   * @param {string} [prevToken]
   * @param {number} [limit]
   * @returns {{ items: T[], nextToken?: string }}
   */
  paginate (rawItems, prevToken, limit) {
    let offset = 0
    if (prevToken) {
      const tokenInfo = this.tokens[prevToken]
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.tokens[prevToken]
      if (!tokenInfo) {
        throw new Error(`invalid nextToken: ${prevToken}`)
      }
      offset = tokenInfo.offset
    }

    const end = offset + (limit || 50)
    const items = rawItems.slice(offset, end)

    /** @type {string | undefined} */
    let nextToken
    if (rawItems.length > end) {
      nextToken = cuuid()
      this.tokens[nextToken] = { offset: end }
    }

    return { items, nextToken }
  }

  /**
   * @param {http.IncomingMessage} req
   * @returns {{ region: string, profile: string, key: string }}
   */
  _getCredentials (req) {
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

    return { profile, region, key: `${profile}::${region}` }
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {string} bodyStr
   * @returns {import('aws-sdk').CloudWatchLogs.DescribeLogGroupsResponse}
   */
  describeLogGroups (req, bodyStr) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = /** @type {DescribeLogGroupsRequest} */ (
      JSON.parse(bodyStr)
    )

    // TODO: default sort
    // TODO: req.logGroupNamePrefix

    const creds = this._getCredentials(req)
    const groups = this.rawGroups[creds.key]
    if (!groups) {
      return { logGroups: [] }
    }

    const page = this.paginate(groups, body.nextToken, body.limit)

    const res = {
      logGroups: page.items,
      nextToken: page.nextToken
    }
    return res
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {string} bodyStr
   * @returns {import('aws-sdk').CloudWatchLogs.DescribeLogStreamsResponse}
   */
  describeLogStreams (req, bodyStr) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = /** @type {DescribeLogStreamsRequest} */ (
      JSON.parse(bodyStr)
    )
    // TODO: req.orderBy

    if (!body.logGroupName) {
      throw new Error('Missing required key \'logGroupName\' in params')
    }
    if (body.orderBy && body.orderBy !== 'LogStreamName' &&
        body.orderBy !== 'LastEventTime'
    ) {
      throw new Error('Invalid required key \'orderBy\' in params')
    }

    const creds = this._getCredentials(req)
    const key = `${creds.key}::${body.logGroupName}`

    let streamsByGroup = this.rawStreams[key]
    if (!streamsByGroup) {
      throw new Error('The specified log group does not exist.')
    }
    streamsByGroup = streamsByGroup.slice()

    if (!body.orderBy || body.orderBy === 'LogStreamName') {
      streamsByGroup.sort((a, b) => {
        if (!a.logStreamName) return -1
        if (!b.logStreamName) return 1
        return a.logStreamName < b.logStreamName ? -1 : 1
      })
    } else if (body.orderBy === 'LastEventTime') {
      if (body.logStreamNamePrefix) {
        throw new Error(
          'Cannot order by LastEventTime with a logStreamNamePrefix.'
        )
      }
    }

    if (body.descending) {
      streamsByGroup.reverse()
    }

    if (body.logStreamNamePrefix) {
      const prefix = body.logStreamNamePrefix
      streamsByGroup = streamsByGroup.filter((s) => {
        return s.logStreamName &&
          s.logStreamName.startsWith(prefix)
      })
    }

    const page = this.paginate(
      streamsByGroup,
      body.nextToken,
      body.limit
    )

    const res = {
      logStreams: page.items,
      nextToken: page.nextToken
    }
    return res
  }

  /**
   * getLogEvents() always returns the tail of the events
   *
   * nextBackwardToken returns another record further back in
   * time.
   *
   * nextForwardToken returns a pointer to go forward in time
   *
   * So if you have 50 events and you get limit=10 return
   *      {
   *          events = 40-49
   *          nextForwardToken = pointer => 50-59
   *          nextBackwardToken = pointer => 30-39
   *      }
   *
   * If someone queries with the backward token return
   *
   *      {
   *          events = 30-39
   *          nextForwardToken = pointer => 40-49
   *          nextBackwardToken = pointer => 20-29
   *      }
   *
   * @param {http.IncomingMessage} req
   * @param {string} bodyStr
   * @returns {import('aws-sdk').CloudWatchLogs.GetLogEventsResponse}
   */
  getLogEvents (req, bodyStr) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body = /** @type {GetLogEventsRequest} */ (
      JSON.parse(bodyStr)
    )

    // TODO: req.startFromHead
    const creds = this._getCredentials(req)
    const key = `${creds.key}::${body.logGroupName}::${body.logStreamName}`
    let events = this.rawEvents[key]
    if (!events) {
      return { events: [] }
    }

    if (body.startTime || body.endTime) {
      const startTime = body.startTime || 0
      const endTime = body.endTime || Infinity
      events = events.filter((e) => {
        if (!e.timestamp) return false
        return startTime <= e.timestamp &&
          endTime > e.timestamp
      })
    }

    let offset = 0
    if (body.nextToken) {
      const tokenInfo = this.tokens[body.nextToken]
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this.tokens[body.nextToken]
      if (!tokenInfo) {
        throw new Error(`invalid nextToken: ${body.nextToken}`)
      }
      offset = tokenInfo.offset
    }

    const limit = body.limit || 10000
    let start = events.length - limit - offset
    let end = events.length - offset

    if (start < 0) {
      start = 0
    }
    if (end < 0) {
      end = 0
    }

    const nextForwardToken = `f/${cuuid()}`
    this.tokens[nextForwardToken] = {
      offset: offset + (-limit)
    }
    const nextBackwardToken = `b/${cuuid()}`
    this.tokens[nextBackwardToken] = {
      offset: offset + limit
    }

    const items = events.slice(start, end)

    const res = {
      events: items,
      nextForwardToken,
      nextBackwardToken
    }
    return res
  }

  /**
   * @param {string} [name]
   * @returns {LogGroup}
   */
  makeLogGroup (name) {
    const logGroupName = name || `my-log-group-${this.gCounter++}`
    return {
      logGroupName,
      creationTime: Date.now(),
      metricFilterCount: 0,
      arn: `arn:aws:logs:us-east-1:0:log-group:${logGroupName}:*`,
      // tslint:disable-next-line: insecure-random
      storedBytes: Math.floor(Math.random() * 1024 * 1024)
    }
  }

  /**
   * @param {string} [name]
   * @returns {LogStream}
   */
  makeLogStream (name) {
    const logStreamName = name || `my-log-stream-${this.gCounter++}`
    return {
      logStreamName,
      creationTime: Date.now(),
      firstEventTimestamp: undefined,
      lastEventTimestamp: undefined,
      lastIngestionTime: undefined,
      arn: 'arn:aws:logs:us-east-1:0:log-group:???:' +
        `log-stream:${logStreamName}`,
      uploadSequenceToken: (
        Math.random().toString() + Math.random().toString() +
        Math.random().toString() + Math.random().toString()
      ).replace(/\./g, ''),
      storedBytes: Math.floor(Math.random() * 1024 * 1024)
    }
  }

  /**
   * @param {number} [timeOffset]
   * @returns {OutputLogEvent}
   */
  makeLogEvent (timeOffset) {
    timeOffset = timeOffset || 0
    return {
      timestamp: Date.now() - timeOffset,
      ingestionTime: Date.now(),
      message: `[INFO]: A log message: ${this.gCounter++}`
    }
  }

  // TODO: getLogGroupFields ?
  // TODO: filterLogEvents ?
}
exports.FakeCloudwatchLogs = FakeCloudwatchLogs

/**
 * @returns {string}
 */
function cuuid () {
  const str = (
    Date.now().toString(16) +
    Math.random().toString(16).slice(2) +
    Math.random().toString(16).slice(2)
  ).slice(0, 32)
  return str.slice(0, 8) + '-' + str.slice(8, 12) + '-' +
    str.slice(12, 16) + '-' + str.slice(16, 20) + '-' +
    str.slice(20)
}

/**
 * @param {string} dirName
 * @returns {Promise<string[] | null>}
 */
async function readdirOptional (dirName) {
  try {
    return await readdirP(dirName)
  } catch (maybeErr) {
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
    const err = /** @type {NodeJS.ErrnoException} */ (maybeErr)
    if (err.code !== 'ENOENT') throw err
  }

  return null
}
