import { gapContracts, intendedRepairs } from './burn4-teardown-harness';

const selected = process.argv[2];
if (selected !== 'linux' && selected !== 'partial' && selected !== 'concurrent') {
  throw new Error('Choose linux, partial or concurrent. No environment values are used.');
}
const repair = process.argv[3];
if (repair !== undefined && repair !== 'fixed') throw new Error('Optional mode is fixed.');
gapContracts[selected](repair === 'fixed' ? intendedRepairs[selected] : undefined);
