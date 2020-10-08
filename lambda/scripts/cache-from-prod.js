'use strict'

const path = require('path')
const AWS = require('aws-sdk')
const FakeLambdaAPI = require('../index.js').FakeLambdaAPI

async function main () {
  const fakeLambda = new FakeLambdaAPI({
    cachePath: path.join(__dirname, '..', 'fixtures')
  })
  await fakeLambda.fetchAndCache(AWS, 'all')
}

main().then(null, (/** @type {Error} */ err) => {
  process.nextTick(() => {
    throw err
  })
})
