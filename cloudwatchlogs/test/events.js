// @ts-check
'use strict'

/**
   @typedef {
      import('aws-sdk').CloudWatchLogs.OutputLogEvent
 * } OutputLogEvent
 * @typedef {
      import('aws-sdk').CloudWatchLogs.GetLogEventsResponse
 * } GetLogEventsResponse
 */

const { test } = require('./test-harness.js')

test('can fetch log events', async (harness, t) => {
  const cw = harness.getCW()

  const res1 = await cw.getLogEvents({
    logGroupName: 'test-group',
    logStreamName: 'test-stream'
  }).promise()
  t.ok(res1)
  t.deepEqual(res1.events, [])

  harness.populateEvents('test-group', 'test-stream', [
    harness.makeLogEvent()
  ])

  const res2 = await cw.getLogEvents({
    logGroupName: 'test-group',
    logStreamName: 'test-stream'
  }).promise()
  t.ok(res2)
  t.ok(res2.events)
  assert(res2.events)
  t.equal(res2.events.length, 1)
  t.equal(
    res2.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 1}`
  )
})

test('can fetch uneven pages of log events', async (harness, t) => {
  const cw = harness.getCW()

  /** @type {OutputLogEvent[]} */
  const logEvents = []
  for (let i = 0; i < 100; i++) {
    logEvents.push(harness.makeLogEvent(100 - i))
  }
  harness.populateEvents('test-group', 'test-stream', logEvents)

  /** @type {Array<OutputLogEvent[]>} */
  const pages = []

  /** @type {GetLogEventsResponse | null} */
  let result = null
  do {
    result = await cw.getLogEvents({
      limit: 8,
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
      nextToken: result
        ? result.nextBackwardToken : undefined
    }).promise()

    if (result.events && result.events.length > 0) {
      pages.push(result.events)
    }
  } while (result.events && result.events.length !== 0)

  t.equal(pages.length, 13)
  for (const pair of pages.entries()) {
    t.equal(pair[1].length, pair[0] === 12 ? 4 : 8)
  }
})

test('can fetch pages of log events', async (harness, t) => {
  const cw = harness.getCW()

  /** @type {OutputLogEvent[]} */
  const logEvents = []
  for (let i = 0; i < 50; i++) {
    logEvents.push(harness.makeLogEvent(50 - i))
  }
  harness.populateEvents('test-group', 'test-stream', logEvents)

  const res1 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream'
  }).promise()
  t.ok(res1.events)
  t.ok(res1.nextBackwardToken)
  t.ok(res1.nextForwardToken)
  assert(res1.events)
  t.equal(res1.events.length, 10)
  t.equal(
    res1.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 10}`
  )
  t.equal(
    res1.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 1}`
  )
  const ts0 = res1.events[0].timestamp
  const ts9 = res1.events[9].timestamp
  t.ok(ts0 && ts9 && ts0 < ts9)

  const res2 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    nextToken: res1.nextForwardToken
  }).promise()
  t.ok(res2.events)
  t.equal(res2.events && res2.events.length, 0)
  t.ok(res2.nextBackwardToken)
  t.ok(res2.nextForwardToken)

  const res3 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    nextToken: res2.nextBackwardToken
  }).promise()
  t.ok(res3.events)
  assert(res3.events)
  t.equal(res3.events.length, 10)
  t.ok(res3.nextBackwardToken)
  t.ok(res3.nextForwardToken)
  t.equal(
    res3.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 10}`
  )
  t.equal(
    res3.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 1}`
  )
  const ts3Zero = res3.events[0].timestamp
  const ts3Nine = res3.events[9].timestamp
  t.ok(ts3Zero && ts3Nine && ts3Zero < ts3Nine)

  const res4 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    nextToken: res3.nextBackwardToken
  }).promise()
  t.ok(res4.events)
  assert(res4.events)
  t.equal(res4.events.length, 10)
  t.ok(res4.nextBackwardToken)
  t.ok(res4.nextForwardToken)
  t.equal(
    res4.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 20}`
  )
  t.equal(
    res4.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 11}`
  )
  const ts4Zero = res4.events[0].timestamp
  const ts4Nine = res4.events[9].timestamp
  t.ok(ts4Zero && ts4Nine && ts4Zero < ts4Nine)

  const res5 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    nextToken: res4.nextBackwardToken
  }).promise()
  t.ok(res5.events)
  assert(res5.events)
  t.equal(res5.events.length, 10)
  t.ok(res5.nextBackwardToken)
  t.ok(res5.nextForwardToken)
  t.equal(
    res5.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 30}`
  )
  t.equal(
    res5.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 21}`
  )
  const ts5Zero = res5.events[0].timestamp
  const ts5Nine = res5.events[9].timestamp
  t.ok(ts5Zero && ts5Nine && ts5Zero < ts5Nine)

  const res6 = await cw.getLogEvents({
    limit: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    nextToken: res5.nextForwardToken
  }).promise()
  t.ok(res6.events)
  assert(res6.events)
  t.equal(res6.events.length, 10)
  t.ok(res6.nextBackwardToken)
  t.ok(res6.nextForwardToken)
  t.equal(
    res6.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 20}`
  )
  t.equal(
    res6.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 11}`
  )
  const ts6Zero = res6.events[0].timestamp
  const ts6Nine = res6.events[9].timestamp
  t.ok(ts6Zero && ts6Nine && ts6Zero < ts6Nine)
})

test('can cache events to disk', async (harness, t) => {
  const cw = harness.getCW()
  const server = harness.getServer()

  /** @type {OutputLogEvent[]} */
  const logEvents = []
  for (let i = 0; i < 30; i++) {
    logEvents.push(harness.makeLogEvent(30 - i))
  }

  server.populateStreams('123', 'us-east-1', 'test-group', [
    harness.makeLogStream('test-stream')
  ])

  await server.cacheEventsToDisk(
    '123', 'us-east-1', 'test-group', 'test-stream', logEvents
  )
  await server.populateFromCache()

  const res2 = await cw.getLogEvents({
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    limit: 10
  }).promise()
  t.ok(res2.events)
  assert(res2.events)
  t.equal(res2.events.length, 10)
  t.equal(
    res2.events[0].message,
        `[INFO]: A log message: ${harness.gCounter - 10}`
  )
  t.equal(
    res2.events[9].message,
        `[INFO]: A log message: ${harness.gCounter - 1}`
  )
  const ts0 = res2.events[0].timestamp
  const ts9 = res2.events[9].timestamp
  t.ok(ts0 && ts9 && ts0 < ts9)
})

test('can fetch log events by startTime & endTime',
  async (harness, t) => {
    const cw = harness.getCW()

    /** @type {OutputLogEvent[]} */
    const logEvents = []
    for (let i = 0; i < 100; i++) {
      logEvents.push(harness.makeLogEvent(100 - i))
    }
    harness.populateEvents('test-group', 'test-stream', logEvents)

    const startTime = logEvents[20].timestamp
    const endTime = logEvents[30].timestamp

    const result = await cw.getLogEvents({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
      startTime,
      endTime
    }).promise()

    const events = result.events

    assert(events)
    t.equal(events.length, 10)
    t.equal(
      events[0].message,
            `[INFO]: A log message: ${harness.gCounter - 80}`
    )
    t.equal(
      events[9].message,
            `[INFO]: A log message: ${harness.gCounter - 71}`
    )
  }
)

/**
 * @param {unknown} value
 * @returns {asserts value}
 */
function assert (value) {
  if (!value) throw new Error('value is falsey')
}
