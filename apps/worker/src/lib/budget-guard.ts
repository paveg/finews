import { BUDGET, MODEL_PRICING } from '../config/budget';

export type CallStage = 'stage1' | 'stage2';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export function estimateCostMicroUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return Math.ceil(p.input * inputTokens + p.output * outputTokens);
}

export type BudgetSummary = {
  stage1Calls: number;
  stage2Calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsdMicro: number;
};

export class BudgetTracker {
  private stage1Calls = 0;
  private stage2Calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsdMicro = 0;

  assertCanCall(stage: CallStage): void {
    if (stage === 'stage1' && this.stage1Calls >= BUDGET.MAX_STAGE1_CALLS_PER_JOB) {
      throw new BudgetExceededError(
        `Stage 1 call limit reached: ${this.stage1Calls}/${BUDGET.MAX_STAGE1_CALLS_PER_JOB}`,
      );
    }
    if (stage === 'stage2' && this.stage2Calls >= BUDGET.MAX_STAGE2_CALLS_PER_JOB) {
      throw new BudgetExceededError(
        `Stage 2 call limit reached: ${this.stage2Calls}/${BUDGET.MAX_STAGE2_CALLS_PER_JOB}`,
      );
    }
    if (this.inputTokens >= BUDGET.MAX_INPUT_TOKENS_PER_JOB) {
      throw new BudgetExceededError(
        `Input token limit reached: ${this.inputTokens}/${BUDGET.MAX_INPUT_TOKENS_PER_JOB}`,
      );
    }
    if (this.outputTokens >= BUDGET.MAX_OUTPUT_TOKENS_PER_JOB) {
      throw new BudgetExceededError(
        `Output token limit reached: ${this.outputTokens}/${BUDGET.MAX_OUTPUT_TOKENS_PER_JOB}`,
      );
    }
  }

  recordCall(
    stage: CallStage,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    if (stage === 'stage1') this.stage1Calls += 1;
    if (stage === 'stage2') this.stage2Calls += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.costUsdMicro += estimateCostMicroUsd(model, inputTokens, outputTokens);
  }

  summary(): BudgetSummary {
    return {
      stage1Calls: this.stage1Calls,
      stage2Calls: this.stage2Calls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      costUsdMicro: this.costUsdMicro,
    };
  }
}
