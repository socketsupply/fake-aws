// @ts-check
'use strict'

/** @type {import('assert')} */
const assert = require('assert')

const { test } = require('./test-harness.js')

test('can fetch logStream info in realtime', async (harness, t) => {
  const evs = Array.from(Array(3), () => {
    return harness.makeLogEvent()
  })
  harness.populateEvents('test-group', 'test-stream', evs)

  const p = harness.writeStreamingEvents({
    delay: 3,
    count: 10,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    allocate: () => harness.makeLogEvent()
  })
  const p2 = harness.readStreamInterval({
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    delay: 8,
    count: 3
  })

  const [events, streams] = await Promise.all([p, p2])

  t.equal(events.length, 10)
  t.equal(streams.length, 3)

  const events1 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= streams[0].ts
  }).reverse()
  const events2 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= streams[1].ts
  }).reverse()
  const events3 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= streams[2].ts
  }).reverse()

  t.equal(
    events1[0].ingestionTime, streams[0].stream.lastIngestionTime,
    'first stream ingestionTime correct'
  )
  t.equal(streams[0].stream.firstEventTimestamp, evs[0].timestamp)
  t.equal(streams[0].stream.lastEventTimestamp, evs[2].timestamp)

  /**
   * Most of the time there were 3 events published between
   * the first and second stream read because the delay=3 which
   * gets two events in. sometimes theres only 1 event in between
   * because of the non-deterministic delay of `setTimeout()`.
   */
  t.ok(
    events2.length - events1.length >= 2 &&
    events2.length - events1.length <= 3,
    'three events between 1 & 2'
  )
  t.equal(
    events2[0].ingestionTime, streams[1].stream.lastIngestionTime,
    'second stream ingestionTime correct'
  )
  t.equal(streams[1].stream.firstEventTimestamp, evs[0].timestamp)
  t.equal(streams[1].stream.lastEventTimestamp, evs[2].timestamp)
  t.equal(streams[1].stream.creationTime, streams[0].stream.creationTime)

  t.ok(
    events3.length - events2.length >= 2 &&
    events3.length - events2.length <= 3,
    'three events between 2 & 3'
  )
  t.equal(
    events3[0].ingestionTime, streams[2].stream.lastIngestionTime,
    'third stream ingestionTime correct'
  )
  t.equal(streams[2].stream.firstEventTimestamp, evs[0].timestamp)
  t.equal(streams[2].stream.lastEventTimestamp, evs[2].timestamp)
  t.equal(streams[2].stream.creationTime, streams[0].stream.creationTime)
})

test('can fetch logStream info for HISTORICAL stream',
  async (harness, t) => {
    const evs = Array.from(Array(3), () => {
      return harness.makeLogEvent()
    })
    harness.populateEvents('test-group', 'test-stream', evs)

    const events = await harness.writeStreamingEvents({
      delay: 3,
      count: 10,
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
      allocate: () => harness.makeLogEvent()
    })
    const streams = await harness.readStreamInterval({
      logGroupName: 'test-group',
      logStreamName: 'test-stream',
      delay: 8,
      count: 3
    })

    t.equal(events.length, 10)
    t.equal(streams.length, 3)

    t.equal(
      events[9].ingestionTime, streams[0].stream.lastIngestionTime,
      'first stream ingestionTime correct'
    )
    t.equal(streams[0].stream.firstEventTimestamp, evs[0].timestamp)
    t.equal(streams[0].stream.lastEventTimestamp, evs[2].timestamp)

    t.equal(
      events[9].ingestionTime, streams[1].stream.lastIngestionTime,
      'second stream ingestionTime correct'
    )
    t.equal(streams[1].stream.firstEventTimestamp, evs[0].timestamp)
    t.equal(streams[1].stream.lastEventTimestamp, evs[2].timestamp)
    t.equal(streams[1].stream.creationTime, streams[0].stream.creationTime)

    t.equal(
      events[9].ingestionTime, streams[2].stream.lastIngestionTime,
      'third stream ingestionTime correct'
    )
    t.equal(streams[2].stream.firstEventTimestamp, evs[0].timestamp)
    t.equal(streams[2].stream.lastEventTimestamp, evs[2].timestamp)
    t.equal(streams[2].stream.creationTime, streams[0].stream.creationTime)
  }
)

test('can query logStream info for LIVE stream', {
  ingestionDelay: 30
}, async (harness, t) => {
  const evs = Array.from(Array(3), () => {
    return harness.makeLogEvent()
  })
  harness.populateEvents('test-group', 'test-stream', evs)

  const stream1 = await harness.getLogStream(
    'test-group', 'test-stream'
  )

  const p = harness.writeStreamingEvents({
    delay: 6,
    count: 20,
    logGroupName: 'test-group',
    logStreamName: 'test-stream',
    allocate: () => harness.makeLogEvent()
  })

  await harness.sleep(20)
  const stream2 = await harness.getLogStream(
    'test-group', 'test-stream'
  )

  await harness.sleep(40)
  const stream3 = await harness.getLogStream(
    'test-group', 'test-stream'
  )

  await harness.sleep(40)
  const stream4 = await harness.getLogStream(
    'test-group', 'test-stream'
  )

  const events = await p
  t.equal(events.length, 20)
  t.ok(stream1 && stream2 && stream3 && stream4)
  assert(stream1 && stream2 && stream3 && stream4)

  const events1 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= stream2.ts
  }).reverse()
  const events2 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= stream3.ts
  }).reverse()
  const events3 = events.filter((e) => {
    return e.ingestionTime && e.ingestionTime <= stream4.ts
  }).reverse()

  t.equal(stream1.stream.lastIngestionTime, evs[2].ingestionTime)
  t.equal(stream1.stream.firstEventTimestamp, evs[0].timestamp)
  t.equal(stream1.stream.lastEventTimestamp, evs[2].timestamp,
    'Expect stream1 lastEventTimestamp to be default'
  )

  t.equal(stream2.stream.lastIngestionTime, events1[0].ingestionTime)
  t.equal(stream2.stream.firstEventTimestamp, evs[0].timestamp)
  t.equal(stream2.stream.lastEventTimestamp, evs[2].timestamp,
    'Expect stream2 lastEventTimestamp to be outdated'
  )

  t.equal(stream3.stream.lastIngestionTime, events2[0].ingestionTime)
  t.equal(stream3.stream.firstEventTimestamp, evs[0].timestamp)
  t.ok(
    events2.some((event) => {
      return event.timestamp === stream3.stream.lastEventTimestamp
    }),
    'Expect stream3 lastEventTimestamp to be updated'
  )

  t.equal(stream4.stream.lastIngestionTime, events3[0].ingestionTime)
  t.equal(stream4.stream.firstEventTimestamp, evs[0].timestamp)

  const recentEvents = events3.filter((e) => {
    return events1.every((e2) => e2.timestamp !== e.timestamp)
  })

  /**
   * This assertion might fail most of the time the lastEventTimestamp
   * is `events3[??].timestamp` but sometimes its one of the timestamps
   * that happened AFTER `events1`
   */
  t.ok(
    recentEvents.some((event) => {
      return event.timestamp === stream4.stream.lastEventTimestamp
    }),
    'Expect stream3 lastEventTimestamp to be updated'
  )
})
