import { spawn } from 'cross-spawn';
import fs from 'fs';
import globEscape from 'glob-escape';
import { isYarn } from 'is-npm';
import camelCase from 'lodash.camelcase';
import path from 'path';
import { settings } from './settings.js';

function getPackageManager() {
  return isYarn ? 'yarn' : process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function createReporterConfigFile(index) {
  const reporterConfigPath = path.join(
    process.cwd(),
    `multi-reporter-config-${index}.json`
  );

  const defaultReporters = [
    'cypress-parallel-extended/json-stream.reporter.cjs',
    'cypress-parallel-extended/simple-spec.reporter.cjs',
  ];
  const reporterEnabled = settings.reporter
    ? ['cypress-parallel-extended/json-stream.reporter.cjs', settings.reporter]
    : defaultReporters;

  const content = {
    reporterEnabled: reporterEnabled.join(', '),
  };

  reporterEnabled.forEach((reporter) => {
    let optionName;
    if (reporter === 'cypress-parallel-extended/json-stream.reporter.cjs') {
      optionName = 'cypressParallelExtendedJsonStreamReporterCjsReporterOptions';
    } else if (reporter === 'cypress-parallel-extended/simple-spec.reporter.cjs') {
      optionName = 'cypressParallelExtendedSimpleSpecReporterCjsReporterOptions';
    } else {
      optionName = `${camelCase(reporter)}ReporterOptions`;
    }

    content[optionName] = {
      reportDir: settings.runnerResults || 'runner-results',
    };
  });

  // Handling user config if the file exists
  try {
    if (settings.reporterOptionsPath) {
      await fs.promises.access(settings.reporterOptionsPath, fs.constants.F_OK);
      const userConfig = JSON.parse(
        await fs.promises.readFile(settings.reporterOptionsPath, 'utf-8')
      );
      const userReporters = userConfig.reporterEnabled
        ? userConfig.reporterEnabled.split(', ')
        : [];

      content.reporterEnabled = Array.from(
        new Set([...content.reporterEnabled.split(', '), ...userReporters])
      ).join(', ');

      Object.keys(userConfig).forEach((key) => {
        if (key !== 'reporterEnabled') {
          content[key] = {
            ...(content[key] || {}),
            ...userConfig[key],
          };
        }
      });
    }
  } catch (err) {
    console.error('Error reading user config file:', err);
  }

  // Ensure the path is passed as a string, not an array
  await fs.promises.writeFile(reporterConfigPath, JSON.stringify(content, null, 2));
  return reporterConfigPath; // Ensure it's a string path
}

async function createCommandArguments(thread, index) {
  const specFiles = thread.list.map((path) => globEscape(path)).join(',');
  const childOptions = [
    'run',
    `${settings.script}`,
    isYarn ? '' : '--',
    '--spec',
    specFiles,
  ];

  // Make sure this is a string path, not an array
  const reporterConfigPath = await createReporterConfigFile(index);
  childOptions.push('--reporter', settings.reporterModulePath);
  childOptions.push('--reporter-options', `configFile=${reporterConfigPath}`);
  childOptions.push(...settings.scriptArguments);

  return childOptions;
}


async function executeThread(thread, index) {
  const packageManager = getPackageManager();
  const commandArguments = await createCommandArguments(thread, index);

  const timeMap = new Map();

  const promise = new Promise((resolve, reject) => {
    const processOptions = {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        CYPRESS_THREAD: (index + 1).toString(),
      },
    };
    console.log(commandArguments)
    console.log(processOptions)
    const child = spawn(packageManager, commandArguments, processOptions);

    child.on('exit', (exitCode) => {
      if (settings.isVerbose) {
        console.log(
          `Thread ${index} likely finished with failure count: ${exitCode}`
        );
      }
      if (settings.shouldBail && exitCode > 0) {
        console.error(
          'BAIL set and thread exited with errors, exit early with error'
        );
        process.exit(exitCode);
      }
      resolve(timeMap);
    });

    child.on('error', (err) => {
      reject(err);
    });
  });

  return promise;
}

export { executeThread };
