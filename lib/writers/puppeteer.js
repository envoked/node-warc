const { URL } = require('url')
const { STATUS_CODES } = require('http')
const { CRLF } = require('./warcFields')
const WARCWriterBase = require('./warcWriterBase')
const {
  stringifyHeaders,
  stringifyRequestHeaders
} = require('../utils/headerSerializers')
const { httpRequestPath } = require('../utils/url-helpers')
const { noGZ, replaceContentLen } = require('./constants')

/**
 * @extends {WARCWriterBase}
 * @desc WARC Generator for use with puppeteer
 * @see https://github.com/GoogleChrome/puppeteer
 */
class PuppeteerWARCGenerator extends WARCWriterBase {
  /**
   * @desc Create a new PuppeteerWARCGenerator
   * @param {?WARCFileOpts} [defaultOpts]
   */
  constructor (defaultOpts) {
    super(defaultOpts)
    /**
     * @type {URL}
     * @private
     */
    this._UP = new URL('about:blank')
  }
  
  // Helper for timing out promises
  async promiseTimeout(ms, promise) {
    let timeout = new Promise((resolve, reject) => {
      let id = setTimeout(() => {
        clearTimeout(id);
        reject('Timed out in ' + ms + 'ms.')
      }, ms)
    })

    // Returns a race between our timeout and the passed in promise
    return Promise.race([
      promise,
      timeout
    ])
  }

  /**
   * @param {PuppeteerRequestCapturer} capturer - The Puppeteer request capturer that contains requests
   * to be serialized to the WARC
   * @param {WARCGenOpts} genOpts - Options for generating the WARC and optionally generating
   * WARC info, WARC info + Webrecorder Player bookmark list, metadata records
   * @return {Promise<void>} - A Promise that resolves when WARC generation is complete
   */
  async generateWARC (capturer, genOpts) {
    const { warcOpts, winfo, metadata } = genOpts
    this.initWARC(warcOpts.warcPath, warcOpts)
    if (winfo != null) {
      await this.writeWarcInfoRecord(winfo)
    }
    if (genOpts.pages) {
      await this.writeWebrecorderBookmarksInfoRecord(genOpts.pages)
    }
    if (metadata != null) {
      await this.writeWarcMetadata(metadata.targetURI, metadata.content)
    }
    for (let request of capturer.iterateRequests()) {
      try {
        console.log(`Generating record ${i} for: ${request.url()}`);
        await this.promiseTimeout(1000, this.generateWarcEntry(request));
        await this.generateWarcEntry(request)
      } catch (error) {
        /* istanbul ignore next */
        console.error(error)
      }
    }
    return new Promise(resolve => {
      this.once('finished', resolve)
      this.end()
    })
  }

  /**
   * @desc Generate a WARC record
   * @param {Request} request - A Puppeteer Request object
   * @return {Promise<void>}
   */
  async generateWarcEntry (request) {
    if (request.url().indexOf('data:') === 0) return
    const response = request.response()
    this._UP.href = request.url()
    let reqHTTP = `${request.method()} ${httpRequestPath(
      this._UP
    )} HTTP/1.1${CRLF}${stringifyRequestHeaders(
      request.headers(),
      this._UP.host
    )}`
    if (response) {
      let resHTTP = `HTTP/1.1 ${response.status()} ${
        STATUS_CODES[response.status()]
      } ${CRLF}${stringifyHeaders(response.headers())}`
      let body
      let wasError = false
      try {
        body = await response.buffer()
      } catch (e) {
        wasError = true
      }
      if (!wasError) {
        resHTTP = resHTTP.replace(noGZ, '')
        resHTTP = resHTTP.replace(
          replaceContentLen,
          `Content-Length: ${Buffer.byteLength(body, 'utf8')}${CRLF}`
        )
      } else {
        // indicate that this record has 0 content
        resHTTP = resHTTP.replace(
          replaceContentLen,
          `Content-Length: 0${CRLF}`
        )
      }
      return this.writeRequestResponseRecords(
        this._UP.href,
        { headers: reqHTTP, data: request.postData() },
        { headers: resHTTP, data: body }
      )
    }
    return this.writeRequestRecord(this._UP.href, reqHTTP, request.postData())
  }
}

/**
 * @type {PuppeteerWARCGenerator}
 */
module.exports = PuppeteerWARCGenerator
