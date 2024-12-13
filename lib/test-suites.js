import fg from 'fast-glob';
import { promises as fs } from 'fs';
import path from 'path';
import { settings } from './settings.js';
const getFilePathsByPath = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const fullPath = path.join(dir, entry.name);
      return entry.isDirectory() ? getFilePathsByPath(fullPath) : fullPath;
    })
  );
  return files.flat();
};

const getFilePathsByFastGlob = async (pattern) => {
  try {
    const files = await fg(pattern);
    return files;
  } catch (error) {
    console.error('Error during fast-glob execution:', error);
    throw error;
  }
};

const getTestSuitePaths = async () => {
  try {
    const isPattern = settings.testSuitesPath.includes('*');
    const fileList = settings.testSuitesPaths
      ? settings.testSuitesPaths
      : isPattern
      ? await getFilePathsByFastGlob(settings.testSuitesPath)
      : await getFilePathsByPath(settings.testSuitesPath);

    console.log(`${fileList.length} test suite(s) found.`);
    if (settings.isVerbose) console.log('Paths to found suites:', fileList);

    settings.threadCount = Math.min(settings.threadCount, fileList.length);
    if (settings.threadCount < fileList.length) {
      console.warn(
        `Limiting thread count to ${settings.threadCount} due to fewer test suites.`
      );
    }
    return fileList;
  } catch (error) {
    console.error('Error while retrieving test suite paths:', error);
    throw error;
  }
};

function getMaxPathLenghtFrom(testSuitePaths) {
  return Math.max(...testSuitePaths.map((p) => p.length), 10) + 3;
}


async function getFileLineCount(filePath) {
  // Estimating weight by line count
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n').length;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return 0; 
  }
}

async function distributeTestsByWeight(testSuitePaths) {
  let specWeights = {};
  
  try {
    const weightFile = await fs.readFile(settings.weightsJSON, 'utf8');
    specWeights = JSON.parse(weightFile);
  } catch {
    console.warn(`Weight file not found: ${settings.weightsJSON}. Using line count as weight.`);
  }

  const sortedTests = await Promise.all(
    testSuitePaths.map(async (file) => {
      const weight = specWeights[file]?.weight || await getFileLineCount(file);
      return {
        file,
        weight
      };
    })
  );

  sortedTests.sort((a, b) => b.weight - a.weight);

  const threads = Array.from({ length: settings.threadCount }, () => ({
    weight: 0,
    list: []
  }));

  sortedTests.forEach(({ file, weight }) => {
    const thread = threads[0];
    thread.list.push(file);
    thread.weight += weight;
    threads.sort((a, b) => a.weight - b.weight);
  });

  return threads.sort((a, b) => b.weight - a.weight);
}


export { distributeTestsByWeight, getMaxPathLenghtFrom, getTestSuitePaths };
