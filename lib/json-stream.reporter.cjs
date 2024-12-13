'use strict';
/**
 * @module JSONStreamCustom
 * @description Robust Mocha reporter for writing test results to JSON files
 */
const Base = require('mocha/lib/reporters/base');
const constants = require('mocha/lib/runner').constants;
const path = require('path');
const fs = require('fs').promises;
const AsyncLock = require('async-lock');

const { EVENT_SUITE_END, EVENT_RUN_END } = constants;

/**
 * Expose `JSONStreamCustom`.
 */
exports = module.exports = JSONStreamCustom;

/**
 * Constructs a new `JSONStreamCustom` reporter instance.
 *
 * @public
 * @class
 * @memberof Mocha.reporters
 * @extends Mocha.reporters.Base
 * @param {Runner} runner - Instance triggers reporter actions.
 * @param {Object} [options] - runner options
 */
function JSONStreamCustom(runner, options) {
  Base.call(this, runner, options);

  const self = this;
  const lock = new AsyncLock();

  // Configure results path
  const resultsPath = options.reporterOptions?.reportDir || 'runner-results';
  const aggregatedResults = [];

  /**
   * Safely ensure results directory exists.
   * @returns {Promise<void>}
   */
  async function ensureResultsPath() {
    try {
      await fs.mkdir(resultsPath, { recursive: true });
    } catch (err) {
      console.error(
        `[JSONStreamCustom] Failed to create results directory: ${resultsPath}`,
        err
      );
      throw new Error(`Directory creation failed: ${err.message}`);
    }
  }

  /**
   * Sanitize and prepare statistics for JSON output.
   * @returns {Object} Cleaned statistics object
   */
  function prepareStatistics() {
    return {
      ...self.stats,
      duration: calculateDuration(self.stats.start, self.stats.end),
      file: self.runner.suite.file,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Safely write result to a JSON file with atomic write.
   * @param {Object} result - Test result object
   * @returns {Promise<void>}
   */
  async function writeResultFile(result) {
    // Sanitize filename to prevent path traversal
    const sanitizedFileName = result.file
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/__+/g, '_')
      .toLowerCase();

    const specResultPath = path.join(resultsPath, `${sanitizedFileName}.json`);
    const tempResultPath = `${specResultPath}.tmp`;

    try {
      const resultContent = JSON.stringify(result, null, 2);

      // Write to temporary file first
      await fs.writeFile(tempResultPath, resultContent, {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o666
      });

      // Atomically rename temp file to final file
      await fs.rename(tempResultPath, specResultPath);
    } catch (err) {
      console.error(
        `[JSONStreamCustom] Error writing result for ${sanitizedFileName}:`,
        err
      );

      // Attempt to clean up temporary file if it exists
      try {
        await fs.unlink(tempResultPath).catch(() => {});
      } catch {}
    }
  }

  /**
   * Collect suite end statistics.
   */
  runner.on(EVENT_SUITE_END, function () {
    const stats = prepareStatistics();

    if (stats.file) {
      aggregatedResults.push(stats);
    } else {
      console.warn('[JSONStreamCustom] Suite ended with no associated file.');
    }
  });

  /**
   * Write all results when run ends.
   */
  runner.on(EVENT_RUN_END, async function () {
    try {
      // Ensure results path exists
      await ensureResultsPath();

      // Use lock to prevent concurrent file system operations
      await lock.acquire('write-results', async () => {
        // Sequential writing to prevent race conditions
        for (const result of aggregatedResults) {
          await writeResultFile(result);
        }
      });
    } catch (err) {
      console.error(
        '[JSONStreamCustom] Failed to complete test results reporting:',
        err
      );
    }
  });
}

/**
 * Calculate duration between start and end times.
 * @param {number} start - Start time in milliseconds
 * @param {number} end - End time in milliseconds
 * @returns {number} Duration in milliseconds
 */
function calculateDuration(start, end) {
  end = end || Date.now();
  return Math.max(0, end - start);
}

// Reporter description
JSONStreamCustom.description =
  'Writes test statistics to individual JSON files with robust error handling';
