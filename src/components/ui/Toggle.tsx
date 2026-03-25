import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled = false }) => {
  const trackStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    width: 36,
    height: 20,
    borderRadius: 10,
    background: disabled
      ? '#d1d5db'
      : checked
      ? 'var(--accent)'
      : '#9ca3af',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.2s',
    position: 'relative',
    flexShrink: 0,
    opacity: disabled ? 0.5 : 1,
  };

  const thumbStyle: React.CSSProperties = {
    position: 'absolute',
    top: 2,
    left: checked && !disabled ? 18 : 2,
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
    transition: 'left 0.2s',
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span style={trackStyle}>
        <span style={thumbStyle} />
      </span>
    </button>
  );
};

export default Toggle;
