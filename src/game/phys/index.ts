/**
 * Power and heat (S4): tick steps 8 and 9, the quiescent check, and pure helpers other domains
 * read. Spec §9 (power), §10 (heat); architecture §1.2, §1.3.
 */
export { powerPhase, wakeSystem } from './power';
export { thermalPhase, lumpEquilibrium, setpointDuty, lift } from './thermal';
export { physSettled } from './settled';
export { clockFactorOf, capFactorOf } from './draw';
export { efficiency } from './efficiency';
export { supplyMultiplier, supplyLossW, supplyUsage } from './supplies';
