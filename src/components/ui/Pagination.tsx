import React from 'react';
import { useTranslation } from 'react-i18next';

interface PaginationProps {
  page: number;
  pages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pages,
  total,
  limit,
  onPageChange,
}) => {
  const { t } = useTranslation();
  if (pages <= 1 && total === 0) return null;

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '32px',
    height: '32px',
    padding: '0 8px',
    fontSize: '12.5px',
    fontFamily: 'var(--font-body)',
    fontWeight: 500,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    background: 'var(--surface)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.12s ease',
  };

  const buildPageNumbers = (): (number | '...')[] => {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    const result: (number | '...')[] = [];
    const delta = 2;
    const left = Math.max(2, page - delta);
    const right = Math.min(pages - 1, page + delta);
    result.push(1);
    if (left > 2) result.push('...');
    for (let i = left; i <= right; i++) result.push(i);
    if (right < pages - 1) result.push('...');
    result.push(pages);
    return result;
  };

  const ChevronLeft = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
  );
  const ChevronRight = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
  );

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
      padding: '14px 0 4px',
    }}>
      <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
        {total === 0
          ? t('common.noResults')
          : t('common.showingResults', { from, to, total })}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <button
          className="pag-btn"
          style={page <= 1 ? { ...btnBase, opacity: 0.38, cursor: 'not-allowed', pointerEvents: 'none' } : btnBase}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label={t('common.previous')}
        >
          <ChevronLeft />
        </button>

        {buildPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`e-${idx}`} style={{ ...btnBase, cursor: 'default', border: 'none', background: 'transparent', minWidth: '24px' }}>…</span>
          ) : (
            <button
              key={p}
              className="pag-btn"
              style={p === page
                ? { ...btnBase, background: 'var(--primary)', color: '#fff', borderColor: 'var(--primary)', boxShadow: '0 2px 8px rgba(13,33,55,0.18)' }
                : btnBase}
              onClick={() => onPageChange(p as number)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Pagina ${p}`}
            >
              {p}
            </button>
          )
        )}

        <button
          className="pag-btn"
          style={page >= pages ? { ...btnBase, opacity: 0.38, cursor: 'not-allowed', pointerEvents: 'none' } : btnBase}
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          aria-label={t('common.next')}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
