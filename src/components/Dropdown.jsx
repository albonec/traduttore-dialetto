import { useEffect, useRef, useState } from 'react';

/*
 * Menu a tendina custom: i <select> nativi su alcuni temi di sistema
 * mostrano le opzioni con colori illeggibili. Qui il pannello è un
 * elemento della pagina, con colori espliciti e lista scorrevole.
 */
export default function Dropdown({ label, items, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = items.find((item) => item.value === value);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1 text-sm font-bold text-gray-700">
      <span>{label}</span>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border
                     border-gray-300 bg-white px-3 py-2.5 text-left text-[15px] font-normal
                     text-gray-800 hover:border-green-700 disabled:cursor-not-allowed
                     disabled:opacity-60"
        >
          <span className="truncate">{selected ? selected.label : ''}</span>
          <span
            className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </button>
        {open && (
          <ul
            role="listbox"
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(320px,45vh)]
                       overflow-y-auto rounded-md border border-gray-300 bg-white p-1
                       shadow-lg"
          >
            {items.map((item) => (
              <li
                key={item.value}
                role="option"
                aria-selected={item.value === value}
                onClick={() => {
                  setOpen(false);
                  if (item.value !== value) onChange(item.value);
                }}
                className={`cursor-pointer rounded px-2.5 py-2 text-[15px] font-normal ${
                  item.value === value
                    ? 'bg-green-700 text-white'
                    : 'text-gray-800 hover:bg-indigo-50'
                }`}
              >
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
