import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, Request, ScoreQuestion } from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { QuestionCard, ScoreForm } from '../src/components/index.js';

function QuestionProbe(props: { id: string }) {
  const { state } = useWorkbench();
  return (
    <pre data-testid={`probe-q-${props.id}`}>
      {JSON.stringify(state.wb.request.questions[props.id])}
    </pre>
  );
}

function readQuestion(id: string): Question {
  const text = screen.getByTestId(`probe-q-${id}`).textContent ?? 'null';
  return JSON.parse(text) as Question;
}

function scoreRequest(criteria: string[]): Request {
  return { state: '', questions: { s1: { type: 'score', instructions: '', criteria } } };
}

describe('NoulForm', () => {
  it('editing instructions updates the store', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionCard id="question_1" />
        <QuestionProbe id="question_1" />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Instructions' });
    await user.type(field, 'hello');
    expect(readQuestion('question_1')).toMatchObject({ instructions: 'hello' });
  });

  it('typing a Yes means value creates criteria: { true }', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionCard id="question_1" />
        <QuestionProbe id="question_1" />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Yes means' });
    await user.type(field, 'agrees');
    expect(readQuestion('question_1')).toMatchObject({ criteria: { true: 'agrees' } });
  });

  it('clearing Yes means removes the criteria key entirely', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionCard id="question_1" />
        <QuestionProbe id="question_1" />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Yes means' });
    await user.type(field, 'agrees');
    await user.clear(field);
    const question = readQuestion('question_1');
    expect('criteria' in question).toBe(false);
  });

  it('structured instructions render read-only with no textbox for it', () => {
    render(
      <WorkbenchProvider
        initial={{
          state: '',
          questions: { q1: { type: 'noul', instructions: { note: 'structured' } } },
        }}
      >
        <QuestionCard id="q1" />
      </WorkbenchProvider>,
    );
    expect(screen.getByText('structured — edit in JSON')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Instructions' })).not.toBeInTheDocument();
    expect(document.querySelector('pre.structured')?.textContent).toBe(
      JSON.stringify({ note: 'structured' }, null, 2),
    );
  });

  it('offers a path completion for Instructions against the JSON state', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider
        initial={{ state: { ticket: {} }, questions: { q1: { type: 'noul', instructions: '' } } }}
      >
        <QuestionCard id="q1" />
      </WorkbenchProvider>,
    );
    const field = screen.getByRole('combobox', { name: 'Instructions' });
    await user.type(field, '`tic');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('ticket')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('`ticket`');
  });
});

describe('ScoreForm', () => {
  it('Add level appends an empty level', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={scoreRequest(['a', 'b'])}>
        <QuestionCard id="s1" />
        <QuestionProbe id="s1" />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Add level' }));
    const question = readQuestion('s1') as ScoreQuestion;
    expect(question.criteria).toEqual(['a', 'b', '']);
  });

  it('Remove level is disabled at 2 levels', () => {
    render(
      <WorkbenchProvider initial={scoreRequest(['a', 'b'])}>
        <QuestionCard id="s1" />
      </WorkbenchProvider>,
    );
    expect(screen.getByRole('button', { name: 'Remove level 0' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove level 1' })).toBeDisabled();
  });

  it('Add level is disabled at 10 levels', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `level ${i}`);
    render(
      <WorkbenchProvider initial={scoreRequest(ten)}>
        <QuestionCard id="s1" />
      </WorkbenchProvider>,
    );
    expect(screen.getByRole('button', { name: 'Add level' })).toBeDisabled();
  });

  it('removing the middle of three levels leaves the other two texts in the right inputs', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={scoreRequest(['first', 'second', 'third'])}>
        <QuestionCard id="s1" />
        <QuestionProbe id="s1" />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove level 1' }));
    const question = readQuestion('s1') as ScoreQuestion;
    expect(question.criteria).toEqual(['first', 'third']);
    expect(screen.getByRole('combobox', { name: 'Level 0' })).toHaveValue('first');
    expect(screen.getByRole('combobox', { name: 'Level 1' })).toHaveValue('third');
  });

  it('editing a level updates only that index', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider initial={scoreRequest(['first', 'second', 'third'])}>
        <QuestionCard id="s1" />
        <QuestionProbe id="s1" />
      </WorkbenchProvider>,
    );
    const level1 = screen.getByRole('combobox', { name: 'Level 1' });
    await user.clear(level1);
    await user.type(level1, 'updated');
    const question = readQuestion('s1') as ScoreQuestion;
    expect(question.criteria).toEqual(['first', 'updated', 'third']);
  });

  it('a criteria error marks the Levels fieldset invalid and shows the alert', () => {
    render(
      <WorkbenchProvider>
        <ScoreForm
          id="s1"
          question={{ type: 'score', instructions: '', criteria: ['a', 'b'] }}
          paths={[]}
          error={{ field: 'criteria', message: 'bad' }}
        />
      </WorkbenchProvider>,
    );
    const fieldset = screen.getByRole('group', { name: 'Levels' });
    expect(fieldset).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('bad');
  });
});

describe('QuestionForm / choice', () => {
  it('renders the choice form and does not crash', () => {
    render(
      <WorkbenchProvider
        initial={{
          state: '',
          questions: {
            c1: { type: 'choice', instructions: '', criteria: { yes: null, no: null } },
          },
        }}
      >
        <QuestionCard id="c1" />
      </WorkbenchProvider>,
    );
    expect(screen.getByRole('group', { name: 'Options' })).toBeInTheDocument();
  });
});
