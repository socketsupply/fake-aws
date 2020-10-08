# S3
a fake s3 server for testing purposes.

This is a zero dependency implementation that stores all objects
in memory

## Example

```js
const FakeS3 = require('fake-aws/s3');
const AWS = require('aws-sdk')

const server = new FakeS3({
  buckets: ['my-bucket'],
  prefix: 'files-i-care-about/'
})

// starts the server on specified port
await server.bootstrap()

// this field now exists and contains the actual hostPort
server.hostPort

// Create an S3 client connected to it
const s3 = new AWS.S3({
  endpoint: `http://${server.hostPort}`
  sslEnabled: false,
  accessKeyId: '123',
  secretAccessKey: 'abc',
  s3ForcePathStyle: true
})

// can wait for files
const files = await server.waitForFiles('my-bucket', 2)
// will yield you back when two files have been uploaded

// shutdown server
await server.close()
```

## Support

The following `aws-sdk` methods are supported

 - `s3.listBuckets()`
 - `s3.listObjectsV2()`
 - `s3.upload()`

## Features

Currently the `fake-aws/s3` module supports two different ways
of getting data in & out of it.

One where you just set up the `fake-aws/s3` server and use the `s3`
api to upload and list files.

The second is to use the `populateFromCache()` method to
load a bunch of fixtures of disk into memory.

## Recommended local approach

I recommend copying the `script/cache-from-prod.js` script into
your application and using it to download production data onto
your laptop so that it can be used for offline development.

## Docs

### `var server = new FakeS3(options)`

 - `options.prefix` : prefix for `getFiles()` and `waitForFiles()` ;
      necessary to support multi part uploads, otherwise
      `waitForFiles()` will return too early when N parts have
      been uploaded.
 - `options.buckets` : an array of buckets to create.

### `server.hostPort`

This is the `hostPort` that the server is listening on, this
will be non-null after `bootstrap()` finishes.

### `await server.bootstrap()`

starts the server

### `await getFiles(bucket)`

gets all files in a bucket

### `await waitForFiles(bucket, count)`

this will wait for file uploads to finish and calls `getFiles()`
and returns them once it's finished.

This is useful if your application does background uploads and you
want to be notified when they are finished.

### `await server.close()`

closes the HTTP server.

### `await server.populateFromCache(cacheDir)`

This will have the server fetch buckets & objects from a cache on
disk. This can be useful for writing tests with fixtures or starting
a local server with fixtures.

It's recommended you use `cacheBucketsToDisk()` and
`cacheObjectsToDisk()` to create the fixtures directory.

### `await server.cacheBucketsToDisk(cacheDir, accessKeyId, data)`

Calling this will write buckets to the disk cache. The `data`
parameter is the response of `s3.listBuckets()`.

The accessKeyId is the name of the AWS account you are writing to.
If you only use one account you can just specify 'default' otherwise
you can get it from the S3 client instance.

### `await server.cacheObjectsToDisk(cacheDir, accessKeyId, bucketName, data)`

Calling this will write objects to the disk cache. The `data`
parameter is the response of `s3.listObjectsV2()`

The accessKeyId is the name of the AWS account you are writing to.
If you only use one account you can just specify 'default' otherwise
you can get it from the S3 client instance.
