// @ts-check
'use strict'

/** @type {import('assert')} */
const assert = require('assert')

const { test } = require('./test-harness.js')

test('can fetch cloudwatch streams', async (harness, t) => {
  const cw = harness.getCW()

  try {
    await cw.describeLogStreams({
      logGroupName: 'test-group'
    }).promise()
  } catch (maybeErr) {
    const err = toError(maybeErr)
    t.ok(err)
    t.equal(err.message, 'The specified log group does not exist.')
  }

  populateStreams(harness, '123', 'us-east-1', 'test-group', [
    harness.makeLogStream()
  ])

  const res2 = await cw.describeLogStreams({
    logGroupName: 'test-group'
  }).promise()
  t.ok(res2.logStreams)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 1)
  t.equal(
    res2.logStreams[0].logStreamName,
        `my-log-stream-${harness.gCounter - 1}`
  )
})

test('can fetch two batches of streams', async (harness, t) => {
  const cw = harness.getCW()

  const logStreams = [...Array(30).keys()].map((_) => {
    return harness.makeLogStream()
  })
  populateStreams(
    harness, '123', 'us-east-1', 'test-group', logStreams
  )

  const expectedStreams = logStreams.slice().sort((a, b) => {
    if (!a.logStreamName) return -1
    if (!b.logStreamName) return 1
    return a.logStreamName < b.logStreamName ? -1 : 1
  })

  const res1 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group'
  }).promise()
  t.ok(res1.logStreams)
  t.ok(res1.nextToken)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 10)

  t.equal(
    res1.logStreams[0].logStreamName,
    expectedStreams[0].logStreamName
  )
  t.equal(
    res1.logStreams[9].logStreamName,
    expectedStreams[9].logStreamName
  )

  const res2 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group',
    nextToken: res1.nextToken
  }).promise()
  t.ok(res2.logStreams)
  t.ok(res2.nextToken)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 10)
  t.equal(
    res2.logStreams[0].logStreamName,
    expectedStreams[10].logStreamName
  )
  t.equal(
    res2.logStreams[9].logStreamName,
    expectedStreams[19].logStreamName
  )
})

test('can cache streams to disk', async (harness, t) => {
  const cw = harness.getCW()
  const server = harness.getServer()

  const logStreams = Array.from(Array(30), () => {
    return harness.makeLogStream()
  })

  await server.cacheStreamsToDisk(
    '123', 'us-east-1', 'test-group', logStreams
  )
  await server.populateFromCache()

  const expectedStreams = logStreams.slice().sort((a, b) => {
    if (!a.logStreamName) return -1
    if (!b.logStreamName) return 1
    return a.logStreamName < b.logStreamName ? -1 : 1
  })

  const res1 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group'
  }).promise()
  t.ok(res1.logStreams)
  t.ok(res1.nextToken)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 10)
  t.equal(
    res1.logStreams[0].logStreamName,
    expectedStreams[0].logStreamName
  )
  t.equal(
    res1.logStreams[9].logStreamName,
    expectedStreams[9].logStreamName
  )
})

test('can fetch from two regions', async (harness, t) => {
  populateStreams(harness, '123', 'us-east-1', 'test-group-1', [
    harness.makeLogStream()
  ])
  populateStreams(harness, '123', 'us-west-1', 'test-group-2', [
    harness.makeLogStream()
  ])

  const cw1 = harness.buildCWClient('123', 'us-east-1')
  const cw2 = harness.buildCWClient('123', 'us-west-1')

  const res1 = await cw1.describeLogStreams({
    logGroupName: 'test-group-1'
  }).promise()
  const res2 = await cw2.describeLogStreams({
    logGroupName: 'test-group-2'
  }).promise()

  t.ok(res1.logStreams)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 1)
  t.equal(res1.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 2}`)

  t.ok(res2.logStreams)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 1)
  t.equal(res2.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 1}`)
})

test('can fetch from two profiles', async (harness, t) => {
  populateStreams(harness, '123', 'us-east-1', 'test-group-1', [
    harness.makeLogStream()
  ])
  populateStreams(harness, 'abc', 'us-west-1', 'test-group-2', [
    harness.makeLogStream()
  ])

  const cw1 = harness.buildCWClient('123', 'us-east-1')
  const cw2 = harness.buildCWClient('abc', 'us-west-1')

  const res1 = await cw1.describeLogStreams({
    logGroupName: 'test-group-1'
  }).promise()
  const res2 = await cw2.describeLogStreams({
    logGroupName: 'test-group-2'
  }).promise()

  t.ok(res1.logStreams)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 1)
  t.equal(res1.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 2}`)

  t.ok(res2.logStreams)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 1)
  t.equal(res2.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 1}`)
})

test('can fetch from two groups', async (harness, t) => {
  populateStreams(harness, '123', 'us-east-1', 'test-group-1', [
    harness.makeLogStream()
  ])
  populateStreams(harness, '123', 'us-east-1', 'test-group-2', [
    harness.makeLogStream()
  ])

  const cw = harness.getCW()
  const res1 = await cw.describeLogStreams({
    logGroupName: 'test-group-1'
  }).promise()
  const res2 = await cw.describeLogStreams({
    logGroupName: 'test-group-2'
  }).promise()

  t.ok(res1.logStreams)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 1)
  t.equal(res1.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 2}`)

  t.ok(res2.logStreams)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 1)
  t.equal(res2.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 1}`)
})

test('fetch from empty group', async (harness, t) => {
  populateStreams(harness, '123', 'us-east-1', 'test-group-1', [])

  const cw = harness.getCW()
  const res1 = await cw.describeLogStreams({
    logGroupName: 'test-group-1'
  }).promise()

  t.ok(res1.logStreams)
  t.deepEqual(res1.logStreams, [])
})

test('can fetch in descending order', async (harness, t) => {
  const cw = harness.getCW()

  const logStreams = [...Array(30).keys()].map((_) => {
    return harness.makeLogStream()
  })
  populateStreams(
    harness, '123', 'us-east-1', 'test-group', logStreams
  )

  const expectedStreams = logStreams.slice().sort((a, b) => {
    if (!a.logStreamName) return 1
    if (!b.logStreamName) return -1
    return a.logStreamName < b.logStreamName ? 1 : -1
  })

  const res1 = await cw.describeLogStreams({
    limit: 10,
    descending: true,
    logGroupName: 'test-group'
  }).promise()
  t.ok(res1.logStreams)
  t.ok(res1.nextToken)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 10)
  t.equal(
    res1.logStreams[0].logStreamName,
    expectedStreams[0].logStreamName
  )
  t.equal(
    res1.logStreams[9].logStreamName,
    expectedStreams[9].logStreamName
  )

  const res2 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group',
    descending: true,
    nextToken: res1.nextToken
  }).promise()
  t.ok(res2.logStreams)
  t.ok(res2.nextToken)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 10)
  t.equal(
    res2.logStreams[0].logStreamName,
    expectedStreams[10].logStreamName
  )
  t.equal(
    res2.logStreams[9].logStreamName,
    expectedStreams[19].logStreamName
  )
})

test('can fetch with orderBy=LastEventTime', async (harness, t) => {
  const cw = harness.getCW()

  const logStreams = [...Array(30).keys()].map((_) => {
    return harness.makeLogStream()
  })
  populateStreams(
    harness, '123', 'us-east-1', 'test-group', logStreams
  )

  const res1 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group',
    orderBy: 'LastEventTime'
  }).promise()

  t.ok(res1.logStreams)
  t.ok(res1.nextToken)
  assert(res1.logStreams)
  t.equal(res1.logStreams.length, 10)
  t.equal(
    res1.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 30}`
  )
  t.equal(
    res1.logStreams[9].logStreamName,
    `my-log-stream-${harness.gCounter - 21}`
  )

  const res2 = await cw.describeLogStreams({
    limit: 10,
    logGroupName: 'test-group',
    orderBy: 'LastEventTime',
    nextToken: res1.nextToken
  }).promise()
  t.ok(res2.logStreams)
  t.ok(res2.nextToken)
  assert(res2.logStreams)
  t.equal(res2.logStreams.length, 10)
  t.equal(
    res2.logStreams[0].logStreamName,
    `my-log-stream-${harness.gCounter - 20}`
  )
  t.equal(
    res2.logStreams[9].logStreamName,
    `my-log-stream-${harness.gCounter - 11}`
  )
})

test('can fetch with logStreamNamePrefix', async (harness, t) => {
  const logStreams = [
    harness.makeLogStream('test-stream-abc-1'),
    harness.makeLogStream('test-stream-abc-2'),
    harness.makeLogStream('test-stream-def-3'),
    harness.makeLogStream('test-stream-def-4'),
    harness.makeLogStream('test-stream-5'),
    harness.makeLogStream('test-stream-6'),
    harness.makeLogStream('test-junk-stream-1'),
    harness.makeLogStream('test-junk-stream-2')
  ]
  populateStreams(
    harness, '123', 'us-east-1', 'test-group', logStreams
  )

  const cw = harness.getCW()
  const res1 = await cw.describeLogStreams({
    logGroupName: 'test-group',
    logStreamNamePrefix: 'test-stream-'
  }).promise()
  const res2 = await cw.describeLogStreams({
    logGroupName: 'test-group',
    logStreamNamePrefix: 'test-stream-abc'
  }).promise()
  const res3 = await cw.describeLogStreams({
    logGroupName: 'test-group',
    logStreamNamePrefix: 'test-stream-def'
  }).promise()

  assert(res1.logStreams)
  assert(res2.logStreams)
  assert(res3.logStreams)

  t.equal(res1.logStreams.length, 6)
  t.equal(res2.logStreams.length, 2)
  t.equal(res3.logStreams.length, 2)

  t.deepEqual(res1.logStreams.map(s => s.logStreamName), [
    'test-stream-5', 'test-stream-6',
    'test-stream-abc-1', 'test-stream-abc-2',
    'test-stream-def-3', 'test-stream-def-4'
  ])
  t.deepEqual(res2.logStreams.map(s => s.logStreamName), [
    'test-stream-abc-1', 'test-stream-abc-2'
  ])
  t.deepEqual(res3.logStreams.map(s => s.logStreamName), [
    'test-stream-def-3', 'test-stream-def-4'
  ])
})

test('query without logGroupname', async (harness, t) => {
  const cw = harness.getCW()
  try {
    await cw.describeLogStreams({
      logGroupName: ''
    }).promise()
    t.fail()
  } catch (maybeErr) {
    const err = toError(maybeErr)
    t.ok(err)
    t.equal(err.message, 'Missing required key \'logGroupName\' in params')
  }
})

test('query with bad orderBy', async (harness, t) => {
  const cw = harness.getCW()
  try {
    await cw.describeLogStreams({
      logGroupName: 'foo',
      orderBy: 'invalid'
    }).promise()
    t.fail()
  } catch (maybeErr) {
    const err = toError(maybeErr)
    t.ok(err)
    t.equal(err.message, 'Invalid required key \'orderBy\' in params')
  }
})

test('query with orderBy & logStreamNamePrefix', async (harness, t) => {
  const server = harness.getServer()
  server.populateGroups('123', 'us-east-1', [
    harness.makeLogGroup('foo')
  ])
  server.populateStreams('123', 'us-east-1', 'foo', [
    harness.makeLogStream()
  ])

  const cw = harness.getCW()
  try {
    await cw.describeLogStreams({
      logGroupName: 'foo',
      logStreamNamePrefix: 'foobar',
      orderBy: 'LastEventTime'
    }).promise()
    t.fail()
  } catch (maybeErr) {
    const err = toError(maybeErr)
    t.ok(err)
    t.equal(err.message, 'Cannot order by LastEventTime with a logStreamNamePrefix.')
  }
})

/**
 * @param {unknown} e
 * @returns {Error}
 */
function toError (e) {
  return /** @type {Error} */ (e)
}

/**
 * @param {import('./test-harness').TestHarness} harness
 * @param {string} profile
 * @param {string} region
 * @param {string} logGroupName
 * @param {import('aws-sdk').CloudWatchLogs.LogStream[]} streams
 * @returns {void}
 */
function populateStreams (
  harness, profile, region, logGroupName, streams
) {
  const server = harness.getServer()
  server.populateGroups(
    profile, region, [harness.makeLogGroup(logGroupName)]
  )
  if (streams.length === 0) return
  server.populateStreams(profile, region, logGroupName, streams)
}
