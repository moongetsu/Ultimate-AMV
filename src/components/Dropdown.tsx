import React from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  subtext?: string;
}

interface DropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}

export function Dropdown({
  options,
  value,
  onChange,
  className = "",
  ariaLabel,
  placeholder = "Select an option...",
}: DropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = React.useState(-1);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle keyboard accessibility
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setFocusedIndex(options.findIndex((opt) => opt.value === value));
      } else if (focusedIndex >= 0 && focusedIndex < options.length) {
        const opt = options[focusedIndex];
        if (!opt.disabled) {
          onChange(opt.value);
          setIsOpen(false);
        }
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        setFocusedIndex(0);
      } else {
        setFocusedIndex((prev) => {
          let next = prev + 1;
          while (next < options.length && options[next].disabled) {
            next++;
          }
          return next < options.length ? next : prev;
        });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isOpen) {
        setFocusedIndex((prev) => {
          let next = prev - 1;
          while (next >= 0 && options[next].disabled) {
            next--;
          }
          return next >= 0 ? next : prev;
        });
      }
    }
  }

  return (
    <div
      className={`custom-dropdown-container ${isOpen ? "is-open" : ""} ${className}`}
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="combobox"
      aria-expanded={isOpen}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
    >
      <div className="custom-dropdown-trigger" onClick={() => setIsOpen((prev) => !prev)}>
        <span className="custom-dropdown-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="custom-dropdown-arrow" size={16} />
      </div>

      {isOpen && (
        <ul className="custom-dropdown-menu" role="listbox">
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isFocused = index === focusedIndex;

            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                className={`custom-dropdown-item ${isSelected ? "is-selected" : ""} ${
                  option.disabled ? "is-disabled" : ""
                } ${isFocused ? "is-focused" : ""}`}
                onClick={() => {
                  if (!option.disabled) {
                    onChange(option.value);
                    setIsOpen(false);
                  }
                }}
                onMouseEnter={() => {
                  if (!option.disabled) {
                    setFocusedIndex(index);
                  }
                }}
              >
                <div className="custom-dropdown-item-label">{option.label}</div>
                {option.subtext && (
                  <div className="custom-dropdown-item-subtext">{option.subtext}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
