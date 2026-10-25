import { gameOfflineEngine } from './offline';
import { createOfflineMessageHandler } from './offlineHandler';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;
const handle = createOfflineMessageHandler(gameOfflineEngine);
scope.addEventListener('message', event => handle(event.data, response => scope.postMessage(response)));
