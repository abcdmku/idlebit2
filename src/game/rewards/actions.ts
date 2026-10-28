import { accept, reject, type HandlerMap } from '../core/actions';
import { amountAdd } from '../amount';
import { compileAll } from '../core/topology';

export const roundRewardHandlers: HandlerMap = {
  claimRoundReward(state, action) {
    const r = state.roundRewards;
    const grant = r.pending.find(row => row.milestone === action.milestone);
    if (!grant || r.claimed.includes(action.milestone)) return reject(state, 'invalid', 'Reward is not waiting to be claimed');
    const roundRewards = { ...r, claimed: [...r.claimed, grant.milestone].sort((a, b) => a - b),
      pending: r.pending.filter(row => row.milestone !== grant.milestone),
      receipts: [...r.receipts, grant],
      grantedCredits: amountAdd(r.grantedCredits, grant.credits), grantedData: amountAdd(r.grantedData, grant.data) };
    const wallet = { ...state.wallet, credits: amountAdd(state.wallet.credits, grant.credits), data: amountAdd(state.wallet.data, grant.data) };
    const research = BigInt(wallet.credits) >= 0n && state.research.stoppedInsolvent
      ? { ...state.research, stoppedInsolvent: false } : state.research;
    const build = { ...state.build, revision: state.build.revision + 1 };
    return accept({ ...state, build, roundRewards, wallet, research, compiled: compileAll(build, research, roundRewards) });
  },
};
