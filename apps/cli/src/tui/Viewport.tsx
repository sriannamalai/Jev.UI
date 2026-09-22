import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { displayWidth, truncate } from './bars.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Wrap text by terminal columns while preserving newlines and grapheme clusters. */
export function wrapDisplayText(text: string, width: number): string[] {
  if (width < 1) return [''];
  const result: string[] = [];
  for (const logicalLine of text.split('\n')) {
    if (logicalLine.length === 0) {
      result.push('');
      continue;
    }
    let line = '';
    let lineWidth = 0;
    for (const { segment } of segmenter.segment(logicalLine)) {
      const segmentWidth = displayWidth(segment);
      // A width-one terminal row cannot physically contain a width-two
      // grapheme. Preserve its identity as a reversible ASCII code-point
      // escape instead of clipping it or overflowing the viewport.
      const displaySegments =
        segmentWidth > width
          ? [
              ...Array.from(segment)
                .map((character) => `\\u{${character.codePointAt(0)!.toString(16)}}`)
                .join(''),
            ]
          : [segment];
      for (const displaySegment of displaySegments) {
        const displaySegmentWidth = displayWidth(displaySegment);
        if (line.length > 0 && lineWidth + displaySegmentWidth > width) {
          result.push(line);
          line = '';
          lineWidth = 0;
        }
        line += displaySegment;
        lineWidth += displaySegmentWidth;
      }
    }
    result.push(line);
  }
  return result;
}

export interface ViewportRow {
  key: string;
  content: ReactNode;
  selectionId?: string;
}

export interface ViewportProps {
  rows: ViewportRow[];
  width: number;
  height?: number;
  active?: boolean;
  contentKey: string;
  selectedId?: string;
  onSelect?(id: string): void;
  selectionNavigation?: boolean;
}

/** A line-oriented, height-bounded window. Overflow reserves its final row
 * for an unstyled position indicator so scroll state is visible with
 * `NO_COLOR`. */
export function Viewport(props: ViewportProps) {
  const {
    rows,
    width,
    height,
    active = false,
    contentKey,
    selectedId,
    onSelect,
    selectionNavigation = false,
  } = props;
  const boundedHeight = height === undefined ? undefined : Math.max(0, Math.floor(height));
  const overflow = boundedHeight !== undefined && rows.length > boundedHeight;
  const showIndicator = overflow && boundedHeight !== undefined && boundedHeight > 1;
  const pageSize =
    boundedHeight === undefined
      ? rows.length
      : Math.max(0, boundedHeight - (showIndicator ? 1 : 0));
  const maxOffset = Math.max(0, rows.length - pageSize);
  const [offset, setOffset] = useState(0);
  const clampedOffset = Math.min(offset, maxOffset);
  const selectedFirst =
    selectedId === undefined ? -1 : rows.findIndex((row) => row.selectionId === selectedId);
  let selectedLast = selectedFirst;
  while (
    selectedLast >= 0 &&
    selectedLast + 1 < rows.length &&
    rows[selectedLast + 1]?.selectionId === selectedId
  )
    selectedLast += 1;
  const selectionBoundsKey = `${contentKey}:${selectedId ?? ''}:${selectedFirst}:${selectedLast}`;

  useEffect(() => {
    setOffset(0);
  }, [contentKey]);

  useEffect(() => {
    setOffset((current) => Math.min(current, maxOffset));
  }, [maxOffset]);

  useEffect(() => {
    if (boundedHeight === undefined || selectedId === undefined || pageSize < 1) return;
    const first = selectedFirst;
    const last = selectedLast;
    if (first < 0) return;
    setOffset((current) => {
      if (last - first + 1 > pageSize) return first;
      if (first < current) return first;
      if (last >= current + pageSize) return last - pageSize + 1;
      return current;
    });
  }, [boundedHeight, pageSize, selectionBoundsKey]);

  const selectionStarts = useMemo(
    () =>
      rows.flatMap((row, index) =>
        row.selectionId !== undefined && rows[index - 1]?.selectionId !== row.selectionId
          ? [{ id: row.selectionId, index }]
          : [],
      ),
    [rows],
  );

  useInput(
    (input, key) => {
      if (boundedHeight === undefined || pageSize < 1) return;
      if (selectionNavigation && onSelect) {
        if (selectionStarts.length === 0) return;
        if (key.home) {
          const first = selectionStarts[0]!;
          if (selectedId === first.id && clampedOffset > first.index) setOffset(first.index);
          else onSelect(first.id);
        } else if (key.end) {
          const last = selectionStarts.at(-1)!;
          if (selectedId === last.id) setOffset(maxOffset);
          else onSelect(last.id);
        } else if (key.pageDown) {
          if (selectedLast >= clampedOffset + pageSize) {
            setOffset((current) => Math.min(maxOffset, current + pageSize));
          } else {
            const visible = selectionStarts.filter(
              (entry) => entry.index >= clampedOffset && entry.index < clampedOffset + pageSize,
            );
            const candidate =
              visible.at(-1) ??
              selectionStarts.find((entry) => entry.index >= clampedOffset + pageSize) ??
              selectionStarts.at(-1)!;
            onSelect(
              candidate.id === selectedId && candidate !== selectionStarts.at(-1)
                ? selectionStarts[selectionStarts.indexOf(candidate) + 1]!.id
                : candidate.id,
            );
          }
        } else if (key.pageUp) {
          if (selectedFirst >= 0 && selectedFirst < clampedOffset) {
            setOffset((current) => Math.max(selectedFirst, current - pageSize));
          } else {
            const visible = selectionStarts.filter(
              (entry) => entry.index >= clampedOffset && entry.index < clampedOffset + pageSize,
            );
            const candidate = visible[0] ?? selectionStarts[0]!;
            onSelect(
              candidate.id === selectedId && candidate !== selectionStarts[0]
                ? selectionStarts[selectionStarts.indexOf(candidate) - 1]!.id
                : candidate.id,
            );
          }
        }
        return;
      }

      if (key.downArrow || input === 'j') {
        setOffset((current) => Math.min(maxOffset, current + 1));
      } else if (key.upArrow || input === 'k') {
        setOffset((current) => Math.max(0, current - 1));
      } else if (key.pageDown) {
        setOffset((current) => Math.min(maxOffset, current + pageSize));
      } else if (key.pageUp) {
        setOffset((current) => Math.max(0, current - pageSize));
      } else if (key.home) {
        setOffset(0);
      } else if (key.end) {
        setOffset(maxOffset);
      }
    },
    { isActive: active && boundedHeight !== undefined && pageSize > 0 },
  );

  if (boundedHeight === undefined) {
    return (
      <Box flexDirection="column" width={width}>
        {rows.map((row) => (
          <Box key={row.key}>{row.content}</Box>
        ))}
      </Box>
    );
  }

  if (boundedHeight === 0) {
    return <Box width={width} height={0} overflow="hidden" />;
  }

  const visibleRows = rows.slice(clampedOffset, clampedOffset + pageSize);
  const firstVisible = rows.length === 0 ? 0 : clampedOffset + 1;
  const lastVisible = Math.min(rows.length, clampedOffset + pageSize);
  const indicator = truncate(`↕ ${firstVisible}–${lastVisible}/${rows.length}`, width);

  return (
    <Box flexDirection="column" width={width} height={boundedHeight} overflow="hidden">
      {visibleRows.map((row) => (
        <Box key={row.key}>{row.content}</Box>
      ))}
      {showIndicator && <Text>{indicator}</Text>}
    </Box>
  );
}
