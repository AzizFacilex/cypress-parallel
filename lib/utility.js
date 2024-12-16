import fs from 'fs';
import path from 'path';
import { settings } from './settings.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatTime = function (timeMs) {
  const seconds = Math.ceil(timeMs / 1000);
  const sec = seconds % 60;
  const min = Math.floor(seconds / 60);
  let res = '';

  if (min) res += `${min}m `;
  res += `${sec}s`;
  return res;
};

function generateWeightsFile(specWeights, totalDuration, totalWeight) {
  Object.keys(specWeights).forEach((spec) => {
    specWeights[spec].weight = Math.floor(
      (specWeights[spec].time / totalDuration) * totalWeight
    );
  });
  const weightsJson = JSON.stringify(specWeights);
  try {
    fs.writeFileSync(`${settings.weightsJSON}`, weightsJson, 'utf8');
    console.log('Weights file generated.')
  } catch(e) {
    console.error(e)
  }
}

async function collectResults() {
  const resultsPath = settings.runnerResults;
  const results = new Map();

  try {
    const resultFiles = await fs.promises.readdir(resultsPath);

    // Collect results from files
    await Promise.all(resultFiles.map(async (fileName) => {
      const filePath = path.join(resultsPath, fileName);
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const result = JSON.parse(content);
        results.set(result.file, result);
      } catch (error) {
        console.error(`Error reading or parsing file ${fileName}:`, error);
      }
    }));

    // Delete the entire results directory after collection
    await fs.promises.rm(resultsPath, { 
      recursive: true, 
      force: true 
    });

    return results;
  } catch (error) {
    console.error('Error in collecting and cleaning up results:', error);
    
    try {
      await fs.promises.rm(resultsPath, { 
        recursive: true, 
        force: true 
      });
    } catch (cleanupError) {
      console.error('Error during cleanup:', cleanupError);
    }

    // Rethrow original error or return empty results
    throw error;
  }
}
export { collectResults, formatTime, generateWeightsFile, sleep };

