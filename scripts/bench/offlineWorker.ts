// worker_threads entry for the offline budget: the same handler and engine as the browser worker.
import { parentPort } from 'node:worker_threads';
import { gameOfflineEngine } from '../../src/platform/offline';
import { createOfflineMessageHandler } from '../../src/platform/offlineHandler';

const port = parentPort;
if (!port) throw new Error('offlineWorker must run in a worker thread');
const handle = createOfflineMessageHandler(gameOfflineEngine);
port.on('message', data => handle(data, response => port.postMessage(response)));
