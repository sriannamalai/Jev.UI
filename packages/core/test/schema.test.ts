import { expect, test } from 'vitest';
import { AnswerSchema, QuestionSchema, RequestSchema } from '../src/schema.js';

const quickStart = {
  state:
    "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  model: 'jev-latest',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which team should handle this',
      criteria: {
        billing: 'Payment or subscription issues',
        technical: 'Bugs or integration problems',
        sales: 'Pricing or account questions',
      },
    },
    frustration: {
      type: 'score',
      instructions: 'How frustrated the customer appears',
      criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
    },
    is_urgent: { type: 'noul', instructions: 'The message conveys urgency or time-sensitivity' },
  },
};

const quickStartAnswers = {
  department: {
    type: 'choice',
    choice: 'billing',
    probabilities: { billing: 0.88, technical: 0.12, sales: 0.0 },
    confidence: 0.81,
  },
  frustration: {
    type: 'score',
    score: 1.05,
    legend: {
      '0': 'Calm, just stating facts',
      '1': 'Frustrated but civil',
      '2': 'Very angry, strong language',
    },
    probabilities: { '0': 0.0, '1': 0.95, '2': 0.05 },
    confidence: 0.92,
  },
  is_urgent: { type: 'noul', noul: 0.95 },
};

test('quick-start request parses', () => {
  expect(RequestSchema.parse(quickStart)).toEqual(quickStart);
});

test('quick-start response answers parse with AnswerSchema', () => {
  for (const answer of Object.values(quickStartAnswers)) {
    expect(AnswerSchema.safeParse(answer).success).toBe(true);
  }
});

test('choice rejects 0 options', () => {
  expect(
    QuestionSchema.safeParse({ type: 'choice', instructions: 'x', criteria: {} }).success,
  ).toBe(false);
});

test('choice rejects 256 options', () => {
  const criteria = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`o${i}`, null]));
  expect(QuestionSchema.safeParse({ type: 'choice', instructions: 'x', criteria }).success).toBe(
    false,
  );
});

test('choice accepts 255 options', () => {
  const criteria = Object.fromEntries(Array.from({ length: 255 }, (_, i) => [`o${i}`, null]));
  expect(QuestionSchema.safeParse({ type: 'choice', instructions: 'x', criteria }).success).toBe(
    true,
  );
});

test('choice accepts null description', () => {
  expect(
    QuestionSchema.safeParse({ type: 'choice', instructions: 'x', criteria: { a: null } }).success,
  ).toBe(true);
});

test('score rejects 1 level', () => {
  expect(
    QuestionSchema.safeParse({ type: 'score', instructions: 'x', criteria: ['only one'] }).success,
  ).toBe(false);
});

test('score rejects 11 levels', () => {
  const criteria = Array.from({ length: 11 }, (_, i) => `level ${i}`);
  expect(QuestionSchema.safeParse({ type: 'score', instructions: 'x', criteria }).success).toBe(
    false,
  );
});

test('score accepts 2 levels', () => {
  expect(
    QuestionSchema.safeParse({ type: 'score', instructions: 'x', criteria: ['low', 'high'] })
      .success,
  ).toBe(true);
});

test('score accepts 10 levels', () => {
  const criteria = Array.from({ length: 10 }, (_, i) => `level ${i}`);
  expect(QuestionSchema.safeParse({ type: 'score', instructions: 'x', criteria }).success).toBe(
    true,
  );
});

test('request rejects empty questions', () => {
  expect(RequestSchema.safeParse({ state: 'x', questions: {} }).success).toBe(false);
});

test('instructions as object passes', () => {
  expect(QuestionSchema.safeParse({ type: 'noul', instructions: { a: 'b' } }).success).toBe(true);
});

test('instructions as array passes', () => {
  expect(QuestionSchema.safeParse({ type: 'noul', instructions: ['a', 'b'] }).success).toBe(true);
});

test('instructions as number fails', () => {
  expect(QuestionSchema.safeParse({ type: 'noul', instructions: 42 }).success).toBe(false);
});

test('noul criteria with only one side passes', () => {
  expect(
    QuestionSchema.safeParse({ type: 'noul', instructions: 'x', criteria: { true: 'x' } }).success,
  ).toBe(true);
});

test('noul criteria with both sides passes', () => {
  expect(
    QuestionSchema.safeParse({
      type: 'noul',
      instructions: 'x',
      criteria: { true: 'yes', false: 'no' },
    }).success,
  ).toBe(true);
});

test('noul criteria with only false passes', () => {
  expect(
    QuestionSchema.safeParse({ type: 'noul', instructions: 'x', criteria: { false: 'no' } })
      .success,
  ).toBe(true);
});

test('noul criteria rejects unknown keys', () => {
  expect(
    QuestionSchema.safeParse({ type: 'noul', instructions: 'x', criteria: { maybe: 'x' } }).success,
  ).toBe(false);
});

test('noul criteria rejects null values', () => {
  expect(
    QuestionSchema.safeParse({ type: 'noul', instructions: 'x', criteria: { true: null } }).success,
  ).toBe(false);
});

test('noul criteria accepts structured Text', () => {
  expect(
    QuestionSchema.safeParse({
      type: 'noul',
      instructions: 'x',
      criteria: { true: { definition: 'x' } },
    }).success,
  ).toBe(true);
});

test('unknown type fails with issue path starting questions.q.type', () => {
  const result = RequestSchema.safeParse({
    state: 'x',
    questions: { q: { type: 'bogus', instructions: 'x' } },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues[0];
    expect(issue?.path.slice(0, 3)).toEqual(['questions', 'q', 'type']);
  }
});
