import { useTranslation } from 'react-i18next';

const STEPS = [
  { icon: '🖥️', key: 'step1' },
  { icon: '📱', key: 'step2' },
  { icon: '👆', key: 'step3' },
  { icon: '✅', key: 'step4' },
];

export default function EmployeeCheckinPage() {
  const { t } = useTranslation();

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header banner */}
      <div
        className="pop-in"
        style={{
          background: 'linear-gradient(135deg, #0D2137 0%, #1A3B5C 100%)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18, fontWeight: 700, color: '#ffffff', marginBottom: 4,
        }}>
          {t('checkin.title')}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: 'var(--font-body)' }}>
          {t('checkin.subtitle')}
        </div>
      </div>

      {/* Steps card */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderTop: '3px solid var(--accent)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '20px 24px',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          fontFamily: 'var(--font-display)', marginBottom: 4,
        }}>
          {t('checkin.howToUse')}
        </div>

        {STEPS.map(({ icon, key }, i) => (
          <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(201,151,58,0.10)',
              border: '1.5px solid rgba(201,151,58,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>
              {icon}
            </div>
            <div>
              <div style={{
                fontSize: 12, fontWeight: 700, color: 'var(--accent)',
                fontFamily: 'var(--font-display)', marginBottom: 2,
              }}>
                {t('checkin.stepLabel', { n: i + 1 })}
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t(`checkin.${key}`)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action type legend */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        padding: '20px 24px',
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
          fontFamily: 'var(--font-display)', marginBottom: 14,
        }}>
          {t('checkin.actionTypes')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { color: '#16a34a', labelKey: 'scan.checkin' },
            { color: '#d97706', labelKey: 'scan.breakStart' },
            { color: '#2563eb', labelKey: 'scan.breakEnd' },
            { color: '#dc2626', labelKey: 'scan.checkout' },
          ].map(({ color, labelKey }) => (
            <div key={labelKey} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              borderRadius: 10,
              background: `${color}12`,
              border: `1px solid ${color}30`,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: color, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 13, fontWeight: 700,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)',
                letterSpacing: 0.3,
              }}>
                {t(labelKey)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
