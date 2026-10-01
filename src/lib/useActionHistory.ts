import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { SimulationState } from '../model/types';
import { createHistory, finishHistory, historyReducer, type StateUpdate } from './actionHistory';

export function useActionHistory(initializer: () => SimulationState) {
  const [history, dispatch] = useReducer(historyReducer, initializer, init => createHistory(init()));
  const change = useCallback((update: StateUpdate, label?: string) => dispatch({ type: 'change', update, label }), []);
  const begin = useCallback((label?: string) => dispatch({ type: 'begin', label }), []);
  const end = useCallback(() => dispatch({ type: 'end' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const jump = useCallback((id: number) => dispatch({ type: 'jump', id }), []);
  // Preview the pending gesture as one step, without dropping redo on a net no-op.
  const visible = useMemo(() => finishHistory(history), [history]);
  useEffect(() => {
    window.addEventListener('blur', end);
    return () => window.removeEventListener('blur', end);
  }, [end]);
  return { state: history.present, change, begin, end, undo, redo, jump,
    entries: visible.entries, index: visible.index,
    canUndo: visible.index > 0, canRedo: visible.index < visible.entries.length - 1 };
}