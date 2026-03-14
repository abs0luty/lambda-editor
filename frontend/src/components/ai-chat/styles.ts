import type React from 'react'

export const chip: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
  borderRadius: 4, border: '1px solid #2a2a4a', background: 'transparent',
  color: '#a5b4fc', fontSize: 11, whiteSpace: 'nowrap',
}

export const textareaStyle: React.CSSProperties = {
  width: '100%', background: 'transparent', border: 'none',
  padding: '8px 10px', color: '#e2e8f0', fontSize: 13, outline: 'none',
  resize: 'none', fontFamily: 'system-ui, sans-serif', lineHeight: '1.5',
  boxSizing: 'border-box', display: 'block', minHeight: 52,
}

export const closeBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, borderRadius: 4, border: '1px solid #2a2a4a',
  background: 'transparent', color: '#6b7280', cursor: 'pointer', flexShrink: 0,
}

export const userBubble: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, fontSize: 13,
  background: '#3730a3', color: '#e0e7ff', lineHeight: 1.5,
  maxWidth: '100%', wordBreak: 'break-word',
}

export const actionBubble: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: 30, maxWidth: '100%', padding: '6px 10px',
  borderRadius: 10, border: '1px solid #2a2a4a',
  background: '#1e1e3a', flexShrink: 0,
}

export const botBubble: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10, fontSize: 13,
  background: '#1a1a35', color: '#c7d2fe', lineHeight: 1.65,
  maxWidth: '100%', wordBreak: 'break-word', border: '1px solid #1e2a4a',
}

export const quoteBlockStyle: React.CSSProperties = {
  background: '#0f0f1e', border: '1px solid #2a3a5a', borderRadius: 6,
  padding: '6px 10px', maxWidth: '100%',
}
