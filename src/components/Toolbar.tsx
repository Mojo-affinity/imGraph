interface ToolbarProps {
  currentDir: string | null;
  fileCount: number;
  onOpenDirectory: () => void;
}

export function Toolbar({ currentDir, fileCount, onOpenDirectory }: ToolbarProps) {
  return (
    <div className="toolbar">
      <button className="toolbar__open-btn" onClick={onOpenDirectory}>
        <FolderIcon />
        フォルダを開く
      </button>
      {currentDir && (
        <span className="toolbar__info">
          <span className="toolbar__path">{currentDir}</span>
          <span className="toolbar__count">{fileCount} 件</span>
        </span>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5z" />
    </svg>
  );
}
