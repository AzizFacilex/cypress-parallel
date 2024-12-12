const path = require('path');
const { settings } = require('./settings');
const resultsPath = path.join(process.cwd(), settings.runnerResults ?? 'runner-results');

module.exports = {
  resultsPath
};
