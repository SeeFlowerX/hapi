import { useTranslation } from '@/lib/use-translation'

const reasonKeys: Record<string, string> = {
    'external-running': 'session.readOnly.reason.externalRunning',
    'windows-external': 'session.readOnly.reason.windowsExternal',
    'imported': 'session.readOnly.reason.imported'
}

export function ReadOnlyBadge(props: { reason?: string; className?: string }) {
    const { t } = useTranslation()
    const reasonKey = props.reason ? reasonKeys[props.reason] : undefined
    const tooltip = reasonKey ? t(reasonKey) : t('session.readOnly.reason.unknown')

    return (
        <span
            className={`inline-flex items-center rounded-full bg-[var(--app-badge-warning-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-badge-warning-text)] ${props.className ?? ''}`}
            title={tooltip}
        >
            {t('session.readOnly.badge')}
        </span>
    )
}
