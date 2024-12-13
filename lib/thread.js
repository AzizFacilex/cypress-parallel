const spawn = require('cross-spawn');
const { isYarn } = require('is-npm');
const path = require('path');
const fs = require('fs');
const camelCase = require('lodash.camelcase');
const globEscape = require('glob-escape');

const { settings } = require('./settings');
const { sleep } = require('./utility');

function getPackageManager() {
  const pckManager = isYarn
    ? 'yarn'
    : process.platform === 'win32'
    ? 'npm.cmd'
    : 'npm';

  return pckManager;
}

function createReporterOptions(string) {
  const options = string.split(',');
  return options.reduce((result, current) => {
    const parts = current.split('=');
    const optionName = parts[0].trim();
    const optionValue = parts[1].trim();
    result[optionName] = optionValue;

    return result;
  }, {});
}
function createReporterConfigFile(path) {
  const defaultReporters = [
    'cypress-parallel/json-stream.reporter.js',
    'cypress-parallel/simple-spec.reporter.js'
  ];
  const reporterEnabled = settings.reporter
    ? ['cypress-parallel/json-stream.reporter.js', settings.reporter]
    : defaultReporters;

  const content = {
    reporterEnabled: reporterEnabled.join(', ')
  };

  // Apply `reportDir` for specific reporters
  reporterEnabled.forEach((reporter) => {
    let optionName;
    if (reporter === 'cypress-parallel/json-stream.reporter.js') {
      optionName = 'cypressParallelExtendedJsonStreamReporterJsReporterOptions';
    } else if (
      reporter === 'cypress-parallel/simple-spec.reporter.js'
    ) {
      optionName = 'cypressParallelExtendedSimpleSpecReporterJsReporterOptions';
    } else {
      // General case for other reporters
      optionName = `${camelCase(reporter)}ReporterOptions`;
    }

    content[optionName] = {
      reportDir: settings.runnerResults || 'runner-results'
    };
  });

  // If a user-defined config file exists, merge its content
  if (settings.reporterOptionsPath && fs.existsSync(settings.reporterOptionsPath)) {
    const userConfig = JSON.parse(fs.readFileSync(settings.reporterOptionsPath, 'utf-8'));

    // Merge `reporterEnabled` lists
    const userReporters = userConfig.reporterEnabled ? userConfig.reporterEnabled.split(', ') : [];
    content.reporterEnabled = Array.from(new Set([...content.reporterEnabled.split(', '), ...userReporters])).join(', ');

    // Merge reporter options
    Object.keys(userConfig).forEach((key) => {
      if (key !== 'reporterEnabled') {
        content[key] = {
          ...(content[key] || {}),
          ...userConfig[key]
        };
      }
    });
  }

  fs.writeFileSync(path, JSON.stringify(content, null, 2));
}

function createCommandArguments(thread) {
  const specFiles = `${thread.list.map((path) => globEscape(path)).join(',')}`;
  const childOptions = [
    'run',
    `${settings.script}`,
    isYarn ? '' : '--',
    '--spec',
    specFiles
  ];

  let reporterConfigPath;
  reporterConfigPath = path.join(process.cwd(), 'multi-reporter-config.json');
  createReporterConfigFile(reporterConfigPath);

  childOptions.push('--reporter', settings.reporterModulePath);
  childOptions.push('--reporter-options', `configFile=${reporterConfigPath}`);
  childOptions.push(...settings.scriptArguments);

  return childOptions;
}

async function executeThread(thread, index) {
  const packageManager = getPackageManager();
  const commandArguments = createCommandArguments(thread);

  // staggered start (when executed in container with xvfb ends up having a race condition causing intermittent failures)
 //await sleep((index + 1) * 2000);

  const timeMap = new Map();

  const promise = new Promise((resolve, reject) => {
    const processOptions = {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        CYPRESS_THREAD: (index + 1).toString()
      }
    };
    const child = spawn(packageManager, commandArguments, processOptions);

    child.on('exit', (exitCode) => {
      if (settings.isVerbose) {
        console.log(
          `Thread ${index} likely finished with failure count: ${exitCode}`
        );
      }
      // should preferably exit earlier, but this is simple and better than nothing
      if (settings.shouldBail) {
        if (exitCode > 0) {
          console.error(
            'BAIL set and thread exited with errors, exit early with error'
          );
          process.exit(exitCode);
        }
      }
      resolve(timeMap);
    });
  });

  return promise;
}

module.exports = {
  executeThread
};
