import path from 'path';
import { settings } from './settings.js';

const resultsPath = path.join(process.cwd(), settings.runnerResults ?? 'runner-results');

export { resultsPath };
