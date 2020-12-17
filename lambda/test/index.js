'use strict'

process.on('unhandledRejection', (maybeErr) => {
  const err = /** @type {Error} */ (maybeErr)
  process.nextTick(() => { throw err })
})

/** @type {import('assert')} */
const assert = require('assert')
const util = require('util')
/** @type {import('@pre-bundled/rimraf')} */
const rimrafCb = require('@pre-bundled/rimraf')
const AWS = require('aws-sdk')

const FakeLambdaAPI = require('../index.js').FakeLambdaAPI
const test = require('./test-harness').test

/** @typedef {{ (err?: Error): void; }} Callback */

test('listing functions', async (harness, t) => {
  t.ok(harness.lambdaServer.hostPort)

  const lambda = harness.lambda
  t.ok(lambda)

  const data = await harness.listFunctions()
  t.ok(data)
  t.deepEqual(Object.keys(data), ['Functions'])
  t.deepEqual(data.Functions, [])

  t.end()
})

test('list tags for function', async (harness, t) => {
  const lambdaServer = harness.lambdaServer

  const arn = 'arn:aws:lambda:us-east-1:123456789012:function:account'
  lambdaServer.populateFunctions(
    '123', 'us-east-1', [{
      FunctionName: 'account',
      FunctionArn: arn
    }]
  )

  const data = await harness.listFunctions()
  t.ok(data)

  const lambda = harness.getLambda()

  const tags = await lambda.listTags({
    Resource: arn
  }).promise()

  t.ok(tags)
  t.ok(tags.Tags)
  assert(tags.Tags)

  t.equal(Object.keys(tags.Tags).length, 0)
})

test('listing functions with populate()', async (harness, t) => {
  const lambdaServer = harness.lambdaServer

  lambdaServer.populateFunctions(
    '123', 'us-east-1', [{
      FunctionName: 'account'
    }, {
      FunctionName: 'contact'
    }]
  )

  const data = await harness.listFunctions()
  t.ok(data)
  t.deepEqual(Object.keys(data), ['Functions'])
  t.deepEqual(data.Functions, [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }])
})

test('populate multiple regions / accounts', async (harness, t) => {
  const lambdaServer = harness.lambdaServer

  lambdaServer.populateFunctions(
    '123', 'us-east-1', [{
      FunctionName: 'account1'
    }]
  )
  lambdaServer.populateFunctions(
    '123', 'us-west-1', [{
      FunctionName: 'account2'
    }]
  )
  lambdaServer.populateFunctions(
    '456', 'us-east-1', [{
      FunctionName: 'account3'
    }]
  )
  lambdaServer.populateFunctions(
    '456', 'us-east-2', [{
      FunctionName: 'account4'
    }]
  )

  const lambda1 = harness.buildLambdaClient('123', 'us-east-1')
  const lambda2 = harness.buildLambdaClient('123', 'us-west-1')
  const lambda3 = harness.buildLambdaClient('456', 'us-east-1')
  const lambda4 = harness.buildLambdaClient('456', 'us-east-2')

  const functions1 = await lambda1.listFunctions().promise()
  const functions2 = await lambda2.listFunctions().promise()
  const functions3 = await lambda3.listFunctions().promise()
  const functions4 = await lambda4.listFunctions().promise()

  t.deepEqual(functions1.Functions, [{
    FunctionName: 'account1'
  }])
  t.deepEqual(functions2.Functions, [{
    FunctionName: 'account2'
  }])
  t.deepEqual(functions3.Functions, [{
    FunctionName: 'account3'
  }])
  t.deepEqual(functions4.Functions, [{
    FunctionName: 'account4'
  }])
  t.end()
})

test('listing functions with cache.', async (harness, t) => {
  const lambdaServer = harness.lambdaServer
  await lambdaServer.cacheFunctionsToDisk('123', 'us-east-1', [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }])

  const lambdaServer2 = new FakeLambdaAPI({
    cachePath: harness.cachePath
  })

  const hostPort = await lambdaServer2.bootstrap()
  const lambdaClient = new AWS.Lambda({
    region: 'us-east-1',
    endpoint: `http://${hostPort}`,
    sslEnabled: false,
    accessKeyId: '123',
    secretAccessKey: 'abc'
  })

  const data = await lambdaClient.listFunctions().promise()
  t.ok(data)
  t.deepEqual(Object.keys(data), ['Functions'])
  t.deepEqual(data.Functions, [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }])

  await lambdaServer2.close()
  await util.promisify((/** @type {Callback} */ cb) => {
    rimrafCb(harness.cachePath, cb)
  })()
  t.end()
})

test('listing functions with MaxItems', async (harness, t) => {
  const lambdaServer = harness.lambdaServer

  lambdaServer.populateFunctions('123', 'us-east-1', [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }, {
    FunctionName: 'contact2'
  }, {
    FunctionName: 'contact3'
  }, {
    FunctionName: 'contact4'
  }])

  const data = await harness.listFunctions({
    MaxItems: 3
  })
  t.ok(data)
  t.deepEqual(Object.keys(data), ['NextMarker', 'Functions'])
  t.equal(data.Functions && data.Functions.length, 3)
  t.deepEqual(data.Functions, [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }, {
    FunctionName: 'contact2'
  }])

  t.end()
})

test('listing functions with Marker', async (harness, t) => {
  const lambdaServer = harness.lambdaServer

  lambdaServer.populateFunctions('123', 'us-east-1', [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }, {
    FunctionName: 'contact2'
  }, {
    FunctionName: 'contact3'
  }, {
    FunctionName: 'contact4'
  }])

  const data = await harness.listFunctions({
    MaxItems: 2
  })
  t.ok(data)
  t.deepEqual(Object.keys(data), ['NextMarker', 'Functions'])
  t.deepEqual(data.Functions, [{
    FunctionName: 'account'
  }, {
    FunctionName: 'contact'
  }])

  const data2 = await harness.listFunctions({
    MaxItems: 2,
    Marker: data.NextMarker
  })
  t.ok(data2)
  t.deepEqual(Object.keys(data2), ['NextMarker', 'Functions'])
  t.deepEqual(data2.Functions, [{
    FunctionName: 'contact2'
  }, {
    FunctionName: 'contact3'
  }])

  const data3 = await harness.listFunctions({
    MaxItems: 2,
    Marker: data2.NextMarker
  })
  t.ok(data3)
  t.deepEqual(Object.keys(data3), ['Functions'])
  t.deepEqual(data3.Functions, [{
    FunctionName: 'contact4'
  }])

  t.end()
})
