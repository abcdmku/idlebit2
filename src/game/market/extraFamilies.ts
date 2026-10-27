/** New family → an existing family's hardware gates and market band. Recipes define all actual work. */
export const EXTRA_FAMILIES: Readonly<Record<string, string>> = {
  orMerge: 'andMask', xorMix: 'andMask', bitShift: 'bitFlip', bitCopy: 'bitFlip', bitSwap: 'andMask',
  intDivide: 'multiply', bitRotate: 'crc8',
  checksumBatch: 'hashBatch', searchBatch: 'hashBatch', sortBatch: 'hashBatch', multiplyBatch: 'monteCarlo',
  maskBatch: 'lzCompress', dedupeBatch: 'hashBatch', verifyBatch: 'lzCompress',
  histogram: 'mergeSort', bloomFilter: 'kvGet', sparseMatmul: 'matmul', memAggregate: 'sqlJoin',
  vectorAdd: 'thumbnail', vectorMultiply: 'imageBlur', convolution: 'imageBlur', attention: 'inference', backprop: 'inference',
  fileChecksum: 'logIngest', archive: 'backup', restore: 'backup', dedupeBackup: 'compaction', incrementalBackup: 'backup',
  distributedCache: 'apiFanout', shardRebalance: 'replWrite', checkpointSet: 'mapReduce', clusterVerify: 'payroll',
  distributedJoin: 'teraSort', featureBuild: 'pageRank', embeddingBuild: 'renderFarm', vectorIndex: 'pageRank',
  multiRackBackup: 'teraSort', simulationSweep: 'pageRank',
  zoneRepair: 'drBackup', crossZoneCache: 'activeActive', readQuorum: 'quorumWrite', failoverReplay: 'activeActive',
  zoneCheckpoint: 'drBackup', multiZoneVerify: 'quorumWrite',
  regionalSearch: 'euResidency', globalCdn: 'euResidency', globalBackup: 'euResidency', crossRegionJoin: 'euResidency',
  federatedTrain: 'llmTrain', globalModelRelease: 'llmTrain',
};
