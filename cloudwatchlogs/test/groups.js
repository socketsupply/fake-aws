// @ts-check
'use strict'

/** @type {import('assert')} */
const assert = require('assert')

const { test } = require('./test-harness.js')

test('can fetch cloudwatch groups', async (harness, t) => {
  const cw = harness.getCW()

  const res = await cw.describeLogGroups().promise()
  t.ok(res.logGroups)
  assert(res.logGroups)
  t.equal(res.logGroups.length, 0)

  const server = harness.getServer()
  server.populateGroups('123', 'us-east-1', [
    harness.makeLogGroup()
  ])

  const res2 = await cw.describeLogGroups().promise()
  t.ok(res2.logGroups)
  assert(res2.logGroups)
  t.equal(res2.logGroups.length, 1)
  t.equal(
    res2.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 1}`
  )
})

test('can fetch limit=10 groups', async (harness, t) => {
  const cw = harness.getCW()
  const server = harness.getServer()

  const logGroups = [...Array(100).keys()].map((_) => {
    return harness.makeLogGroup()
  })
  server.populateGroups('123', 'us-east-1', logGroups)

  const res1 = await cw.describeLogGroups().promise()
  t.ok(res1.logGroups)
  assert(res1.logGroups)
  t.equal(res1.logGroups.length, 50)
  t.equal(
    res1.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 100}`
  )
  t.equal(
    res1.logGroups[49].logGroupName,
        `my-log-group-${harness.gCounter - 51}`
  )

  const res2 = await cw.describeLogGroups({
    limit: 10
  }).promise()
  t.ok(res2.logGroups)
  assert(res2.logGroups)
  t.equal(res2.logGroups.length, 10)
  t.equal(
    res2.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 100}`
  )
  t.equal(
    res2.logGroups[9].logGroupName,
        `my-log-group-${harness.gCounter - 91}`
  )
})

test('can fetch two batches of groups', async (harness, t) => {
  const cw = harness.getCW()
  const server = harness.getServer()

  const logGroups = [...Array(30).keys()].map((_) => {
    return harness.makeLogGroup()
  })
  server.populateGroups('123', 'us-east-1', logGroups)

  const res1 = await cw.describeLogGroups({
    limit: 10
  }).promise()
  t.ok(res1.logGroups)
  t.ok(res1.nextToken)
  assert(res1.logGroups)
  t.equal(res1.logGroups.length, 10)
  t.equal(
    res1.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 30}`
  )
  t.equal(
    res1.logGroups[9].logGroupName,
        `my-log-group-${harness.gCounter - 21}`
  )

  const res2 = await cw.describeLogGroups({
    limit: 10,
    nextToken: res1.nextToken
  }).promise()
  t.ok(res2.logGroups)
  t.ok(res2.nextToken)
  assert(res2.logGroups)
  t.equal(res2.logGroups.length, 10)
  t.equal(
    res2.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 20}`
  )
  t.equal(
    res2.logGroups[9].logGroupName,
        `my-log-group-${harness.gCounter - 11}`
  )
})

test('can cache groups to disk', async (harness, t) => {
  const cw = harness.getCW()
  const server = harness.getServer()

  const logGroups = [...Array(30).keys()].map((_) => {
    return harness.makeLogGroup()
  })

  await server.cacheGroupsToDisk('123', 'us-east-1', logGroups)
  await server.populateFromCache()

  const res1 = await cw.describeLogGroups({
    limit: 10
  }).promise()
  t.ok(res1.logGroups)
  t.ok(res1.nextToken)
  assert(res1.logGroups)
  t.equal(res1.logGroups.length, 10)
  t.equal(
    res1.logGroups[0].logGroupName,
        `my-log-group-${harness.gCounter - 30}`
  )
  t.equal(
    res1.logGroups[9].logGroupName,
        `my-log-group-${harness.gCounter - 21}`
  )
})

test('can fetch from two regions', async (harness, t) => {
  const server = harness.getServer()

  server.populateGroups('123', 'us-east-1', [
    harness.makeLogGroup()
  ])
  server.populateGroups('123', 'us-west-1', [
    harness.makeLogGroup()
  ])

  const cw1 = harness.buildCWClient('123', 'us-east-1')
  const cw2 = harness.buildCWClient('123', 'us-west-1')

  const res1 = await cw1.describeLogGroups().promise()
  const res2 = await cw2.describeLogGroups().promise()

  t.ok(res1.logGroups)
  assert(res1.logGroups)
  t.equal(res1.logGroups.length, 1)
  t.equal(res1.logGroups[0].logGroupName,
    `my-log-group-${harness.gCounter - 2}`)

  t.ok(res2.logGroups)
  assert(res2.logGroups)
  t.equal(res2.logGroups.length, 1)
  t.equal(res2.logGroups[0].logGroupName,
    `my-log-group-${harness.gCounter - 1}`)
})

test('can fetch from two profiles', async (harness, t) => {
  const server = harness.getServer()

  server.populateGroups('123', 'us-east-1', [
    harness.makeLogGroup()
  ])
  server.populateGroups('abc', 'us-west-1', [
    harness.makeLogGroup()
  ])

  const cw1 = harness.buildCWClient('123', 'us-east-1')
  const cw2 = harness.buildCWClient('abc', 'us-west-1')

  const res1 = await cw1.describeLogGroups().promise()
  const res2 = await cw2.describeLogGroups().promise()

  t.ok(res1.logGroups)
  assert(res1.logGroups)
  t.equal(res1.logGroups.length, 1)
  t.equal(res1.logGroups[0].logGroupName,
    `my-log-group-${harness.gCounter - 2}`)

  t.ok(res2.logGroups)
  assert(res2.logGroups)
  t.equal(res2.logGroups.length, 1)
  t.equal(res2.logGroups[0].logGroupName,
    `my-log-group-${harness.gCounter - 1}`)
})
