import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { truncate } from './bars.js';

export interface TuiAction {
  id: string;
  label: string;
  shortcut: string;
  run(): void;
  disabledReason?: string;
}

export function Actions(props: {
  actions: TuiAction[];
  height: number;
  width: number;
  color: boolean;
  onCancel(): void;
  onCtrlC(): void;
}) {
  const { actions, height, width, color, onCancel, onCtrlC } = props;
  const [index, setIndex] = useState(0);
  const showFooter = height >= 2;
  const listHeight = Math.max(1, height - (showFooter ? 1 : 0));
  const maxStart = Math.max(0, actions.length - listHeight);
  const start = Math.min(maxStart, Math.max(0, index - listHeight + 1));
  const selectedReason = actions[index]?.disabledReason;

  useEffect(() => {
    if (index >= actions.length) setIndex(Math.max(0, actions.length - 1));
  }, [actions.length, index]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCtrlC();
      return;
    }
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow || input === 'k') {
      setIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow || input === 'j') {
      setIndex((value) => Math.min(actions.length - 1, value + 1));
      return;
    }
    if (key.return) {
      const action = actions[index];
      if (action && action.disabledReason === undefined) action.run();
    }
  });

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {actions.slice(start, start + listHeight).map((action, visibleIndex) => {
        const absoluteIndex = start + visibleIndex;
        const reason = action.disabledReason ? ` — disabled: ${action.disabledReason}` : '';
        return (
          <Text
            key={action.id}
            inverse={color && absoluteIndex === index}
            dimColor={action.disabledReason !== undefined && color}
          >
            {truncate(
              `${absoluteIndex === index ? '▸' : ' '} ${action.label}  ${action.shortcut}${reason}`,
              width,
            )}
          </Text>
        );
      })}
      {showFooter && (
        <Text dimColor={color}>
          {truncate(
            selectedReason === undefined
              ? '↑↓/j k move · Enter run · Esc cancel'
              : `Disabled: ${selectedReason}`,
            width,
          )}
        </Text>
      )}
    </Box>
  );
}
