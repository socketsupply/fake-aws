// @ts-check
'use strict'

const path = require('path')
const AWS = require('aws-sdk')
const FakeCloudWatchLogs = require('../index.js').FakeCloudwatchLogs

async function main () {
  const fakeCW = new FakeCloudWatchLogs({
    cachePath: path.join(__dirname, '..', 'fixtures')
  })
  await fakeCW.populateFromCache()

  if (process.argv[2] !== 'download') {
    let totalGroups = 0
    for (const g of Object.values(fakeCW.rawGroups)) {
      totalGroups += g.length
    }
    console.log('groups count', totalGroups)

    let totalStreams = 0
    for (const s of Object.values(fakeCW.rawStreams)) {
      totalStreams += s.length
    }
    console.log('stream count', totalStreams)

    let totalEvents = 0
    for (const e of Object.values(fakeCW.rawEvents)) {
      totalEvents += e.length
    }
    console.log('events count', totalEvents)
    return
  }

  await fakeCW.fetchAndCache(AWS, 'all')
}

main().then(null, (/** @type {Error} */ err) => {
  process.nextTick(() => { throw err })
})
