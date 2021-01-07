# Fake-AWS

This package contains a set of fake AWS servers that can be
used as part of your offline development flow if you don't have
wifi connectivity to connect to the AWS cloud.

They implement an in memory version of the HTTP api so that
you can use `require('aws-sdk')` to talk to them.

## SERVERS IMPLEMENTED

 - [`'@optoolco/fake-aws/s3`](./s3/README.md)
 - [`'@optoolco/fake-aws/cloudwatchlogs'`](./cloudwatchlogs/README.md)
 - [`'@optoolco/fake-aws/lambda'`](./lambda/README.md)

Currently a subset of three of the clients is implemented
as a fake server. Check out the READMEs for each directory
to see what is implemented.

## USECASE

The main usecase is to allow developing applications that use AWS
cloud resources when you are offline or don't have a stable wifi connection.

We do not recommend using this in a test suite, since it will not implement
all of the edge cases & warts of AWS cloud itself, your better off writing
tests that run against a seperate AWS account for testing purposes.

## install

```
% npm install @optoolco/fake-aws
```

## MIT License.
