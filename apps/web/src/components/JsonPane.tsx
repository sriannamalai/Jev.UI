// The JSON pane: a CodeMirror 6 editor controlled by `state.jsonText`
// (spec §8.1). Two directions of sync, kept deliberately separate:
//
//   doc -> store: user keystrokes are debounced 150ms before becoming a
//   `jsonEdited` dispatch, so the store (and the form it drives) isn't
//   re-parsing on every keystroke. The debounce is flushed immediately on
//   blur and on unmount so a typed-but-not-yet-debounced edit is never
//   lost.
//
//   store -> doc: when `state.jsonText` changes for a reason other than
//   this editor's own last dispatch (a form edit, a loaded set, an
//   undo/redo), the whole document is replaced in one transaction tagged
//   with `externalUpdate` so the update listener below knows to ignore it.
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import {
  Annotation,
  EditorSelection,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { json } from '@codemirror/lang-json';
import { forceLinting, linter, type Diagnostic } from '@codemirror/lint';
import { basicSetup } from 'codemirror';
import { useWorkbench } from '../store.js';
import { JsonPaneHeader } from './JsonPaneHeader.js';
import { findQuestionRange } from './jsonHighlight.js';

const JSON_EDIT_DEBOUNCE_MS = 150;

// Tags a transaction as originating from the store (not the user), so the
// update listener that feeds keystrokes back into the store never treats
// its own writes as user input.
const externalUpdate = Annotation.define<boolean>();

const setHighlight = StateEffect.define<{ fromLine: number; toLine: number } | null>();

const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        if (effect.value === null) {
          next = Decoration.none;
        } else {
          const { fromLine, toLine } = effect.value;
          const totalLines = tr.state.doc.lines;
          const decorations = [];
          for (
            let lineNumber = fromLine;
            lineNumber <= Math.min(toLine, totalLines);
            lineNumber++
          ) {
            const line = tr.state.doc.line(lineNumber);
            decorations.push(Decoration.line({ class: 'cm-jev-selected' }).range(line.from));
          }
          next = Decoration.set(decorations);
        }
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function paneTheme(): Extension {
  return EditorView.theme({
    '&': {
      color: 'var(--ink)',
      backgroundColor: 'var(--panel)',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'var(--ink)',
      fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
      fontSize: '12.5px',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--panel)',
      color: 'var(--ink-3)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--sunk)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--sunk)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--accent-soft) !important',
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'var(--accent-soft) !important',
    },
    '.cm-jev-selected': {
      backgroundColor: 'var(--hl)',
    },
  });
}

// Replaces the whole document with `text` in one externally-tagged
// transaction, preserving the caret when the editor has focus and its
// position still fits in the new document.
function replaceDoc(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;

  const length = text.length;
  const hasFocus = view.hasFocus;
  const selection = hasFocus
    ? EditorSelection.single(
        Math.min(view.state.selection.main.anchor, length),
        Math.min(view.state.selection.main.head, length),
      )
    : undefined;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection,
    annotations: externalUpdate.of(true),
  });
}

export function JsonPane() {
  const { state, dispatch, run } = useWorkbench();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRef = useRef(state.jsonError);
  const runRef = useRef(run);
  runRef.current = run;

  function flushPending(view: EditorView): void {
    if (debounceRef.current === null) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = null;
    const text = view.state.doc.toString();
    dispatch({ type: 'jsonEdited', text });
  }

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const lintSource = linter((view) => {
      const error = errorRef.current;
      if (error?.line === undefined) return [];
      const totalLines = view.state.doc.lines;
      const lineNumber = Math.min(Math.max(error.line, 1), totalLines);
      const line = view.state.doc.line(lineNumber);
      const diagnostic: Diagnostic = {
        from: line.from,
        to: line.to,
        severity: 'error',
        message: error.message,
      };
      return [diagnostic];
    });

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const isExternal = update.transactions.some((tr) => tr.annotation(externalUpdate) === true);
      if (isExternal) return;

      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const text = update.view.state.doc.toString();
        dispatch({ type: 'jsonEdited', text });
      }, JSON_EDIT_DEBOUNCE_MS);
    });

    const view = new EditorView({
      doc: state.jsonText,
      parent: host,
      extensions: [
        basicSetup,
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: (runView) => {
                // Flush first so the run sends what the user just typed, not
                // the previous state — `flushSync` forces the dispatch's
                // reducer + the provider's layout effect to commit before we
                // read the store again in `runRef.current()`, so there is no
                // stale-ref race to defer with a microtask/timeout.
                flushSync(() => flushPending(runView));
                void runRef.current();
                return true;
              },
            },
          ]),
        ),
        keymap.of([indentWithTab]),
        json(),
        lintSource,
        highlightField,
        EditorView.lineWrapping,
        paneTheme(),
        EditorView.contentAttributes.of({ 'aria-label': 'Request JSON' }),
        updateListener,
        EditorView.domEventHandlers({
          focus: () => {
            dispatch({ type: 'jsonFocus', focused: true });
            return false;
          },
          blur: (_event, view) => {
            flushPending(view);
            dispatch({ type: 'jsonFocus', focused: false });
            return false;
          },
        }),
      ],
    });

    viewRef.current = view;

    return () => {
      flushPending(view);
      view.destroy();
      viewRef.current = null;
    };
    // Created once; every later sync goes through the effects below rather
    // than recreating the editor.
  }, []);

  // store -> doc: keep the ref current every render so the linter source
  // (a closure captured once, above) always reads the latest error without
  // needing the whole editor rebuilt.
  errorRef.current = state.jsonError;

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    forceLinting(view);
  }, [state.jsonError]);

  // store -> doc: replace the doc whenever it no longer matches
  // `state.jsonText`, UNLESS the editor has a pending, un-flushed user edit
  // (the debounce timer is armed) — in that case the in-flight keystrokes
  // win and the replacement is skipped until they're flushed. This re-checks
  // the doc itself rather than a "last dispatched" ref, so a value the store
  // revisits (T1 -> T0 where T0 was already seen) is still applied.
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    if (debounceRef.current !== null) return;
    replaceDoc(view, state.jsonText);
  }, [state.jsonText]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const id = state.wb.selectedId;
    const range = id === undefined ? undefined : findQuestionRange(state.jsonText, id);
    view.dispatch({
      effects: setHighlight.of(range === undefined ? null : range),
    });
  }, [state.jsonText, state.wb.selectedId]);

  return (
    <section className="col col-json">
      <JsonPaneHeader error={state.jsonError} synced={!state.jsonFocused} />
      <div className="cm-jev-json" ref={hostRef} />
    </section>
  );
}
