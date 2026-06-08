import { useStore } from '../store';

// 既存コンポーネントとの互換性を保ちつつ、Zustand ストアをラップする。
// selectedFile / selectedMetadata などの派生値をここで計算する。
export function useMediaStore() {
  const store = useStore();

  const selectedFile =
    store.selectedIndex !== null
      ? (store.files[store.selectedIndex] ?? null)
      : null;

  const selectedMetadata = selectedFile
    ? (store.metadata[selectedFile.path] ?? { tags: [], rating: 0 })
    : null;

  return {
    ...store,
    selectedFile,
    selectedMetadata,
  };
}

// コンポーネントが直接ストアを使いたい場合はこちらをインポートする
export { useStore } from '../store';
