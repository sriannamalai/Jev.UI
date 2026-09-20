import { z } from 'zod';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type Text = string | Json[] | { [k: string]: Json };

const JsonSchema = z.json();

export const TextSchema = z.union([
  z.string(),
  z.array(JsonSchema),
  z.record(z.string(), JsonSchema),
]);

export const DEFAULT_MODEL = 'jev-latest';

export const LIMITS = {
  choiceMax: 255,
  scoreMin: 2,
  scoreMax: 10,
  stateBudgetTokens: 32000,
  requestBudgetTokens: 64000,
} as const;

export const NoulQuestionSchema = z.object({
  type: z.literal('noul'),
  instructions: TextSchema,
  criteria: z
    .strictObject({
      true: TextSchema.optional(),
      false: TextSchema.optional(),
    })
    .optional(),
});

export const ChoiceQuestionSchema = z.object({
  type: z.literal('choice'),
  instructions: TextSchema,
  criteria: z.record(z.string(), TextSchema.nullable()).refine((o) => {
    const n = Object.keys(o).length;
    return n >= 1 && n <= LIMITS.choiceMax;
  }, 'choice criteria must have between 1 and 255 options'),
});

export const ScoreQuestionSchema = z.object({
  type: z.literal('score'),
  instructions: TextSchema,
  criteria: z.array(TextSchema).min(LIMITS.scoreMin).max(LIMITS.scoreMax),
});

export const QuestionSchema = z.discriminatedUnion('type', [
  NoulQuestionSchema,
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
]);

const QuestionsSchema = z
  .record(z.string(), QuestionSchema)
  .refine((o) => Object.keys(o).length >= 1, 'questions must have at least one entry');

export const RequestSchema = z.object({
  state: TextSchema,
  model: z.string().optional(),
  questions: QuestionsSchema,
});

export const QuestionSetSchema = z.object({
  name: z.string(),
  questions: QuestionsSchema,
  state: TextSchema.optional(),
  model: z.string().optional(),
});

export const NoulAnswerSchema = z.object({
  type: z.literal('noul'),
  noul: z.number(),
});

export const ChoiceAnswerSchema = z.object({
  type: z.literal('choice'),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const ScoreAnswerSchema = z.object({
  type: z.literal('score'),
  score: z.number(),
  legend: z.record(z.string(), TextSchema),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const AnswerSchema = z.discriminatedUnion('type', [
  NoulAnswerSchema,
  ChoiceAnswerSchema,
  ScoreAnswerSchema,
]);

export const RunResultSchema = z.object({
  answers: z.record(z.string(), AnswerSchema),
  model: z.string(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  latencyMs: z.number(),
  costUsd: z.number(),
});

export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionType = 'noul' | 'choice' | 'score';
export type Request = z.infer<typeof RequestSchema>;
export type QuestionSet = z.infer<typeof QuestionSetSchema>;
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type Answer = z.infer<typeof AnswerSchema>;

export interface RunResult {
  answers: Record<string, Answer>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  costUsd: number;
}

export interface ModelInfo {
  name: string;
  description: string;
  releaseDate: string;
}

export interface SetSummary {
  name: string;
  questionCount: number;
  valid: boolean;
  error?: string;
}
