import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuestionSet } from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { StatePane, QuestionList, PathInput } from '../src/components/index.js';

const SAMPLE_SET: QuestionSet = {
  name: 'loaded-set',
  state: 'loaded state text',
  questions: { q1: { type: 'noul', instructions: 'x' } },
};

function Probe() {
  const { state, dispatch } = useWorkbench();
  return (
    <div>
      <pre data-testid="probe-state">{JSON.stringify(state.wb.request.state)}</pre>
      <pre data-testid="probe-ids">{JSON.stringify(Object.keys(state.wb.request.questions))}</pre>
      <pre data-testid="probe-selected">{state.wb.selectedId}</pre>
      <button
        type="button"
        onClick={() => dispatch({ type: 'wb', action: { type: 'loadSet', set: SAMPLE_SET } })}
      >
        load
      </button>
    </div>
  );
}

function ids(): string[] {
  return JSON.parse(screen.getByTestId('probe-ids').textContent ?? '[]') as string[];
}

function PathInputHarness() {
  const [value, setValue] = useState('');
  return <PathInput value={value} onChange={setValue} paths={['ticket', 'ticket.id']} label="Is" />;
}

describe('StatePane', () => {
  it('typing plain text updates the store state string and the token meter text', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' });
    await user.type(textarea, 'hello world');
    expect(screen.getByTestId('probe-state').textContent).toBe(JSON.stringify('hello world'));
    expect(screen.getByText(/≈ \d+ \/ 32,000 tokens/)).toBeInTheDocument();
  });

  it('typing valid JSON makes the store state an object and shows JSON ✓', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' });
    await user.type(textarea, '{{"a":1}');
    expect(screen.getByTestId('probe-state').textContent).toBe(JSON.stringify({ a: 1 }));
    expect(screen.getByText('JSON ✓')).toBeInTheDocument();
  });

  it('typing truncated JSON shows JSON ✗ (sent as text) and stores the raw string', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' });
    await user.type(textarea, '{{"a":');
    expect(screen.getByTestId('probe-state').textContent).toBe(JSON.stringify('{"a":'));
    expect(screen.getByText('JSON ✗ (sent as text)')).toBeInTheDocument();
  });

  it('typing a bare number keeps the state a string', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' });
    await user.type(textarea, '42');
    expect(screen.getByTestId('probe-state').textContent).toBe(JSON.stringify('42'));
  });

  it('does not reformat the text mid-edit', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' });
    await user.type(textarea, '{{"a":1}');
    expect(textarea).toHaveValue('{"a":1}');
  });

  it('resyncs the textarea on an external state change', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'load' }));
    const textarea = screen.getByRole('textbox', { name: 'State' });
    expect(textarea).toHaveValue('loaded state text');
  });
});

describe('QuestionList / QuestionCard', () => {
  it('+ Score adds a card, selects it, and it is expanded', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: '+ Score' }));
    const idsAfter = ids();
    const newId = idsAfter[idsAfter.length - 1];
    expect(newId).toMatch(/^score_1/);
    const card = screen.getByRole('group', { name: `Question ${newId}` });
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('probe-selected').textContent).toBe(newId);
  });

  it('Delete is disabled with one question', () => {
    render(
      <WorkbenchProvider>
        <QuestionList />
      </WorkbenchProvider>,
    );
    expect(screen.getByRole('button', { name: /Delete question question_1/i })).toBeDisabled();
  });

  it('Move down reorders questionIds', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: '+ Noul' }));
    const before = ids();
    await user.click(screen.getByRole('button', { name: `Move question ${before[0]} down` }));
    const after = ids();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it('Duplicate inserts after the source', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Duplicate question question_1' }));
    const after = ids();
    expect(after[0]).toBe('question_1');
    expect(after[1]).toBe('question_1_copy');
  });

  it('renaming to an existing id shows the duplicate alert and leaves the store unchanged', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: '+ Noul' }));
    const before = ids();
    const newId = before[before.length - 1] as string;
    await user.click(screen.getByRole('button', { name: `Rename question ${newId}` }));
    const input = screen.getByRole('textbox', { name: `Rename question ${newId}` });
    await user.clear(input);
    await user.type(input, 'question_1');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('A question with this id already exists');
    expect(ids()).toEqual(before);
  });

  it('renaming to an invalid id shows the format alert', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Rename question question_1' }));
    const input = screen.getByRole('textbox', { name: 'Rename question question_1' });
    await user.clear(input);
    await user.type(input, '9bad');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Use letters, digits, _ or - (must start with a letter or _)',
    );
    expect(ids()).toEqual(['question_1']);
  });

  it('a valid rename updates the store and keeps the card selected', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Rename question question_1' }));
    const input = screen.getByRole('textbox', { name: 'Rename question question_1' });
    await user.clear(input);
    await user.type(input, 'renamed_q');
    await user.keyboard('{Enter}');
    expect(ids()).toEqual(['renamed_q']);
    expect(screen.getByTestId('probe-selected').textContent).toBe('renamed_q');
  });
});

describe('PathInput', () => {
  it('opens a listbox on an open backtick and matches by prefix', async () => {
    const user = userEvent.setup();
    render(<PathInputHarness />);
    const input = screen.getByRole('combobox', { name: 'Is' });
    await user.type(input, 'Is `tic');
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('ticket')).toBeInTheDocument();
    expect(within(listbox).getByText('ticket.id')).toBeInTheDocument();
  });

  it('ArrowDown+Enter inserts the active path and closes the backtick once', async () => {
    const user = userEvent.setup();
    render(<PathInputHarness />);
    const input = screen.getByRole('combobox', { name: 'Is' });
    await user.type(input, 'Is `tic');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input).toHaveValue('Is `ticket.id`');
  });

  it('Escape closes the listbox', async () => {
    const user = userEvent.setup();
    render(<PathInputHarness />);
    const input = screen.getByRole('combobox', { name: 'Is' });
    await user.type(input, 'Is `tic');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Enter does nothing when there is no open backtick', async () => {
    const user = userEvent.setup();
    render(<PathInputHarness />);
    const input = screen.getByRole('combobox', { name: 'Is' });
    await user.type(input, 'no backtick here');
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('no backtick here');
  });
});
