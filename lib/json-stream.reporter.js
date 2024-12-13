'use strict';

/**
 * @module JSONStreamCustom
 */

/**
 * Module dependencies.
 */
const Base = require('mocha/lib/reporters/base');
const constants = require('mocha/lib/runner').constants;
const path = require('path');
const fs = require('fs').promises;

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
  const resultsPath = options.reporterOptions?.reportDir || 'runner-results';
  const aggregatedResults = [];
  let isResultsPathCreated = false;

  async function ensureResultsPath() {
    if (!isResultsPathCreated) {
      await fs.mkdir(resultsPath, { recursive: true });
      isResultsPathCreated = true;
    }
  }

  function cleanStatistics() {
    return {
      ...self.stats,
      duration: calculateDuration(self.stats.start, self.stats.end),
      file: self.runner.suite.file
    };
  }

  runner.on(EVENT_SUITE_END, function () {
    aggregatedResults.push(cleanStatistics());
  });

  runner.on(EVENT_RUN_END, async function () {
    try {
      await ensureResultsPath();

      await Promise.all(
        aggregatedResults.map((result) => {
          const fileName = result.file.replace(/\\|\//g, '_');
          const specResultPath = path.join(resultsPath, `${fileName}.json`);
          return fs.writeFile(specResultPath, JSON.stringify(result, null, 2));
        })
      );
    } catch (err) {
      console.error('Failed to write aggregated results:', err);
    }
  });
}

function calculateDuration(start, end) {
  end = end || Date.now();
  return end - start;
}

JSONStreamCustom.description = 'Writes statistics per spec file to result files';
