import { useState, useEffect, KeyboardEvent } from 'react';
import type { MediaMetadata } from '../types';

interface MetadataPanelProps {
  fileName: string | null;
  metadata: MediaMetadata | null;
  onUpdate: (update: Partial<MediaMetadata>) => void;
}

export function MetadataPanel({ fileName, metadata, onUpdate }: MetadataPanelProps) {
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setTagInput('');
  }, [fileName]);

  if (!metadata || !fileName) {
    return <div className="metadata-panel" />;
  }

  const addTag = () => {
    const tag = tagInput.trim();
    if (!tag || metadata.tags.includes(tag)) {
      setTagInput('');
      return;
    }
    onUpdate({ tags: [...metadata.tags, tag] });
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    onUpdate({ tags: metadata.tags.filter((t) => t !== tag) });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  const setRating = (star: number) => {
    onUpdate({ rating: star === metadata.rating ? 0 : star });
  };

  return (
    <div className="metadata-panel">
      <div className="metadata-panel__header">
        <span className="metadata-panel__filename">{fileName}</span>
      </div>

      <section className="metadata-section">
        <h4 className="metadata-section__title">評価</h4>
        <div className="rating">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              className={`rating__star${star <= metadata.rating ? ' rating__star--active' : ''}`}
              onClick={() => setRating(star)}
              title={`${star}点`}
            >
              ★
            </button>
          ))}
          {metadata.rating > 0 && (
            <span className="rating__label">{metadata.rating} / 5</span>
          )}
        </div>
      </section>

      <section className="metadata-section">
        <h4 className="metadata-section__title">タグ</h4>
        <div className="tag-list">
          {metadata.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
              <button className="tag__remove" onClick={() => removeTag(tag)} title="削除">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="tag-input">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="タグを追加… (Enter)"
          />
          <button onClick={addTag} disabled={!tagInput.trim()}>
            追加
          </button>
        </div>
      </section>
    </div>
  );
}
