import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChoiceQuestion, Request, Text } from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { QuestionCard, QuestionList, StatePane } from '../src/components/index.js';

type Ctx = ReturnType<typeof useWorkbench>;
let probe: Ctx | undefined;

function Probe() {
  probe = useWorkbench();
  return null;
}

function getProbe(): Ctx {
  if (!probe) throw new Error('probe not mounted');
  return probe;
}

function readChoice(id: string): ChoiceQuestion {
  return getProbe().state.wb.request.questions[id] as ChoiceQuestion;
}

function choiceRequest(criteria: Record<string, Text | null>): Request {
  return { state: '', questions: { c1: { type: 'choice', instructions: '', criteria } } };
}

function requestWithFrustration(): Request {
  return {
    state: '',
    questions: {
      question_1: { type: 'noul', instructions: 'Is this urgent?' },
      frustration: { type: 'score', instructions: '', criteria: ['a', 'b'] },
    },
  };
}

describe('ChoiceForm', () => {
  it('an empty description is stored as null', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: 'desc' })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Option 0 description' });
    await user.type(field, 'x');
    expect(readChoice('c1').criteria.a).toBe('x');
    await user.clear(field);
    expect(readChoice('c1').criteria.a).toBeNull();
  });

  it('typing a description stores the string', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Option 0 description' });
    await user.type(field, 'hello');
    expect(readChoice('c1').criteria.a).toBe('hello');
  });

  it('Add option appends a unique option_<n> key with a null value', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ option_1: null, option_2: 'x' })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add option' }));
    const question = readChoice('c1');
    expect(Object.keys(question.criteria)).toEqual(['option_1', 'option_2', 'option_3']);
    expect(question.criteria.option_3).toBeNull();
  });

  it('Remove option is disabled with only one option', () => {
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    expect(screen.getByRole('button', { name: 'Remove option 0' })).toBeDisabled();
  });

  it('renaming the middle of three options keeps criteria key order', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: 'middle', c: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const keyInput = screen.getByRole('textbox', { name: 'Option 1 key' });
    await user.clear(keyInput);
    await user.type(keyInput, 'renamed');
    await user.keyboard('{Enter}');
    const question = readChoice('c1');
    expect(Object.keys(question.criteria)).toEqual(['a', 'renamed', 'c']);
    expect(question.criteria.renamed).toBe('middle');
  });

  it('renaming to an existing key shows an alert and leaves the store unchanged', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const keyInput = screen.getByRole('textbox', { name: 'Option 0 key' });
    await user.clear(keyInput);
    await user.type(keyInput, 'b');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Another option already uses this key');
    expect(Object.keys(readChoice('c1').criteria)).toEqual(['a', 'b']);
  });

  it('an empty key shows its alert and leaves the store unchanged', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const keyInput = screen.getByRole('textbox', { name: 'Option 0 key' });
    await user.clear(keyInput);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Option key cannot be empty');
    expect(Object.keys(readChoice('c1').criteria)).toEqual(['a', 'b']);
  });

  it('a __proto__ key shows its alert and leaves the store unchanged', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const keyInput = screen.getByRole('textbox', { name: 'Option 0 key' });
    await user.clear(keyInput);
    await user.type(keyInput, '__proto__');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('This key is not allowed');
    expect(Object.keys(readChoice('c1').criteria)).toEqual(['a', 'b']);
  });

  it('Escape reverts the local key edit', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const keyInput = screen.getByRole('textbox', { name: 'Option 0 key' });
    await user.clear(keyInput);
    await user.type(keyInput, 'zzz');
    await user.keyboard('{Escape}');
    expect(keyInput).toHaveValue('a');
    expect(Object.keys(readChoice('c1').criteria)).toEqual(['a', 'b']);
  });

  it('renaming a key does not remount that row description input', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={choiceRequest({ a: null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    const descriptionBefore = screen.getByRole('combobox', { name: 'Option 0 description' });
    await user.type(descriptionBefore, 'kept');

    const keyInput = screen.getByRole('textbox', { name: 'Option 0 key' });
    await user.clear(keyInput);
    await user.type(keyInput, 'renamed2');
    await user.keyboard('{Enter}');

    const descriptionAfter = screen.getByRole('combobox', { name: 'Option 0 description' });
    expect(descriptionAfter).toBe(descriptionBefore);
    expect(descriptionAfter).toHaveValue('kept');
  });

  it('an integer-like key shows the numeric-keys hint', () => {
    render(
      <WorkbenchProvider initial={choiceRequest({ '1': null, b: null })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    expect(
      screen.getByText('Numeric keys are always listed first, in numeric order.'),
    ).toBeInTheDocument();
  });

  it('a structured description renders read-only', () => {
    render(
      <WorkbenchProvider initial={choiceRequest({ a: { note: 'structured' } })}>
        <QuestionCard id="c1" />
        <Probe />
      </WorkbenchProvider>,
    );
    expect(
      screen.queryByRole('combobox', { name: 'Option 0 description' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('pre.structured')?.textContent).toBe(
      JSON.stringify({ note: 'structured' }, null, 2),
    );
  });
});

describe('field-level validation errors', () => {
  it('a validation error targeting a question selects and expands its card, marking the field invalid', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={requestWithFrustration()}>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );

    expect(getProbe().state.wb.selectedId).toBe('question_1');

    act(() => {
      getProbe().dispatch({ type: 'wb', action: { type: 'runStart' } });
    });
    act(() => {
      getProbe().dispatch({
        type: 'wb',
        action: {
          type: 'runFail',
          error: {
            kind: 'validation',
            message: 'bad levels',
            path: 'questions.frustration.criteria',
          },
        },
      });
    });

    expect(getProbe().state.wb.selectedId).toBe('frustration');

    const frustrationCard = screen.getByRole('group', { name: 'Question frustration' });
    expect(frustrationCard).not.toHaveAttribute('aria-expanded');
    expect(frustrationCard.querySelector('.q-toggle')).toHaveAttribute('aria-expanded', 'true');

    const levelsGroup = within(frustrationCard).getByRole('group', { name: 'Levels' });
    expect(levelsGroup).toHaveAttribute('aria-invalid', 'true');
    expect(within(levelsGroup).getByText('bad levels')).toBeInTheDocument();

    const question1Card = screen.getByRole('group', { name: 'Question question_1' });
    const tag = within(question1Card).getByText('noul');
    await user.click(tag);

    expect(getProbe().state.wb.selectedId).toBe('question_1');
    expect(question1Card).not.toHaveAttribute('aria-expanded');
    expect(question1Card.querySelector('.q-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a validation error targeting state marks the state textarea invalid', () => {
    render(
      <WorkbenchProvider initial={requestWithFrustration()}>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );

    act(() => {
      getProbe().dispatch({ type: 'wb', action: { type: 'runStart' } });
    });
    act(() => {
      getProbe().dispatch({
        type: 'wb',
        action: {
          type: 'runFail',
          error: { kind: 'validation', message: 'bad state', path: 'state' },
        },
      });
    });

    const textarea = screen.getByLabelText('State');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('bad state');
  });

  it('a network error marks nothing', () => {
    render(
      <WorkbenchProvider initial={requestWithFrustration()}>
        <QuestionList />
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );

    act(() => {
      getProbe().dispatch({ type: 'wb', action: { type: 'runStart' } });
    });
    act(() => {
      getProbe().dispatch({
        type: 'wb',
        action: {
          type: 'runFail',
          error: { kind: 'network', message: 'offline', path: 'questions.frustration.criteria' },
        },
      });
    });

    expect(getProbe().state.wb.selectedId).toBe('question_1');
    expect(screen.getByLabelText('State')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
