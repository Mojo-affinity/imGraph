const SHORTCUT_GROUPS: { title: string; shortcuts: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Left', 'Up'], desc: 'Previous file' },
      { keys: ['Right', 'Down'], desc: 'Next file' },
      { keys: ['Home'], desc: 'First file' },
      { keys: ['End'], desc: 'Last file' },
    ],
  },
  {
    title: 'Annotation',
    shortcuts: [
      { keys: ['1', '2', '3', '4', '5'], desc: 'Set rating' },
      { keys: ['0'], desc: 'Reset zoom' },
      { keys: ['A'], desc: 'Toggle annotation mode' },
      { keys: ['Delete', 'Backspace'], desc: 'Delete selected box' },
      { keys: ['Esc'], desc: 'Clear selection or close this panel' },
      { keys: ['Ctrl', 'S'], desc: 'Save annotation' },
    ],
  },
  {
    title: 'Inference',
    shortcuts: [
      { keys: ['D'], desc: 'Detect objects' },
      { keys: ['F'], desc: 'Detect faces' },
      { keys: ['B'], desc: 'Detect body parts with NudeNet' },
      { keys: ['N'], desc: 'Run NSFW classification' },
    ],
  },
  {
    title: 'Window',
    shortcuts: [
      { keys: ['L'], desc: 'Toggle log window' },
      { keys: ['?'], desc: 'Show or hide shortcuts' },
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <section
        className="shortcuts-panel"
        aria-label="Keyboard shortcuts"
        onClick={event => event.stopPropagation()}
      >
        <header className="shortcuts-panel__header">
          <span>Keyboard Shortcuts</span>
          <button
            className="shortcuts-panel__close"
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            x
          </button>
        </header>

        <div className="shortcuts-panel__body">
          {SHORTCUT_GROUPS.map(group => (
            <div className="shortcuts-group" key={group.title}>
              <h2 className="shortcuts-group__title">{group.title}</h2>
              <table className="shortcuts-table">
                <tbody>
                  {group.shortcuts.map(({ keys, desc }) => (
                    <tr key={`${group.title}-${desc}`}>
                      <td className="shortcuts-table__keys">
                        {keys.map((key, index) => (
                          <span key={key}>
                            <kbd className="shortcuts-kbd">{key}</kbd>
                            {index < keys.length - 1 && (
                              <span className="shortcuts-sep"> + </span>
                            )}
                          </span>
                        ))}
                      </td>
                      <td className="shortcuts-table__desc">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
