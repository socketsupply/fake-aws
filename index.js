// @ts-check
'use strict'

const s3 = require('./s3/index.js')
const lambda = require('./lambda/index.js')

exports.s3 = s3
exports.lambda = lambda
