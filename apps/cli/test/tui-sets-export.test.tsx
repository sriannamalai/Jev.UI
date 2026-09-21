import { useEffect } from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SetError } from '@jev-ui/core';
import type {
  HistoryStore,
  QuestionSet,
  Request,
  RunResult,
  SetsStore,
  SetSummary,
} from '@jev-ui/core';
import { displayWidth } from '../src/tui/bars.js';
import { KEYMAP } from '../src/tui/keys.js';
import { App } from '../src/tui/App.js';
import type { TuiDeps } from '../src/tui/App.js';

// Full-App integration tests for: open/save sets, export, editing
// the whole request in $EDITOR, quit confirmation, and the grouped help
// overlay. The editor's own spawn/temp-file mechanics live in
// tui-editor.test.ts; here `deps.openEditor` is a plain fake.

const REQUEST: Request = {
  state: 'A customer wrote in.',
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which department?',
      criteria: { technical: null, sales: null, billing: null },
    },
    is_urgent: {
      type: 'noul',
      instructions: 'Is this urgent?',
    },
  },
};

const TRIAGE_SET: QuestionSet = {
  name: 'triage',
  state: 'Loaded state',
  questions: {
    first: { type: 'noul', instructions: 'first question' },
    second: { type: 'noul', instructions: 'second question' },
  },
};

const RESULT: RunResult = {
  answers: {},
  model: 'jev-1.13.0',
  usage: { inputTokens: 1, outputTokens: 1 },
  latencyMs: 1,
  costUsd: 0,
};

function fakeSets(overrides: Partial<SetsStore> = {}): SetsStore {
  return {
    dir: '/sets',
    list: vi.fn(async () => []),
    load: vi.fn(async () => {
      throw new Error('unused');
    }),
    save: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeHistory(): HistoryStore {
  return {
    file: '/history.jsonl',
    append: vi.fn(async () => undefined),
    recent: vi.fn(async () => []),
  };
}

function makeDeps(overrides: Partial<TuiDeps> = {}): TuiDeps {
  return {
    run: vi.fn(async () => RESULT),
    listModels: vi.fn(async () => []),
    sets: fakeSets(),
    history: fakeHistory(),
    keyConfigured: true,
    openEditor: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
    fileExists: vi.fn(async () => false),
    cwd: vi.fn(() => '/cwd'),
    ...overrides,
  };
}

/** A real exit signal. `useApp().exit()` makes Ink tear the whole React
 * tree down, so this probe's effect cleanup runs exactly when the app
 * exits — unlike `unmount()`, which the test itself controls. */
function ExitProbe(props: { onExit: () => void }): null {
  const { onExit } = props;
  useEffect(() => onExit, [onExit]);
  return null;
}

function renderApp(deps: TuiDeps, initial: Request) {
  const exited = vi.fn();
  const instance = render(
    <>
      <App deps={deps} initial={initial} />
      <ExitProbe onExit={exited} />
    </>,
  );
  return { ...instance, exited };
}

/** Dirty the document by replacing the state text with "changed". */
async function makeDirty(stdin: { write(s: string): void }): Promise<void> {
  stdin.write('i');
  await tick();
  await backspace(stdin, 30);
  stdin.write('changed');
  await tick();
  stdin.write('\r');
  await tick();
}

const CTRL_C = '\u0003';

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function backspace(stdin: { write(s: string): void }, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    stdin.write('\u007f');
    await tick();
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Every `o`/`s`/`e`/`E` flow does at least one real `await` (a fake
 * `deps.sets.list/load/save`, `deps.writeFile`, `deps.openEditor`) before
 * the resulting prompt/notice renders, and each hop across an `await`
 * needs its own microtask *and* a render + Ink effect flush to actually
 * show up in `lastFrame()`. A single `setTimeout(0)` is enough for a
 * one-hop transition but not reliably enough once several are chained
 * (e.g. discard-confirm -> list()  -> list prompt), so anything that
 * follows an async dep call polls for the text it expects instead of
 * assuming a fixed number of ticks was enough. */
async function waitForText(lastFrame: () => string | undefined, text: string): Promise<void> {
  await vi.waitFor(
    () => {
      if (!(lastFrame() ?? '').includes(text)) {
        throw new Error(`frame does not contain: ${text}`);
      }
    },
    { timeout: 2000, interval: 5 },
  );
  // The text can commit to the frame slightly before a freshly-mounted
  // prompt's own useInput effect has flushed and attached its listener;
  // give it a couple more ticks so the next keystroke isn't sent into a
  // still-unmounting/mounting gap.
  await tick();
  await tick();
}

describe('o: open a set', () => {
  it('lists sets, an invalid one cannot be picked, Enter loads the chosen set and selects its first question', async () => {
    const summaries: SetSummary[] = [
      { name: 'triage', questionCount: 2, valid: true },
      { name: 'broken', questionCount: 0, valid: false, error: 'bad json' },
    ];
    const load = vi.fn(async (name: string) => {
      if (name === 'triage') return TRIAGE_SET;
      throw new Error('should not load an invalid set');
    });
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({ list: vi.fn(async () => summaries), load }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');

    let frame = lastFrame() ?? '';
    expect(frame).toContain('triage');
    expect(frame).toContain('broken');
    expect(frame).toContain('bad json');

    // Move to the invalid entry and try to pick it — must not load.
    stdin.write('j');
    await tick();
    stdin.write('\r');
    await tick();
    expect(load).not.toHaveBeenCalled();
    frame = lastFrame() ?? '';
    expect(frame).toContain('Open set');

    // Move back to the valid entry and pick it.
    stdin.write('k');
    await tick();
    stdin.write('\r');
    await waitForText(lastFrame, 'Loaded state');
    expect(load).toHaveBeenCalledWith('triage');

    frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toMatch(/▸ \[noul] first/);
  });

  it('asks to discard unsaved changes first; n keeps them, y proceeds', async () => {
    const summaries: SetSummary[] = [{ name: 'triage', questionCount: 2, valid: true }];
    const load = vi.fn(async () => TRIAGE_SET);
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({ list: vi.fn(async () => summaries), load }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);

    // Dirty the state.
    stdin.write('i');
    await tick();
    await backspace(stdin, 30);
    stdin.write('changed');
    await tick();
    stdin.write('\r');
    await tick();

    stdin.write('o');
    await waitForText(lastFrame, 'Discard unsaved changes?');

    stdin.write('n');
    await tick();
    expect(load).not.toHaveBeenCalled();
    expect(stripAnsi(lastFrame() ?? '')).toContain('changed');

    stdin.write('o');
    await waitForText(lastFrame, 'Discard unsaved changes?');
    stdin.write('y');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await tick();
    expect(load).toHaveBeenCalledWith('triage');
  });

  it('shows a SetError from load without changing anything', async () => {
    const summaries: SetSummary[] = [{ name: 'triage', questionCount: 2, valid: true }];
    const load = vi.fn(async () => {
      throw new SetError('notFound', 'Question set not found: triage.json', {
        file: 'triage.json',
      });
    });
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({ list: vi.fn(async () => summaries), load }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await waitForText(lastFrame, '✕ Question set not found: triage.json');
    expect(stripAnsi(lastFrame() ?? '')).toContain('department');
  });

  it('shows "No sets in <dir>" for an empty list', async () => {
    const deps = makeDeps({ columns: 140, sets: fakeSets({ list: vi.fn(async () => []) }) });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('o');
    await waitForText(lastFrame, 'No sets in /sets');
  });
});

describe('s / S: save', () => {
  it('saves directly with a known set name', async () => {
    const save = vi.fn(async () => undefined);
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({
        save,
        list: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
        load: vi.fn(async () => TRIAGE_SET),
      }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    // Load a set first so setName is known.
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await waitForText(lastFrame, 'Loaded state');

    stdin.write('s');
    await waitForText(lastFrame, 'Saved triage');
    expect(save).toHaveBeenCalledWith('triage', expect.objectContaining({ name: 'triage' }));
  });

  it('prompts for a name when none is known; rejects a bad name; accepts a valid one', async () => {
    const save = vi.fn(async () => undefined);
    const deps = makeDeps({ columns: 140, sets: fakeSets({ save }) });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('s');
    await tick();
    stdin.write('Bad Name');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain(
      'Use lowercase letters, digits, - or _ (must start with a letter or digit)',
    );
    expect(save).not.toHaveBeenCalled();

    await backspace(stdin, 'Bad Name'.length);
    stdin.write('triage');
    await tick();
    stdin.write('\r');
    await waitForText(lastFrame, 'Saved triage');
    expect(save).toHaveBeenCalledWith('triage', expect.objectContaining({ name: 'triage' }));
  });

  it('S always prompts, even with a known set name', async () => {
    const save = vi.fn(async () => undefined);
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({
        save,
        list: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
        load: vi.fn(async () => TRIAGE_SET),
      }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await waitForText(lastFrame, 'Loaded state');

    stdin.write('S');
    await waitForText(lastFrame, 'Save as');
  });
});

describe('e: export', () => {
  it('writes <cwd>/<setName>.sh for cURL, containing $TYPESAFE_API_KEY and never a raw Bearer value', async () => {
    const writeFile = vi.fn<(path: string, content: string) => Promise<void>>(
      async () => undefined,
    );
    const deps = makeDeps({
      columns: 140,
      cwd: vi.fn(() => '/cwd'),
      writeFile,
      sets: fakeSets({
        list: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
        load: vi.fn(async () => TRIAGE_SET),
      }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await waitForText(lastFrame, 'Loaded state');

    stdin.write('e');
    await waitForText(lastFrame, 'Export as');
    stdin.write('c');
    await waitForText(lastFrame, 'Wrote ./triage.sh');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path, content] = writeFile.mock.calls[0]!;
    expect(path).toBe('/cwd/triage.sh');
    expect(content).toContain('$TYPESAFE_API_KEY');
    expect(content).not.toMatch(/Bearer (?!\$TYPESAFE_API_KEY\b)\S+/);
  });

  it('never writes outside the working directory, whatever a set body calls itself', async () => {
    const writeFile = vi.fn<(path: string, content: string) => Promise<void>>(
      async () => undefined,
    );
    const deps = makeDeps({
      columns: 140,
      cwd: vi.fn(() => '/cwd'),
      writeFile,
      sets: fakeSets({
        list: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
        // A hostile file body: core forces the file name, but the TUI must
        // not trust whatever reaches `state.setName` either.
        load: vi.fn(async () => ({ ...TRIAGE_SET, name: '../../evil' })),
      }),
    });
    const { lastFrame, stdin } = renderApp(deps, REQUEST);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');
    stdin.write('\r');
    await waitForText(lastFrame, 'Loaded state');

    stdin.write('e');
    await waitForText(lastFrame, 'Export as');
    stdin.write('c');
    await waitForText(lastFrame, 'Wrote ./request.sh');

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [path] = writeFile.mock.calls[0]!;
    expect(path).toBe('/cwd/request.sh');
    expect(path).not.toContain('..');
  });

  it('asks to overwrite when the file already exists; n writes nothing', async () => {
    const writeFile = vi.fn(async () => undefined);
    const deps = makeDeps({
      columns: 140,
      fileExists: vi.fn(async () => true),
      writeFile,
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('e');
    await tick();
    stdin.write('p');
    await waitForText(lastFrame, 'Overwrite');

    stdin.write('n');
    await tick();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('never replaces a pending quit confirmation with the overwrite prompt', async () => {
    const writeFile = vi.fn(async () => undefined);
    let resolveExists: (exists: boolean) => void = () => undefined;
    const deps = makeDeps({
      columns: 140,
      fileExists: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveExists = resolve;
          }),
      ),
      writeFile,
    });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    await makeDirty(stdin);

    stdin.write('e');
    await tick();
    stdin.write('c');
    await tick();

    stdin.write('q');
    await tick();
    expect(lastFrame() ?? '').toContain('Quit without saving?');

    resolveExists(true);
    await tick();
    await tick();
    // The flow must not have pushed its own prompt over the quit confirmation.
    expect(lastFrame() ?? '').toContain('Quit without saving?');
    expect(lastFrame() ?? '').not.toContain('Overwrite');

    stdin.write('y');
    await tick();
    expect(writeFile).not.toHaveBeenCalled();
    expect(exited).toHaveBeenCalled();
  });
});

describe('E: edit the full request in $EDITOR', () => {
  it('valid JSON replaces the request, visible in the Questions pane', async () => {
    const newRequestJson = JSON.stringify({
      state: 'hi',
      questions: { only: { type: 'noul', instructions: 'only question' } },
    });
    const deps = makeDeps({ columns: 140, openEditor: vi.fn(async () => newRequestJson) });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('E');
    await waitForText(lastFrame, 'Request updated');
    expect(stripAnsi(lastFrame() ?? '')).toContain('only');
  });

  it('invalid JSON leaves the request unchanged and shows a line error', async () => {
    const deps = makeDeps({ columns: 140, openEditor: vi.fn(async () => '{') });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('E');
    await waitForText(lastFrame, '✕');
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(/line/);
    expect(stripAnsi(frame)).toContain('department');
  });

  it('identical text shows "No changes"', async () => {
    const deps = makeDeps({ columns: 140 });
    (deps.openEditor as ReturnType<typeof vi.fn>).mockImplementation(async (text: string) => text);
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('E');
    await waitForText(lastFrame, 'No changes');
  });

  it('a rejecting openEditor shows the error', async () => {
    const deps = makeDeps({
      columns: 140,
      openEditor: vi.fn(async () => {
        throw new Error('Editor not found: nope');
      }),
    });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('E');
    await waitForText(lastFrame, '✕ Editor not found: nope');
  });
});

describe('q: quit', () => {
  it('exits immediately when clean', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('q');
    await tick();
    expect(lastFrame() ?? '').not.toContain('Quit without saving?');
    expect(exited).toHaveBeenCalled();
  });

  it('asks for confirmation when dirty; n stays, y exits', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    await makeDirty(stdin);

    stdin.write('q');
    await tick();
    expect(lastFrame() ?? '').toContain('Quit without saving?');
    expect(exited).not.toHaveBeenCalled();

    stdin.write('n');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('changed');
    expect(lastFrame() ?? '').not.toContain('Quit without saving?');
    expect(exited).not.toHaveBeenCalled();

    stdin.write('q');
    await tick();
    stdin.write('y');
    await tick();
    expect(exited).toHaveBeenCalled();
  });
});

describe('Ctrl+C', () => {
  it('exits from a text prompt on a clean document', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('m');
    await tick();
    expect(lastFrame() ?? '').toContain('Model');

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
  });

  it('cancels a lines prompt and asks to confirm on a dirty document; a second Ctrl+C exits', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    await makeDirty(stdin);

    // Enter on the Questions pane: Instructions (text) then Options (lines).
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\r');
    await tick();
    expect(lastFrame() ?? '').toContain('Options (key: description)');

    stdin.write(CTRL_C);
    await tick();
    expect(lastFrame() ?? '').toContain('Quit without saving?');
    expect(exited).not.toHaveBeenCalled();

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
  });

  it('exits from the open-set list prompt', async () => {
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({
        list: vi.fn(async () => [{ name: 'triage', questionCount: 2, valid: true }]),
      }),
    });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('o');
    await waitForText(lastFrame, 'Open set');

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
  });

  it('exits with the help overlay open', async () => {
    const deps = makeDeps({ columns: 140 });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('?');
    await tick();
    expect(lastFrame() ?? '').toContain('Keys');

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
  });

  it('exits while a run is in flight', async () => {
    const deps = makeDeps({
      columns: 140,
      run: vi.fn(() => new Promise<RunResult>(() => {})),
    });
    const { lastFrame, stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('r');
    await tick();
    expect(stripAnsi(lastFrame() ?? '')).toContain('Running');

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
  });

  it('exits while an async flow is busy', async () => {
    let release: (() => void) | undefined;
    const deps = makeDeps({
      columns: 140,
      sets: fakeSets({
        list: vi.fn(
          async () =>
            await new Promise<SetSummary[]>((resolve) => {
              release = () => resolve([]);
            }),
        ),
      }),
    });
    const { stdin, exited } = renderApp(deps, REQUEST);
    stdin.write('o');
    await tick();

    stdin.write(CTRL_C);
    await tick();
    expect(exited).toHaveBeenCalled();
    release?.();
  });
});

describe('? help overlay', () => {
  it('contains every KEYMAP key and every line fits 80 columns', async () => {
    const deps = makeDeps({ columns: 80 });
    const { lastFrame, stdin } = render(<App deps={deps} initial={REQUEST} />);
    stdin.write('?');
    await tick();
    const frame = stripAnsi(lastFrame() ?? '');
    for (const key of Object.keys(KEYMAP)) {
      expect(frame).toContain(key);
    }
    for (const line of frame.split('\n')) {
      expect(displayWidth(line)).toBeLessThanOrEqual(80);
    }
  });
});
