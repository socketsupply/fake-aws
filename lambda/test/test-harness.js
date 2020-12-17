// @ts-check
'use strict'

const AWS = require('aws-sdk')
/** @type {import('@pre-bundled/tape')} */
const tape = require('@pre-bundled/tape')
const tapeCluster = require('tape-harness')
const path = require('path')
const util = require('util')
/** @type {import('@pre-bundled/rimraf')} */
const rimrafCb = require('@pre-bundled/rimraf')

const FakeLambdaAPI = require('../index').FakeLambdaAPI

const rimraf = util.promisify(rimrafCb)
const FIXTURES_DIR = path.join(__dirname, 'fixtures')

class TestHarness {
  constructor () {
    /** @type {string} */
    this.cachePath = FIXTURES_DIR

    /** @type {FakeLambdaAPI} */
    this.lambdaServer = new FakeLambdaAPI({
      cachePath: this.cachePath
    })
    /** @type {AWS.Lambda|null} */
    this.lambda = null
  }

  /** @returns {Promise<void>} */
  async bootstrap () {
    await rimraf(this.cachePath)
    await this.lambdaServer.bootstrap()
    this.lambda = this.buildLambdaClient('123', 'us-east-1')
  }

  /**
   * @param {string} accessKeyId
   * @param {string} region
   * @returns {AWS.Lambda}
   */
  buildLambdaClient (accessKeyId, region) {
    return new AWS.Lambda({
      region: region,
      endpoint: `http://${this.lambdaServer.hostPort}`,
      sslEnabled: false,
      accessKeyId: accessKeyId,
      secretAccessKey: 'abc'
    })
  }

  /**
   * @returns {AWS.Lambda}
   */
  getLambda () {
    if (!this.lambda) {
      throw new Error('not bootstrapped')
    }
    return this.lambda
  }

  /**
   * @param {{ MaxItems?: number, Marker?: string }} options
   * @returns {Promise<AWS.Lambda.Types.ListFunctionsResponse>}
   */
  async listFunctions (options = {}) {
    if (!this.lambda) {
      throw new Error('not bootstrapped')
    }

    return this.lambda.listFunctions({
      MaxItems: options.MaxItems,
      Marker: options.Marker
    }).promise()
  }

  /** @returns {Promise<void>} */
  async close () {
    await this.lambdaServer.close()
  }
}
exports.test = tapeCluster(tape, TestHarness)
