# CLOUDWATCHLOGS

Setup a fake Cloudwatch logs server for testing purposes

## Example

```js
const AWS = require('aws-sdk')
const path = require('path')
const { FakeCloudwatchLogs } = require('fake-aws/cloudwatchlogs')

const ACCESS_KEY = '123'

async function test() {
  const region = 'us-east-1'
  const server = new FakeCloudwatchLogs({
    port: 0,
    cachePath: path.join(__dirname, 'cw-fixtures')
  })

  server.populateGroups(ACCESS_KEY, region, [...])
  server.populateStreams(ACCESS_KEY, region, 'my-group', [...])
  server.populateLogEvents(
    ACCESS_KEY, region, 'my-group', 'my-stream', [...]
  )

  await server.populateFromCache()
  await server.bootstrap()

  const cw = new AWS.CloudwatchLogs({
    region: region,
    endpoint: `http://${server.hostPort}`,
    sslEnabled: false,
    accessKey: ACCESS_KEY,
    secretAccessKey: 'abc'
  })

  const groups = await cw.describeLogGroups().promise()

  // Should be groups you populated or loaded from disk cache
  console.log('the groups', groups.logGroups)

  const events = await cw.getLogEvents({
    logGroupName: 'my-group',
    logStreamName: 'my-stream'
  }).promise()

  // Should be events you populated.
  console.log('the events', events.events)

  await server.close()
}

process.on('unhandledRejection', (err) => { throw err })
test()
```

## Features

Currently this `fake-aws/cloudwatchlogs` module supports various
read APIs like describe log groups, describe streams and fetching
log events.

It also supports APIs designed for making a read-only copy of
production data cached on disks. This allows for using fixture
data for local development and integration tests.

The other functionality can be added in the future, as needed.

The API that are supported are :

 - `DescribeLogGroups`
 - `DescribeLogStreams`
 - `GetLogEvents`

## Recommended testing approach

Create the `FakeCloudwatchLogs` server in your test harness. Then
configure your aws client to point to the endpoint.

You can call `populate` methods to populate mock data into the
fake cloudwatch server.

## Recommended local approach

Create the FakeCloudwatchLogs server on some HTTP port of your
choice.

I recommend copying the `scripts/cache-from-prod.js` into your
application, this will cache production data into a fixtures
directory.

You can configure the FakeCloudwatchLogs to fetch that fixtures
data into memory and then configure your website or application or
server to point to the FakeCloudwatchLogs on whatever port you
choose.

Here is an example snippet from the script

```js
'use strict'

const path = require('path')
const AWS = require('aws-sdk')
const FakeCloudWatchLogs =
  require('fake-aws/cloudwatchlogs').FakeCloudwatchLogs

async function main () {
  const fakeCW = new FakeCloudWatchLogs({
    cachePath: path.join(__dirname, '..', 'fixtures')
  })
  await fakeCW.populateFromCache()

  // 'all' regions or ['us-east-1']
  // await fakeCW.fetchAndCache(AWS, ['us-east-1'])
  await fakeCW.fetchAndCache(AWS, 'all')
}

main().then(null, (err) => {
  process.nextTick(() => { throw err })
})
```

## Docs :

### `const server = new FakeCloudwatchLogs(options)`

Creates a fake Cloudwatch logs server listening on the port
your specified.

 - `options.port`; port to lsiten on, defaults to 0
 - `options.cachePath`; the location to read/write fixtures to.

### `await server.bootstrap()`

Starts the server. After this method completes the field
`server.hostPort` is available and can be used to access the
actual listening port of the server if you choose to listen on
port 0.

### `await server.close()`

Closes the http server.

### `server.populateGroups(accessKey, region, groups)`

Adds groups to the in-memory server. The group must be a valid
`LogGroup`

```js
const group = server.makeLogGroup(name)
```

### `server.populateStreams(accessKey, region, groupName, streams)`

Adds streams to the in-memory server that belong to the `groupName`.
The streams must be a valid `LogStream`

```js
const stream = server.makeLogStream(name)
```

### `server.populateEvents(accessKey, region, groupName, streamName, events)`

Adds events to the in-memory server that belong to the `groupName`
and the `streamName`. The events must be a valid `OutputLogEvent`

```js
const event = server.makeLogEvent()
```

### `await server.populateFromCache()`

This will have the server fetch groups, streams & events from
a cache on disk. This can be useful for writing tests with fixtures
or for starting a local server that loads fixtures from disk.

It's recommende you use the `cacheXToDisk()` methods to create
the fixtures.

### `await server.fetchAndCache(AWS, regions)`

If you want to fetch and cache data from production into
a `fixtures` directory you can call `fetchAndCache()` with
the `AWS` sdk and with the regions you want to cache.

You can pass `['us-east-1']` etc as a the regions or the string
`'all'` if you want to fetch all regions.

### `await server.cacheGroupsToDisk(cacheDir, groups)`

This will write groups to disk in the cache directory. The
groups must be valid `LogGroup` ;

### `await server.cacheStreamsToDisk(cacheDir, groupName, streams)`

This will write streams to disk in the cache directory for the
`groupName` you specify. The streams must be valid `LogStream`

### `await server.cacheEventsToDisk(cacheDir, groupName, streamName, events)`

This will write events to disk in the cache directory for the
`groupName` and `streamName` you specify. The streams must be
valid `OutputLogEvent` ;
