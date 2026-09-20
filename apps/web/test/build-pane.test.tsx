import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QuestionSet, Request } from '@jev-ui/core/browser';
import { WorkbenchProvider, useWorkbench } from '../src/store.js';
import { StatePane, QuestionList, PathInput } from '../src/components/index.js';

const SAMPLE_SET: QuestionSet = {
  name: 'loaded-set',
  state: 'loaded state text',
  questions: { q1: { type: 'noul', instructions: 'x' } },
};

const REPLACED_REQUEST: Request = {
  state: 'replaced state text',
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
      <button
        type="button"
        onClick={() =>
          dispatch({ type: 'wb', action: { type: 'replaceRequest', request: REPLACED_REQUEST } })
        }
      >
        replace
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: 'wb',
            action: {
              type: 'replaceRequest',
              request: {
                state: JSON.parse(JSON.stringify({ a: 2 })) as Request['state'],
                questions: { q1: { type: 'noul', instructions: 'y' } },
              },
            },
          })
        }
      >
        replace-same-state
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

  it('resyncs the textarea on an external replaceRequest with a different state', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'replace' }));
    const textarea = screen.getByRole('textbox', { name: 'State' });
    expect(textarea).toHaveValue('replaced state text');
  });

  it('typing a trailing space onto structured state leaves the textarea exactly as typed', () => {
    render(
      <WorkbenchProvider
        initial={{ state: { a: 1 }, questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    const typed = `${textarea.value} `;
    fireEvent.change(textarea, { target: { value: typed } });
    expect(textarea).toHaveValue(typed);
  });

  it('typing a trailing newline onto structured state leaves the textarea exactly as typed', () => {
    render(
      <WorkbenchProvider
        initial={{ state: { a: 1 }, questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    const typed = `${textarea.value}\n`;
    fireEvent.change(textarea, { target: { value: typed } });
    expect(textarea).toHaveValue(typed);
  });

  it('typing extra inner whitespace onto structured state leaves the textarea exactly as typed', () => {
    render(
      <WorkbenchProvider
        initial={{ state: { a: 1 }, questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    const typed = textarea.value.replace('"a": 1', '"a":  1');
    fireEvent.change(textarea, { target: { value: typed } });
    expect(textarea).toHaveValue(typed);
  });

  it('re-typing {"a": 1} as { "a":1 } stays as typed', () => {
    render(
      <WorkbenchProvider
        initial={{ state: { a: 1 }, questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a": 1}' } });
    expect(textarea).toHaveValue('{"a": 1}');
    fireEvent.change(textarea, { target: { value: '{ "a":1 }' } });
    expect(textarea).toHaveValue('{ "a":1 }');
  });

  it('an unrelated external replaceRequest that carries a value-equal (but new-reference) state does not clobber the user-typed text', () => {
    render(
      <WorkbenchProvider
        initial={{ state: { a: 1 }, questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    // A genuine, non-canonically-formatted edit: single line, not JSON.stringify's
    // 2-space-indented form.
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    expect(textarea).toHaveValue('{"a":2}');

    // Something else entirely (e.g. the JSON pane, or another question) replaces
    // the whole request with a freshly-parsed object. Its `state` field is a new
    // object reference but the SAME value the user just set.
    fireEvent.click(screen.getByRole('button', { name: 'replace-same-state' }));

    expect(textarea).toHaveValue('{"a":2}');
  });

  it('editing a plain-string state is unaffected by the value-equality resync', () => {
    render(
      <WorkbenchProvider
        initial={{ state: 'hello', questions: { q1: { type: 'noul', instructions: 'x' } } }}
      >
        <StatePane />
        <Probe />
      </WorkbenchProvider>,
    );
    const textarea = screen.getByRole('textbox', { name: 'State' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello ' } });
    expect(textarea).toHaveValue('hello ');
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
    expect(card).not.toHaveAttribute('aria-expanded');
    const toggle = card.querySelector('.q-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('probe-selected').textContent).toBe(newId);
  });

  it('the outer group element does not carry aria-expanded', () => {
    render(
      <WorkbenchProvider>
        <QuestionList />
      </WorkbenchProvider>,
    );
    const card = screen.getByRole('group', { name: 'Question question_1' });
    expect(card).not.toHaveAttribute('aria-expanded');
  });

  it('the toggle button has no interactive element nested inside it', () => {
    render(
      <WorkbenchProvider>
        <QuestionList />
      </WorkbenchProvider>,
    );
    const card = screen.getByRole('group', { name: 'Question question_1' });
    const toggle = card.querySelector('.q-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle?.querySelector('button, input, textarea, a')).toBeNull();
  });

  it('tabbing to a collapsed card toggle and pressing Enter selects and expands it', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: '+ Noul' }));
    const idsAfter = ids();
    const firstId = idsAfter[0] as string;
    const firstCard = screen.getByRole('group', { name: `Question ${firstId}` });
    const toggle = firstCard.querySelector('.q-toggle') as HTMLButtonElement;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    toggle.focus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('probe-selected').textContent).toBe(firstId);
    expect(within(firstCard).getByRole('combobox', { name: 'Instructions' })).toBeInTheDocument();
  });

  it('Space also selects and expands a collapsed card toggle', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    await user.click(screen.getByRole('button', { name: '+ Noul' }));
    const idsAfter = ids();
    const firstId = idsAfter[0] as string;
    const firstCard = screen.getByRole('group', { name: `Question ${firstId}` });
    const toggle = firstCard.querySelector('.q-toggle') as HTMLButtonElement;

    toggle.focus();
    await user.keyboard(' ');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('probe-selected').textContent).toBe(firstId);
  });

  it('renaming via the keyboard still works', async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchProvider>
        <QuestionList />
        <Probe />
      </WorkbenchProvider>,
    );
    const renameButton = screen.getByRole('button', { name: 'Rename question question_1' });
    renameButton.focus();
    await user.keyboard('{Enter}');

    const input = screen.getByRole('textbox', { name: 'Rename question question_1' });
    await user.clear(input);
    await user.type(input, 'renamed_kb');
    await user.keyboard('{Enter}');

    expect(ids()).toEqual(['renamed_kb']);
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
