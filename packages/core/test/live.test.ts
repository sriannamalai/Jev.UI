import { describe, expect, test } from 'vitest';
import { run } from '../src/index.js';
import type { Request } from '../src/index.js';

// Opt-in only: hits the real TypeSafe API and costs a fraction of a cent.
// Run with `JEV_LIVE=1 pnpm --filter @jev-ui/core test live`. Skipped by
// default so `pnpm test` never makes a network call or needs a key.
const quickStart: Request = {
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

describe.skipIf(process.env.JEV_LIVE !== '1')('live API', () => {
  test('runs the quick-start request against the real TypeSafe API', async () => {
    const result = await run(quickStart);

    const department = result.answers.department;
    expect(department?.type).toBe('choice');
    if (department?.type === 'choice') {
      // Loose bounds only: model versions move over time, and this
      // asserts direction (a Stripe integration failure is a technical
      // issue), not an exact probability.
      expect(department.choice).toBe('technical');
    }

    const isUrgent = result.answers.is_urgent;
    expect(isUrgent?.type).toBe('noul');
    if (isUrgent?.type === 'noul') {
      expect(isUrgent.noul).toBeGreaterThan(0.8);
    }

    const frustration = result.answers.frustration;
    expect(frustration?.type).toBe('score');
    if (frustration?.type === 'score') {
      expect(frustration.score).toBeGreaterThanOrEqual(0.5);
      expect(frustration.score).toBeLessThanOrEqual(1.5);
    }

    expect(result.model).toMatch(/^jev-\d/);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.costUsd).toBeGreaterThan(0);
  }, 30_000);
});
