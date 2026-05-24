import Anthropic from '@anthropic-ai/sdk';
import * as v from 'valibot';
import {
  EXTRACTED_LIMITS,
  ExtractedArticleSchema,
  type ExtractedArticle,
} from '@finews/shared';
import { STAGE1_SYSTEM, stage1UserPrompt } from './prompts';
import { BudgetTracker } from '../lib/budget-guard';
import { withRetry } from '../lib/retry';

// Tool 定義で input_schema を強制する。tool_choice で extract_article を必ず
// 呼ばせ、required フィールドの欠落を Claude 側で防ぐ。プロンプトベースの
// JSON 出力は守られない場合があるため、Phase 1 終盤で tool use 化。
const EXTRACT_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_article',
  description: 'Extract structured financial signals from one news article.',
  input_schema: {
    type: 'object',
    properties: {
      headline_ja: {
        type: 'string',
        maxLength: 80,
        description: '日本語の短い見出し(80字以内)。事実を圧縮する。',
      },
      category: {
        type: 'string',
        enum: ['earnings', 'policy', 'product', 'macro_indicator', 'm&a', 'other'],
      },
      tickers: {
        type: 'array',
        items: { type: 'string' },
        description: '正規化されたティッカー (例: "NVDA", "6857.T")。無ければ空配列。',
      },
      ticker_aliases_used: {
        type: 'array',
        items: { type: 'string' },
        description: '記事中の表記 (例: "Nvidia", "エヌビディア")。無ければ空配列。',
      },
      indicators: {
        type: 'array',
        items: { type: 'string' },
        description: 'マクロ指標名 (例: "CPI", "FOMC")。無ければ空配列。',
      },
      key_numbers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: 'string' },
          },
          required: ['label', 'value'],
        },
      },
      significance: {
        type: 'integer',
        minimum: 1,
        maximum: 5,
        description: '1=些末, 3=注目, 5=市場を動かす重要材料',
      },
      rationale: {
        type: 'string',
        maxLength: 60,
        description: 'なぜ重要かの 60 字以内説明',
      },
      glossary_terms: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            definition: { type: 'string', maxLength: 50 },
          },
          required: ['term', 'definition'],
        },
        description: '専門用語(最大3つ、基本用語 GDP/CPI/FOMC/決算/為替/利回り/ETF は除外)',
      },
    },
    required: [
      'headline_ja',
      'category',
      'tickers',
      'ticker_aliases_used',
      'indicators',
      'key_numbers',
      'significance',
      'rationale',
      'glossary_terms',
    ],
  },
};

export type Stage1Input = {
  title: string;
  description: string;
};

export async function extractArticle(
  input: Stage1Input,
  apiKey: string,
  tracker: BudgetTracker,
): Promise<ExtractedArticle> {
  tracker.assertCanCall('stage1');
  const client = new Anthropic({ apiKey });
  const model = 'claude-haiku-4-5-20251001';
  const response = await withRetry(() =>
    client.messages.create({
      model,
      max_tokens: 1024,
      system: STAGE1_SYSTEM,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_article' },
      messages: [
        {
          role: 'user',
          content: stage1UserPrompt(input.title, input.description),
        },
      ],
    }),
  ) as Anthropic.Messages.Message;
  tracker.recordCall('stage1', model, response.usage.input_tokens, response.usage.output_tokens);

  const toolUse = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
  );
  if (!toolUse) {
    throw new Error(
      `Stage 1: model did not invoke extract_article tool. content=${JSON.stringify(response.content).slice(0, 300)}`,
    );
  }

  const raw = v.parse(ExtractedArticleSchema, toolUse.input);

  // Canonicalize: LLM が maxLength を超過することがあるため、契約値に正規化する。
  // schema 側で maxLength を持たないのは、超過時に全体失敗(=コスト全損)するより
  // truncate して使う方が ROI が高いという判断 (@finews/shared schemas.ts コメント参照)。
  return {
    ...raw,
    headline_ja: raw.headline_ja.slice(0, EXTRACTED_LIMITS.HEADLINE_JA_MAX),
    rationale: raw.rationale.slice(0, EXTRACTED_LIMITS.RATIONALE_MAX),
    glossary_terms: raw.glossary_terms
      .slice(0, EXTRACTED_LIMITS.GLOSSARY_TERMS_MAX_COUNT)
      .map((t) => ({
        term: t.term,
        definition: t.definition.slice(0, EXTRACTED_LIMITS.GLOSSARY_DEFINITION_MAX),
      })),
  };
}
