import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getAffluence, StoreAffluence } from '../../api/shifts';

interface Props {
  storeId: number;
  week: string;   // 'YYYY-WNN'
}

const LEVEL_META = {
  low:    { color: '#16a34a', bg: 'rgba(22,163,74,0.12)',  dot: '#22c55e' },
  medium: { color: '#b45309', bg: 'rgba(180,83,9,0.12)',   dot: '#f59e0b' },
  high:   { color: '#dc2626', bg: 'rgba(220,38,38,0.12)',  dot: '#ef4444' },
};

export default function AffluencePanel({ storeId, week }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StoreAffluence[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { store_id: storeId, week };
      if (selectedDay !== null) params.day_of_week = selectedDay;
      const res = await getAffluence(params);
      setRows(res.affluence);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [storeId, week, selectedDay]);

  useEffect(() => { load(); }, [load]);

  const byDay = new Map<number, StoreAffluence[]>();
  for (const r of rows) {
    if (!byDay.has(r.day_of_week)) byDay.set(r.day_of_week, []);
    byDay.get(r.day_of_week)!.push(r);
  }
  const days = Array.from(byDay.keys()).sort((a, b) => a - b);

  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden', marginTop: 16,
    }}>
      {/* Header */}
      <div style={{ background: 'var(--primary)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 4 }}>
            {t('shifts.affluence_heading')}
          </div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: '#fff' }}>
            {t('shifts.affluence_suggestions')}
          </div>
        </div>
        {loading && (
          <div style={{
            width: 16, height: 16, borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
            animation: 'spin 0.7s linear infinite',
          }} />
        )}
      </div>

      {/* Day filter pills */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([null, 1, 2, 3, 4, 5, 6, 0] as (number | null)[]).map((d) => (
          <button
            key={d ?? 'all'}
            onClick={() => setSelectedDay(d === selectedDay ? null : d)}
            style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: `1.5px solid ${d === selectedDay ? 'var(--accent)' : d === null && selectedDay === null ? 'var(--primary)' : 'var(--border)'}`,
              background: d === selectedDay ? 'var(--accent)' : d === null && selectedDay === null ? 'var(--primary)' : 'transparent',
              color: (d === selectedDay || (d === null && selectedDay === null)) ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.15s',
            }}
          >
            {d === null ? t('common.all') : t(`shifts.day${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]}`)}
          </button>
        ))}
      </div>

      {/* Content */}
      {rows.length === 0 && !loading ? (
        <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>📊</div>
          {t('shifts.affluence_no_data')}
          <br />
          <span style={{ fontSize: 11, marginTop: 4, display: 'block', opacity: 0.7 }}>
            {t('shifts.affluence_contact_admin')}
          </span>
        </div>
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {days.map((day) => {
            const slots = byDay.get(day)!.sort((a, b) => a.time_slot.localeCompare(b.time_slot));
            return (
              <div key={day}>
                <div style={{
                  padding: '8px 16px', background: 'var(--background)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '1.5px',
                }}>
                  {t(`shifts.day${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]}`)}
                </div>
                {slots.map((slot) => {
                  const meta = LEVEL_META[slot.level as keyof typeof LEVEL_META];
                  return (
                    <div
                      key={`${day}-${slot.time_slot}`}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '8px 16px', borderBottom: '1px solid var(--border)',
                        background: 'var(--surface)', transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = meta.bg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: 'var(--text)', minWidth: 44 }}>
                          {slot.time_slot}
                        </span>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '2px 9px', borderRadius: 20,
                          fontSize: 10, fontWeight: 800, letterSpacing: '0.8px',
                          background: meta.bg, color: meta.color,
                          border: `1px solid ${meta.dot}44`, textTransform: 'uppercase',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.dot }} />
                          {t(`shifts.level_${slot.level}`)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        <span style={{ fontSize: 13, color: meta.color }}>{slot.required_staff}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>pers.</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend footer */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid var(--border)',
        background: 'var(--background)',
        display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>{t('shifts.legend')}:</span>
        {(['low','medium','high'] as const).map((lvl) => {
          const m = LEVEL_META[lvl];
          return (
            <span key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: m.color, fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.dot, display: 'inline-block' }} />
              {t(`shifts.level_${lvl}`)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
