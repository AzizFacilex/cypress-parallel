'use strict';
const Base = require('mocha/lib/reporters/base');
const constants = require('mocha/lib/runner').constants;
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');  // Recommend adding uuid package

const { EVENT_SUITE_END, EVENT_RUN_END } = constants;

function JSONStreamCustom(runner, options) {
  Base.call(this, runner, options);

  const self = this;
  const resultsPath = options.reporterOptions?.reportDir || 'runner-results';
  const aggregatedResults = [];

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
   * Safely ensure results directory exists with more robust error handling.
   * @returns {Promise<void>}
   */
  async function ensureResultsPath() {
    try {
      await fs.mkdir(resultsPath, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error(
          `[JSONStreamCustom] Failed to create results directory: ${resultsPath}`,
          err
        );
        throw err;
      }
    }
  }

  /**
   * Generate a unique, safe filename to prevent collisions
   * @param {string} baseFileName - Original filename
   * @returns {string} Sanitized and unique filename
   */
  function generateUniqueFileName(baseFileName) {
    const sanitizedFileName = baseFileName
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/__+/g, '_')
      .toLowerCase();
    
    const uniqueId = uuidv4().split('-')[0];  // Use first segment of UUID
    return `${sanitizedFileName}_${uniqueId}.json`;
  }

  /**
   * Atomic write with unique filename and retry mechanism
   * @param {Object} result - Test result object
   * @returns {Promise<void>}
   */
  async function writeResultFileAtomic(result) {
    let specResultPath = path.join(resultsPath, generateUniqueFileName(result.file));
    let tempResultPath = `${specResultPath}.tmp`;

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Write content with atomic guarantees
        await fs.writeFile(tempResultPath, JSON.stringify(result, null, 2), {
          encoding: 'utf8',
          flag: 'wx',  // Exclusive write, fails if file exists
          mode: 0o600  // More restrictive permissions
        });

        // Atomically rename
        await fs.rename(tempResultPath, specResultPath);
        return;  // Success, exit function
      } catch (err) {
        retryCount++;

        if (err.code === 'EEXIST') {
          // File already exists, generate new unique name
          specResultPath = path.join(resultsPath, generateUniqueFileName(result.file));
          tempResultPath = `${specResultPath}.tmp`;
        } else {
          console.error(
            `[JSONStreamCustom] Error writing result (Attempt ${retryCount}):`,
            err
          );

          // Clean up temp file if it exists
          try {
            await fs.unlink(tempResultPath).catch(() => {});
          } catch {}

          if (retryCount >= maxRetries) {
            throw err;  // Rethrow after max retries
          }
        }
      }
    }
  }

  runner.on(EVENT_SUITE_END, function () {
    const stats = prepareStatistics();
    if (stats.file) {
      aggregatedResults.push(stats);
    } else {
      console.warn('[JSONStreamCustom] Suite ended with no associated file.');
    }
  });

  runner.on(EVENT_RUN_END, async function () {
    try {
      await ensureResultsPath();

      // Parallel writes with controlled concurrency
      await Promise.all(
        aggregatedResults.map(result => writeResultFileAtomic(result))
      );
    } catch (err) {
      console.error(
        '[JSONStreamCustom] Failed to complete test results reporting:',
        err
      );
    }
  });
}

// Add description for the reporter
JSONStreamCustom.description = 
  'Writes test statistics to individual JSON files with robust error handling';

module.exports = JSONStreamCustom;