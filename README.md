# Fake-AWS

This package contains a set of fake AWS servers that can be
used as part of your integration test suite.

They implement an in memory version of the HTTP api so that
you can use `require('aws-sdk')` to talk to them.

## SERVERS IMPLEMENTED

 - [`'fake-aws/s3`](./s3/README.md)
 - [`'fake-aws/cloudwatchlogs'`](./cloudwatchlogs/README.md)
 - [`'fake-aws/lambda'`](./lambda/README.md)

Currently a subset of three of the clients is implemented
as a fake server. Check out the READMEs for each directory
to see what is implemented.

## install

```
% npm install async-level
```

## MIT License.