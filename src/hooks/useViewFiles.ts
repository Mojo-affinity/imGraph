import { useMemo } from 'react';
import { useStore } from '../store';

export function useViewFiles() {
  const files             = useStore(s => s.files);
  const metadata          = useStore(s => s.metadata);
  const viewTagFilter     = useStore(s => s.viewTagFilter);
  const viewTagFilterMode = useStore(s => s.viewTagFilterMode);

  return useMemo(() => {
    const base = files.filter(f => f.media_type === 'image' || f.media_type === 'video');
    if (viewTagFilter.length === 0) return base;
    return base.filter(f => {
      const fileTags = metadata[f.path]?.tags ?? [];
      if (viewTagFilterMode === 'and') {
        return viewTagFilter.every(t => fileTags.includes(t));
      } else {
        return viewTagFilter.some(t => fileTags.includes(t));
      }
    });
  }, [files, metadata, viewTagFilter, viewTagFilterMode]);
}
